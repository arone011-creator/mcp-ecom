// app/api/v1/orders/route.ts
//
// GET /api/v1/orders -- the caller's own orders, and only those.
//
// Queries Prisma directly rather than going through getUserOrders, which
// takes the user id as an argument it trusts and, in M1, was wrapped in
// unstable_cache -- caching one user's orders under a key shared with
// everyone else's.
import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireApiUser } from '../_lib/session';
import { ok, fail } from '../_lib/respond';
import { publicOrders } from '../_lib/order-view';
import { advanceAllDue } from '@/server/orders/advance-simulation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export async function GET(req: NextRequest) {
  try {
    const user = await requireApiUser(req);
    // Order.userId is nullable, which makes `where: { userId: undefined }`
    // a query for every order rather than an impossible one. Refusing a
    // blank id here is what keeps that from ever being constructed.
    if (!user?.id) return fail(401, 'Authentication required');

    const requested = Number(
      req.nextUrl.searchParams.get('limit') ?? DEFAULT_LIMIT
    );
    const limit = Math.min(
      Math.max(Number.isFinite(requested) ? Math.trunc(requested) : DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );

    const orders = await prisma.order.findMany({
      // Scoped to the verified caller. Nothing from the query string
      // reaches this clause.
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
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

    // The agent reads its customer's orders through here. A status that
    // only advanced when a human opened a web page would make the
    // assistant describe a different shop from the one on screen.
    const advanced = await advanceAllDue(orders);

    return ok({ orders: publicOrders(advanced as Record<string, unknown>[]) });
  } catch (error) {
    console.error('GET /api/v1/orders failed:', error);
    return fail(500, 'Failed to load orders');
  }
}
