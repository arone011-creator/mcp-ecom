// app/api/v1/_lib/rate-limit.ts
//
// A fixed-window counter held in process memory. Deliberately small: the
// only thing it guards is the password endpoint, and the alternative --
// Redis -- is infrastructure this demo does not have.
//
// Known limit: the state is per-instance. Scale the service past one
// replica and the effective allowance multiplies by the replica count.
// That is acceptable while the deployment is a single container; it stops
// being acceptable the moment it is not.

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Sweeping only when the map has grown keeps the common path free of
// housekeeping while still bounding memory against address rotation.
const SWEEP_THRESHOLD = 1000;

function sweep(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitVerdict = {
  limited: boolean;
  retryAfterSeconds: number;
};

/**
 * Reports whether `key` has already spent its allowance, without consuming
 * any of it. Checking and recording are separate so callers can charge only
 * for the attempts that deserve it -- failures, not successes.
 */
export function isRateLimited(
  key: string,
  limit: number,
  windowMs: number
): RateLimitVerdict {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    return { limited: false, retryAfterSeconds: 0 };
  }

  if (bucket.count < limit) {
    return { limited: false, retryAfterSeconds: 0 };
  }

  return {
    limited: true,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

/** Charges one attempt against `key`, opening a fresh window if needed. */
export function recordAttempt(key: string, windowMs: number): void {
  const now = Date.now();

  if (buckets.size > SWEEP_THRESHOLD) sweep(now);

  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  bucket.count += 1;
}

/** Drops all recorded attempts. Used by tests to isolate cases. */
export function clearRateLimits(): void {
  buckets.clear();
}
