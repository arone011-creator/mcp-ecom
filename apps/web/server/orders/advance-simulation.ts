// server/orders/advance-simulation.ts
//
// Advancing an order's simulated lifecycle, lazily, when somebody reads it.
//
// WHY A READ WRITES. The alternative is a scheduler -- a cron service to
// keep alive for a demo -- and nobody can observe a stale status without
// reading it, so advancing at read time is indistinguishable from
// advancing on a timer. It is bounded: only rows with a clock, in a moving
// state, that are actually due.
//
// CALLED FROM FOUR PLACES, EXPLICITLY. The two account pages read through
// server/queries/orders.ts; the two /api/v1 routes query Prisma directly
// and deliberately (their comments explain why -- getUserOrders takes a
// user id it trusts and was once wrapped in unstable_cache, which served
// one customer's orders to another). A Prisma middleware would cover all
// four by hiding a write inside every query in the application. Four
// explicit calls are greppable; that would not be.

import prisma from '@/lib/prisma';
import { dueStatus } from '@/lib/orders/simulation';

/** The fields this needs. Anything wider is the caller's business. */
export interface SimulatableOrder {
  id: string;
  status: string;
  simulationStartedAt: Date | null;
  simulationPausedAt: Date | null;
  shippedAt?: Date | null;
  deliveredAt?: Date | null;
}

/**
 * Advance one order if it is due, and answer the order as it now stands.
 *
 * Returns the SAME object when nothing was due, and a copy carrying the
 * new status when something was -- so a caller can render what it was
 * given without re-reading. A page that rendered the row it read a moment
 * before the write would show a status one step behind the database.
 */
export async function advanceIfDue<T extends SimulatableOrder>(
  order: T,
  now: Date = new Date()
): Promise<T> {
  const due = dueStatus(
    order.status as never,
    order.simulationStartedAt,
    order.simulationPausedAt,
    now
  );

  if (!due) return order;

  const data: Record<string, unknown> = { status: due };
  // These columns already exist and nothing has ever set them. Stamped
  // only on the way past, and never overwritten -- a second stamp would
  // move a date the customer may already have been shown.
  if (due === 'SHIPPED' && !order.shippedAt) data.shippedAt = now;
  if (due === 'DELIVERED' && !order.deliveredAt) data.deliveredAt = now;

  try {
    await prisma.order.updateMany({
      // A COMPARE-AND-SET. Two readers racing both compute the same
      // target; the second matches no row because the first already moved
      // it. updateMany rather than update for the same reason
      // deleteConversation uses deleteMany: update throws when nothing
      // matches, and a throw here would be a read failing over a write.
      where: { id: order.id, status: order.status as never },
      data: data as never,
    });
  } catch (error) {
    // A READ MUST NOT DIE BECAUSE A COSMETIC WRITE DID. The customer is
    // looking at their order; a failed simulation tick is not a reason to
    // show them an error page. They will see the advance on the next read.
    console.error('Advancing an order simulation failed:', error);
    return order;
  }

  return { ...order, ...data } as T;
}

/** The same, for a list. Order is preserved; the caller renders it as given. */
export async function advanceAllDue<T extends SimulatableOrder>(
  orders: T[],
  now: Date = new Date()
): Promise<T[]> {
  return Promise.all(orders.map((order) => advanceIfDue(order, now)));
}
