// app/api/v1/orders/[id]/cancel/route.ts
//
// POST /api/v1/orders/:id/cancel
//
// The first v1 route that changes anything, and the shape the rest of the
// mutations follow: resolve the caller, then hand the verified id to logic
// that re-checks ownership itself.
import type { NextRequest } from 'next/server';
import { requireApiUser } from '../../../_lib/session';
import { ok, fail } from '../../../_lib/respond';
import { withIdempotency } from '../../../_lib/idempotency';
import { cancelOrderFor } from '@/server/orders/cancel-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// cancelOrderFor reports failures as prose. Mapping them here keeps the
// HTTP vocabulary in the HTTP layer -- and keeps 409 distinct from 404,
// which matters to an agent deciding whether to retry or to give up.
//
// Unauthorized deliberately becomes 404 rather than 403. The GET route
// refuses to confirm that an order id is real when the caller does not own
// it; answering 403 here would confirm it, and there is no value in
// closing that door on one route while leaving it open on another against
// the same ids.
const STATUS_FOR_ERROR: Record<string, number> = {
  'Authentication required': 401,
  Unauthorized: 404,
  'Order not found': 404,
  'Order cannot be cancelled': 409,
  'Failed to cancel order': 500,
};

// ...and the body has to match too, or the status is the only thing that
// was ever hiding anything.
const BODY_FOR_ERROR: Record<string, string> = {
  Unauthorized: 'Order not found',
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireApiUser(req);
    if (!user?.id) return fail(401, 'Authentication required');

    const { id } = await params;

    // Keyed on the order, so a retry after a timeout replays the first
    // answer instead of cancelling something twice. Awaited rather than
    // returned: a promise returned from inside `try` escapes the catch
    // below, and that catch is what keeps a Prisma error out of the body.
    return await withIdempotency(
      req.headers.get('idempotency-key'),
      user.id,
      'order:cancel',
      { orderId: id },
      async () => {
        // The actor is the verified caller. Nothing from the body or the
        // query string is consulted -- that is the whole reason this takes
        // an explicit argument rather than being a server action.
        const result = await cancelOrderFor(user.id, id);

        if (!result.success) {
          return fail(
            STATUS_FOR_ERROR[result.error] ?? 400,
            BODY_FOR_ERROR[result.error] ?? result.error
          );
        }

        return ok({ orderId: id, status: 'CANCELLED' });
      }
    );
  } catch (error) {
    console.error('POST /api/v1/orders/[id]/cancel failed:', error);
    return fail(500, 'Failed to cancel order');
  }
}
