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
import { cancelOrderFor } from '@/server/orders/cancel-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// cancelOrderFor reports failures as prose. Mapping them here keeps the
// HTTP vocabulary in the HTTP layer -- and keeps 409 distinct from 403,
// which matters to an agent deciding whether to retry or to give up.
const STATUS_FOR_ERROR: Record<string, number> = {
  'Authentication required': 401,
  Unauthorized: 403,
  'Order not found': 404,
  'Order cannot be cancelled': 409,
  'Failed to cancel order': 500,
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireApiUser(req);
    if (!user?.id) return fail(401, 'Authentication required');

    const { id } = await params;

    // The actor is the verified caller. Nothing from the body or the query
    // string is consulted -- that is the whole reason this takes an
    // explicit argument rather than being a server action.
    const result = await cancelOrderFor(user.id, id);

    if (!result.success) {
      return fail(STATUS_FOR_ERROR[result.error] ?? 400, result.error);
    }

    return ok({ orderId: id, status: 'CANCELLED' });
  } catch (error) {
    console.error('POST /api/v1/orders/[id]/cancel failed:', error);
    return fail(500, 'Failed to cancel order');
  }
}
