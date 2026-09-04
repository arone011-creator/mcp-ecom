// app/api/v1/orders/[id]/route.ts
//
// GET /api/v1/orders/:id -- one order, if the caller placed it.
import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireApiUser } from '../../_lib/session';
import { ok, fail } from '../../_lib/respond';
import { publicOrder } from '../../_lib/order-view';
import { advanceIfDue } from '@/server/orders/advance-simulation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireApiUser(req);
    if (!user?.id) return fail(401, 'Authentication required');

    const { id } = await params;

    // Ownership is part of the lookup, not a check after it. findFirst
    // rather than findUnique because userId is not part of a unique
    // constraint, so Prisma will not accept it in a findUnique where.
    const order = await prisma.order.findFirst({
      where: { id, userId: user.id },
      include: {
        orderItems: {
          select: {
            productId: true,
            productName: true,
            productSku: true,
            quantity: true,
            price: true,
          },
        },
      },
    });

    // Someone else's order and a non-existent one produce the same answer.
    // A 403 would confirm the id is real, which is all an enumeration
    // attack needs.
    if (!order) return fail(404, 'Order not found');

    const advanced = await advanceIfDue(order);

    return ok(publicOrder(advanced as Record<string, unknown>));
  } catch (error) {
    console.error('GET /api/v1/orders/[id] failed:', error);
    return fail(500, 'Failed to load order');
  }
}
