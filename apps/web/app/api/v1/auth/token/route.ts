// app/api/v1/auth/token/route.ts
//
// Exchanges an email and password for the same NextAuth JWT the browser
// keeps in its session cookie, so a non-browser client can authenticate
// against the v1 API without ever touching a cookie jar.
//
// The token is minted with next-auth's own `encode`, which means there is
// no second signing key and no second notion of identity to keep in step
// with the storefront -- requireApiUser verifies both the same way.
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { encode } from 'next-auth/jwt';
import prisma from '@/lib/prisma';
import { ok, fail } from '../../_lib/respond';
import { isRateLimited, recordAttempt } from '../../_lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Shorter than the 30-day browser session on purpose: a token that travels
// in a header, into config files and process environments, should have a
// smaller window of usefulness if it leaks.
export const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
// A minute is short enough to be useless to a leak and long enough that a
// slow first call does not expire mid-flight.
export const MIN_TTL_SECONDS = 60;

/**
 * Callers may ask for a shorter-lived token; the MCP server does, because
 * a token handed to an agent cannot be revoked -- rotating NEXTAUTH_SECRET
 * is the only kill switch and it signs out every browser.
 *
 * Clamped rather than rejected. Every outcome here is still a usable
 * token, just for less time, and both directions fail towards a shorter
 * one: an unusable value -- absent, fractional, non-numeric -- falls back
 * to the default rather than costing the caller its round trip.
 */
export function clampTtl(requested: number | undefined): number {
  if (!Number.isInteger(requested)) return DEFAULT_TTL_SECONDS;
  const value = requested as number;
  if (value < MIN_TTL_SECONDS) return MIN_TTL_SECONDS;
  if (value > DEFAULT_TTL_SECONDS) return DEFAULT_TTL_SECONDS;
  return value;
}

const ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
const IP_ATTEMPT_LIMIT = 10;
// Tighter than the address limit, because rotating source addresses is
// cheap and the account is what actually needs protecting.
const ACCOUNT_ATTEMPT_LIMIT = 5;

// A real hash of a value no account uses. Compared against when the lookup
// misses, so that "no such user" costs the same time as "wrong password"
// and response latency stops being an enumeration oracle.
const ABSENT_ACCOUNT_HASH =
  '$2a$12$WAPAjmBfUvIf195r9EGwCu366IzVO01sBeKdzdpBQU39uAtDOXFma';

// One message for every rejection. Distinguishing them would tell an
// attacker which addresses have accounts.
const REJECTION = 'Invalid email or password';

const credentialsSchema = z.object({
  email: z
    .string()
    .max(320)
    .transform((value) => value.trim().toLowerCase())
    .pipe(z.string().email()),
  password: z.string().min(1).max(200),
  // Passed through rather than validated here: clampTtl decides what is
  // usable, and a bad lifetime should not cost the caller its credentials
  // round trip.
  ttlSeconds: z.unknown().optional(),
});

/**
 * The address our own proxy saw. `x-forwarded-for` accumulates left to
 * right, and anything a client sends arrives at the left, so the rightmost
 * hop is the only entry a caller cannot forge.
 */
function clientAddress(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');

  if (forwarded) {
    const hops = forwarded
      .split(',')
      .map((hop) => hop.trim())
      .filter(Boolean);

    const peer = hops[hops.length - 1];
    if (peer) return peer;
  }

  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

function tooManyAttempts(retryAfterSeconds: number) {
  const response = fail(429, 'Too many attempts. Try again shortly.');
  response.headers.set('retry-after', String(retryAfterSeconds));
  return response;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'Request body must be JSON');
  }

  const parsed = credentialsSchema.safeParse(body);
  if (!parsed.success) {
    return fail(400, 'A valid email and a password are required');
  }

  const { email, password } = parsed.data;

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    // Minting against a missing secret would produce a token nothing can
    // verify. Better to be loudly broken than quietly issuing junk.
    return fail(500, 'Server is not configured to issue tokens');
  }

  const addressKey = `token:ip:${clientAddress(req)}`;
  const accountKey = `token:account:${email}`;

  const addressVerdict = isRateLimited(
    addressKey,
    IP_ATTEMPT_LIMIT,
    ATTEMPT_WINDOW_MS
  );
  if (addressVerdict.limited) {
    return tooManyAttempts(addressVerdict.retryAfterSeconds);
  }

  const accountVerdict = isRateLimited(
    accountKey,
    ACCOUNT_ATTEMPT_LIMIT,
    ATTEMPT_WINDOW_MS
  );
  if (accountVerdict.limited) {
    return tooManyAttempts(accountVerdict.retryAfterSeconds);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      password: true,
    },
  });

  // Always run the comparison, even with nothing to compare against.
  const passwordMatches = await bcrypt.compare(
    password,
    user?.password ?? ABSENT_ACCOUNT_HASH
  );

  if (!user || !user.password || !passwordMatches) {
    // Only failures are charged, so a working client never rate-limits
    // itself out of its own account.
    recordAttempt(addressKey, ATTEMPT_WINDOW_MS);
    recordAttempt(accountKey, ATTEMPT_WINDOW_MS);
    return fail(401, REJECTION);
  }

  const ttlSeconds = clampTtl(parsed.data.ttlSeconds as number | undefined);

  const token = await encode({
    token: { sub: user.id, email: user.email, role: user.role },
    secret,
    maxAge: ttlSeconds,
  });

  return ok({
    token,
    tokenType: 'Bearer',
    expiresIn: ttlSeconds,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  });
}
