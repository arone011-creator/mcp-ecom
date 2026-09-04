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
/**
 * Whether this order has ended somewhere other than delivered.
 *
 * Exists so the order page's rendering decision is a testable function
 * rather than an expression inside a server component. It was found by a
 * mutation: removing the branch that stops the tracker drawing four dots
 * for a CANCELLED order broke no test at all, because there is no harness
 * for that page -- and "your cancelled order is on its way" is precisely
 * the sort of thing that should not be able to come back silently.
 */
export function isTerminated(status: OrderStatus): boolean {
  return status === 'CANCELLED' || status === 'REFUNDED';
}

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

/**
 * How long until this order's next step, or null if it has none coming.
 *
 * The countdown the demo panel shows. It answers "how long" where
 * dueStatus answers "what next", and it deliberately reads the same four
 * arguments by the same rules -- so the number on screen and the status
 * that eventually lands come off one clock rather than two that can drift.
 * A test pins them together: zero here must mean dueStatus has something
 * to write, and vice versa.
 *
 * FLOORED AT ZERO. A step falls due the instant this reaches zero, but the
 * status is only written when something next reads the order, so there is
 * a real gap between owing a step and having taken it. Counting on into
 * negative numbers would describe that ordinary gap as if it were a fault.
 */
export function msUntilNextStep(
  status: OrderStatus,
  startedAt: Date | null,
  pausedAt: Date | null,
  now: Date
): number | null {
  if (!startedAt) return null;

  const current = LADDER.indexOf(status);
  if (current === -1 || current === LADDER.length - 1) return null;

  // Paused time does not count, exactly as in dueStatus: the clock stopped
  // when the pause began, so the countdown stops with it.
  const until = pausedAt ?? now;
  const elapsed = until.getTime() - startedAt.getTime();

  return Math.max(0, (current + 1) * STEP_MS - elapsed);
}

/**
 * Milliseconds as `M:SS`.
 *
 * ROUNDED UP, so "0:00" appears only when the step is genuinely due.
 * Rounding down would leave 0:00 on screen for the last whole second of
 * every minute, which reads as stuck rather than as nearly there.
 */
export function formatCountdown(ms: number): string {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);

  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
