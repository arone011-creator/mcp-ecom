// server/orders/cancel-order.ts
//
// The cancellation logic, taking its actor as an explicit argument.
//
// This deliberately does NOT live in a 'use server' module. Every export of
// one of those is reachable over HTTP with client-supplied arguments, so a
// server action that accepted an `actingUserId` would let any caller cancel
// anyone's order. Keeping the logic here means the two callers can each
// establish identity in the way that suits them --
// server/actions/order-lifecycle.ts from the session cookie, and
// app/api/v1/orders/[id]/cancel from a verified bearer token or cookie --
// while sharing one implementation of the ownership and status rules.
import prisma from '@/lib/prisma';
import { revalidateTag } from 'next/cache';

export type CancelOrderResult =
  | { success: true }
  | { success: false; error: string };

export async function cancelOrderFor(
  actingUserId: string,
  orderId: string
): Promise<CancelOrderResult> {
  try {
    // Callers must have resolved a real identity first. Falling through
    // with a blank id would compare against a nullable column below.
    if (!actingUserId) {
      return { success: false, error: 'Authentication required' };
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { orderItems: true },
    });

    if (!order) {
      return { success: false, error: 'Order not found' };
    }

    if (order.userId !== actingUserId) {
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
