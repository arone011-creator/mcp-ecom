// lib/orders/simulation.ts
//
// The simulated order lifecycle: what status an order is due to be.
//
// PURE. No database, no clock of its own -- `now` is a parameter, so the
// tests are a table of inputs rather than a mocked clock, the same shape
// `relativeTime` and `buildHistory` already take in this codebase.
//
// This exists because five of the seven OrderStatus values were
// unreachable: nothing in the app ever wrote CONFIRMED, PROCESSING,
// SHIPPED, DELIVERED or REFUNDED, so an order sat on PENDING forever and
// the four-step tracker could only ever light its first dot.

import type { OrderStatus } from '@prisma/client';

/**
 * The states an order moves through, in order.
 *
 * CONFIRMED IS DELIBERATELY ABSENT, and that is not a new opinion:
 * `updateOrderStatusSchema` in lib/validators.ts already omits it, and the
 * tracker keys no step on it -- so an order sitting in CONFIRMED renders
 * identically to PENDING. Advancing into it would mean a minute passing
 * with nothing visibly changing, which reads as broken.
 *
 * REFUNDED is absent for a different reason: it is the outcome of a
 * business process, not a stage of delivery.
 */
export const LADDER: OrderStatus[] = [
  'PENDING',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
];

/** One step a minute. A named constant, not a configurable knob. */
export const STEP_MS = 60_000;

/**
 * The status this order is due to be, or null if nothing is due.
 *
 * Null covers every reason not to move, and the caller treats them
 * identically because they all mean the same thing -- leave this row
 * alone:
 *
 *   - no clock (every order that predates this feature);
 *   - a status that is not on the ladder (CANCELLED, REFUNDED, CONFIRMED);
 *   - the end of the ladder;
 *   - not enough unpaused time yet;
 *   - already at, or ahead of, where the clock says it should be.
 *
 * The last of those is why this compares indexes rather than simply
 * returning the computed step: an order ahead of its clock is left alone.
 * Rewinding a customer's order would be worse than a stale one.
 */
export function dueStatus(
  status: OrderStatus,
  startedAt: Date | null,
  pausedAt: Date | null,
  now: Date
): OrderStatus | null {
  if (!startedAt) return null;

  const current = LADDER.indexOf(status);
  // Not on the ladder at all, or already at the end of it.
  if (current === -1 || current === LADDER.length - 1) return null;

  // Paused time does not count. The clock stopped when the pause began, so
  // a pause of any length advances nothing -- but a step that was already
  // owed at that instant is still owed.
  const until = pausedAt ?? now;
  const elapsed = until.getTime() - startedAt.getTime();

  const reached = Math.min(Math.floor(elapsed / STEP_MS), LADDER.length - 1);

  return reached > current ? LADDER[reached]! : null;
}
