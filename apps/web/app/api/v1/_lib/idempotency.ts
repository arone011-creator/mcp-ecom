// app/api/v1/_lib/idempotency.ts
//
// Makes a mutating route safe to retry. A client that times out mid-request
// has no way to know whether the work happened; without this, its only
// options are to retry and risk doing it twice, or not to retry and risk
// not doing it at all.
//
// Database-backed rather than in-process, unlike the rate limiter next
// door. That one may forget its state on redeploy because forgetting a
// counter fails safe -- it grants a few extra password attempts to an
// endpoint with other defences. Forgetting an idempotency key fails the
// other way: the retry executes a second cancellation.
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

/**
 * Sorted keys, so `{ a, b }` and `{ b, a }` are the same request. Anything
 * order-sensitive would let a reordering slip past the mismatch check --
 * which is the check that stops a key approved for one call being spent on
 * another.
 *
 * Values are JSON-encoded rather than stringified loosely, so 1 and "1"
 * stay distinguishable.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    // undefined is absence, and absence must hash like absence -- an
    // explicit null is a different request and still counts.
    .filter(([, nested]) => nested !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`);

  return `{${entries.join(',')}}`;
}

export function requestHash(args: unknown): string {
  return createHash('sha256').update(canonical(args)).digest('hex');
}

const NO_STORE = { 'cache-control': 'no-store' } as const;

const IN_PROGRESS = 'A request with this Idempotency-Key is still in progress';
const MISMATCH = 'Idempotency-Key was already used with different arguments';

function refuse(error: string) {
  return NextResponse.json({ error }, { status: 409, headers: NO_STORE });
}

/**
 * Runs `handler` at most once per (user, scope, key).
 *
 * With no key the handler runs unguarded. The storefront's own fetches do
 * not send one, and requiring it would be a breaking change to a shipped
 * API for the sake of a caller that does not exist yet.
 */
export async function withIdempotency(
  key: string | null,
  userId: string,
  scope: string,
  args: unknown,
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  if (!key) return handler();

  const where = { userId_scope_key: { userId, scope, key } };
  const hash = requestHash(args);

  try {
    // Claim first, then work. The other order -- work, then record --
    // leaves a window in which two racing duplicates are both executing.
    await prisma.idempotencyKey.create({
      data: { key, userId, scope, requestHash: hash, status: 0 },
    });
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;

    const existing = await prisma.idempotencyKey.findUnique({ where });

    // Vanished between the create and the read. Treat it as in flight
    // rather than guessing that the work never happened.
    if (!existing) return refuse(IN_PROGRESS);

    if (existing.requestHash !== hash) return refuse(MISMATCH);

    if (existing.status === 0) return refuse(IN_PROGRESS);

    return NextResponse.json(existing.response as object, {
      status: existing.status,
      headers: { ...NO_STORE, 'idempotent-replay': 'true' },
    });
  }

  let response: NextResponse;
  try {
    response = await handler();
  } catch (error) {
    // Nothing was settled, so the claim must not outlive the attempt.
    await prisma.idempotencyKey.delete({ where }).catch(() => undefined);
    throw error;
  }

  // A 5xx is not an outcome, it is the absence of one. Releasing the claim
  // is what makes the retry a retry, rather than a permanent replay of a
  // server error.
  if (response.status >= 500) {
    await prisma.idempotencyKey.delete({ where }).catch(() => undefined);
    return response;
  }

  // Cloned so reading the body here does not consume it for the caller.
  const body = await response.clone().json();
  await prisma.idempotencyKey.update({
    where,
    data: { status: response.status, response: body },
  });

  return response;
}
