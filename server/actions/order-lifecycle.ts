// server/actions/order-lifecycle.ts
'use server';

import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/roles';
import { revalidateTag } from 'next/cache';

// Extracted verbatim from the Stripe-coupled checkout module before that
// module was deleted. It is the only order mutation in the codebase that
// checks who is asking, that they own the row, and that the transition is
// legal -- the deleted server/actions/orders.ts did none of those.
//
// M2's POST /api/v1/orders/[id]/cancel delegates here rather than
// reimplementing the checks.
export async function cancelOrder(orderId: string) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Authentication required' };
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { orderItems: true },
    });

    if (!order) {
      return { success: false, error: 'Order not found' };
    }

    if (order.userId !== user.id) {
      return { success: false, error: 'Unauthorized' };
    }

    if (!['PENDING', 'PROCESSING'].includes(order.status)) {
      return { success: false, error: 'Order cannot be cancelled' };
    }

    // Only a PROCESSING order holds reserved stock; a PENDING one never
    // took any, so there is nothing to give back.
    if (order.status === 'PROCESSING') {
      for (const item of order.orderItems) {
        const inventory = await prisma.inventory.findUnique({
          where: { productId: item.productId },
        });

        if (inventory) {
          await prisma.inventory.update({
            where: { productId: item.productId },
            data: {
              available: inventory.available + item.quantity,
              reserved: Math.max(0, inventory.reserved - item.quantity),
            },
          });
        }
      }
    }

    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
      },
    });

    revalidateTag('orders');
    revalidateTag('products');

    return { success: true };
  } catch (error) {
    console.error('Cancel order error:', error);
    return { success: false, error: 'Failed to cancel order' };
  }
}
