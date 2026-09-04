// server/actions/checkout-demo.ts
'use server';

import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/roles';
import { revalidateTag } from 'next/cache';

const TAX_RATE = 0.08;
const FLAT_SHIPPING = 9.99;

export type PlaceDemoOrderResult =
  | { success: true; orderId: string; orderNumber: string }
  | { success: false; error: string };

// Money is stored in Decimal(10,2) columns. Rounding here rather than
// letting the column truncate keeps subtotal + tax + shipping equal to
// the stored total -- 999.99 * 0.08 is 79.9992, and an unrounded total
// would disagree with the sum of its own parts.
function money(value: number): number {
  return Math.round(value * 100) / 100;
}

// The demo's stand-in for payment: a real Order, real OrderItems, real
// inventory movement, no payment provider. This is the function an MCP
// place_order tool will sit on, so it verifies the session and the stock
// before it writes anything.
export async function placeDemoOrder(
  formData: FormData
): Promise<PlaceDemoOrderResult> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Authentication required' };
    }

    const cart = await prisma.cart.findUnique({
      where: { userId: user.id },
      include: { items: { include: { product: true } } },
    });

    if (!cart || cart.items.length === 0) {
      return { success: false, error: 'Cart is empty' };
    }

    // Check every line before writing anything, so a short item on the
    // last line does not leave the earlier ones already decremented.
    for (const item of cart.items) {
      const inventory = await prisma.inventory.findUnique({
        where: { productId: item.productId },
      });
      const available = inventory?.available ?? 0;

      if (available < item.quantity) {
        return {
          success: false,
          error: `Not enough stock for ${item.product.name}`,
        };
      }
    }

    const subtotal = money(
      cart.items.reduce(
        (sum, item) => sum + Number(item.product.price) * item.quantity,
        0
      )
    );
    const tax = money(subtotal * TAX_RATE);
    const total = money(subtotal + tax + FLAT_SHIPPING);

    const order = await prisma.$transaction(async tx => {
      const created = await tx.order.create({
        data: {
          orderNumber: `ORD-${Date.now()}`,
          status: 'PENDING',
          // THE ENTIRE OPT-IN. An order created from now on has a
          // clock; every order that already exists does not, and never
          // will -- which is what keeps them from lurching to DELIVERED
          // the first time anything reads them.
          simulationStartedAt: new Date(),
          subtotal,
          tax,
          shipping: FLAT_SHIPPING,
          total,
          currency: 'USD',
          customerEmail: user.email ?? '',
          customerPhone: (formData.get('customerPhone') as string) || null,
          shippingName: formData.get('shippingName') as string,
          shippingAddress: formData.get('shippingAddress') as string,
          shippingCity: formData.get('shippingCity') as string,
          shippingState: (formData.get('shippingState') as string) || null,
          shippingZip: formData.get('shippingZip') as string,
          shippingCountry: 'US',
          shippingMethod: 'standard',
          userId: user.id,
        },
      });

      // Name, sku and price are snapshotted onto the line: an order must
      // still read correctly after the product is renamed or repriced.
      await tx.orderItem.createMany({
        data: cart.items.map(item => ({
          orderId: created.id,
          productId: item.productId,
          quantity: item.quantity,
          price: Number(item.product.price),
          productName: item.product.name,
          productSku: item.product.sku,
        })),
      });

      for (const item of cart.items) {
        const inventory = await tx.inventory.findUnique({
          where: { productId: item.productId },
        });

        if (inventory) {
          await tx.inventory.update({
            where: { productId: item.productId },
            data: {
              quantity: inventory.quantity - item.quantity,
              available: inventory.available - item.quantity,
            },
          });
        }
      }

      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      return created;
    });

    revalidateTag('cart');
    revalidateTag('orders');
    revalidateTag('products');

    return {
      success: true,
      orderId: order.id,
      orderNumber: order.orderNumber,
    };
  } catch (error) {
    console.error('Place demo order error:', error);
    return { success: false, error: 'Failed to place order' };
  }
}
