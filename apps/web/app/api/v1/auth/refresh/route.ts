// app/api/v1/auth/refresh/route.ts
//
// POST /api/v1/auth/refresh -- a signed-in browser trades its session
// cookie for a short-lived bearer, so the chat widget can authenticate to
// the agent without the page ever handling a password.
//
// THIS ROUTE DOES NOT USE requireApiUser, AND THAT IS THE POINT.
// requireApiUser accepts a bearer OR a cookie, and a bearer is what this
// route issues -- so wiring it that way would let the agent's own token
// mint itself a fresh one, and then another, forever. A token that can
// refresh itself does not expire, which removes the only lever we have:
// these JWTs cannot be revoked, and rotating NEXTAUTH_SECRET is the sole
// kill switch and signs out every browser (see auth/token/route.ts).
//
// A browser may refresh. A token may not. Anyone "tidying" this route to
// match the others should read that sentence twice.
//
// It also never reads a request body. Not "rejects a password" -- never
// parses one. That is why there is nothing here to bypass.
import type { NextRequest } from 'next/server';
import { encode, getToken } from 'next-auth/jwt';

import { ok, fail } from '../../_lib/respond';
import { isRateLimited, recordAttempt } from '../../_lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Long enough to hold a conversation, short enough that a leaked token is
// stale before it is useful. Deliberately NOT caller-controllable:
// clampTtl exists so a caller can ask for less than a long default, and
// here there is no default worth shortening.
export const REFRESH_TTL_SECONDS = 15 * 60;

const MINT_WINDOW_MS = 5 * 60 * 1000;
// A widget refreshing a fifteen-minute token will never approach this; a
// client stuck in a loop hits it immediately.
const MINT_LIMIT = 20;

export async function POST(req: NextRequest) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    // Minting against a missing secret produces a token nothing can
    // verify. Loudly broken beats quietly issuing junk -- the same call
    // the token route makes.
    return fail(500, 'Server is not configured to issue tokens');
  }

  // Cookie only. See the header: getToken rather than requireApiUser is
  // the security property this route is built around.
  const session = await getToken({ req, secret });
  if (!session?.sub) return fail(401, 'Authentication required');

  const key = `refresh:user:${session.sub}`;
  const verdict = isRateLimited(key, MINT_LIMIT, MINT_WINDOW_MS);
  if (verdict.limited) {
    const response = fail(429, 'Too many refreshes. Try again shortly.');
    response.headers.set('retry-after', String(verdict.retryAfterSeconds));
    return response;
  }
  recordAttempt(key, MINT_WINDOW_MS);

  const token = await encode({
    token: {
      sub: session.sub,
      email: session.email,
      role: session.role,
    },
    secret,
    maxAge: REFRESH_TTL_SECONDS,
  });

  // No `user` in the response: the browser calling this already knows who
  // it is, and a route that hands back identity invites a client to trust
  // it instead of /whoami, which is the one place that resolves it.
  return ok({
    token,
    tokenType: 'Bearer',
    expiresIn: REFRESH_TTL_SECONDS,
    expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000).toISOString(),
  });
}
