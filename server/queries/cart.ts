// server/queries/cart.ts

import prisma from '@/lib/prisma';
import { cookies } from 'next/headers';
import { getCurrentSession } from '@/lib/auth';

// Read-only cart size for the header, which renders on every page.
//
// The header used to call getCart(), which routes through
// getCartSession() and performs a cart.upsert -- a write -- plus a
// findMany, on every page view. With the app in one region and the
// database in another that is two round trips per page, one of them a
// write, to render a single number. It also meant a visitor who had
// never touched the cart got a cart row created for them just by loading
// a page.
//
// This does one aggregate, creates nothing, and sets no cookie.
export async function getCartItemCount(): Promise<number> {
  try {
    const session = await getCurrentSession();

    let cart: { userId: string } | { sessionId: string };

    if (session?.user) {
      cart = { userId: session.user.id };
    } else {
      const sessionId = (await cookies()).get('cart-session')?.value;
      // No cookie means no cart has ever been created for this visitor.
      // Return zero rather than creating one.
      if (!sessionId) return 0;
      cart = { sessionId };
    }

    const result = await prisma.cartItem.aggregate({
      _sum: { quantity: true },
      where: { cart },
    });

    return result._sum.quantity ?? 0;
  } catch (error) {
    // The header renders on every page; a cart-count failure must not
    // take the whole page down with it.
    console.error('Cart count error:', error);
    return 0;
  }
}

export async function getCartItems(userId: string) {
  try {
    const cart = await prisma.cart.findUnique({
      where: { userId },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!cart) {
      // Create an empty cart if it doesn't exist
      return {
        userId,
        items: [],
      };
    }

    return cart;
  } catch (error) {
    console.error('Error fetching cart items:', error);
    throw error;
  }
}

export async function getCartTotal(userId: string): Promise<number> {
  try {
    const cart = await getCartItems(userId);
    return cart.items.reduce((total, item) => {
      return total + Number(item.product.price) * item.quantity;
    }, 0);
  } catch (error) {
    console.error('Error calculating cart total:', error);
    throw error;
  }
}

export async function clearCart(userId: string) {
  try {
    await prisma.cartItem.deleteMany({
      where: {
        cart: {
          userId,
        },
      },
    });
  } catch (error) {
    console.error('Error clearing cart:', error);
    throw error;
  }
}
