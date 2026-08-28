// app/api/v1/cart/route.ts
//
// GET / POST / DELETE /api/v1/cart -- always the authenticated caller's
// cart, never one named in the request.
//
// This does not reuse server/actions/cart.ts, which reaches for cookies()
// to find a guest cart. A service calling this API has no cookie jar and
// no guest identity; it has a bearer token, and the cart it means is the
// one belonging to the user that token names.
//
// The rules, though, are deliberately the same ones that module enforces:
// published products only, nothing beyond available stock, and adding to
// a line that already exists increases it. A cart assembled by an agent
// and a cart assembled in the browser have to behave identically, because
// they are the same cart.
import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { revalidateTag } from 'next/cache';
import { requireApiUser } from '../_lib/session';
import { ok, fail } from '../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_QUANTITY = 99;

type CartLine = {
  quantity: number;
  product: { price: unknown } | null;
};

async function loadCart(userId: string) {
  return prisma.cart.findUnique({
    where: { userId },
    include: {
      items: {
        // Selected rather than `include: { product: true }`, which would
        // put costPrice in the response.
        include: {
          product: {
            select: {
              id: true,
              name: true,
              slug: true,
              price: true,
              status: true,
              images: { select: { url: true, altText: true }, take: 1 },
            },
          },
        },
      },
    },
  });
}

/**
 * The cart as the caller cares about it: the lines, how many things are in
 * it, and what they come to. Computing the last two here saves every
 * client -- and every agent -- from doing money arithmetic itself.
 */
function cartView(cart: { items: CartLine[] } | null) {
  const items = cart?.items ?? [];

  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  const subtotal = items.reduce(
    (sum, item) => sum + Number(item.product?.price ?? 0) * item.quantity,
    0
  );

  return {
    items,
    itemCount,
    // Fixed to two places for the same reason the envelope stringifies
    // Decimal: floating point should not decide what someone owes.
    subtotal: subtotal.toFixed(2),
  };
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireApiUser(req);
    if (!user?.id) return fail(401, 'Authentication required');

    return ok(cartView((await loadCart(user.id)) as never));
  } catch (error) {
    console.error('GET /api/v1/cart failed:', error);
    return fail(500, 'Failed to load cart');
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireApiUser(req);
    if (!user?.id) return fail(401, 'Authentication required');

    let body: any;
    try {
      body = await req.json();
    } catch {
      return fail(400, 'Request body must be JSON');
    }

    const productId = body?.productId;
    const quantity = body?.quantity;
    const mode = body?.mode ?? 'add';

    if (typeof productId !== 'string' || productId.length === 0) {
      return fail(400, 'productId is required');
    }

    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_QUANTITY
    ) {
      return fail(
        400,
        `quantity must be a whole number between 1 and ${MAX_QUANTITY}`
      );
    }

    // Guessing at an unknown mode risks doing the opposite of what was
    // meant to someone's cart.
    if (mode !== 'add' && mode !== 'set') {
      return fail(400, "mode must be either 'add' or 'set'");
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        status: true,
        inventory: { select: { available: true } },
      },
    });

    // An unpublished product is reported exactly as an absent one, so this
    // route cannot be used to discover what is coming.
    if (!product || product.status !== 'PUBLISHED') {
      return fail(404, 'Product not found');
    }

    const available = product.inventory[0]?.available ?? 0;

    const cart = await prisma.cart.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    });

    const existing = await prisma.cartItem.findFirst({
      where: { cartId: cart.id, productId, variantId: null },
    });

    const nextQuantity =
      mode === 'set' ? quantity : (existing?.quantity ?? 0) + quantity;

    // 409 rather than 400: the request is well-formed, the world just
    // cannot satisfy it right now. An agent should re-read stock and try a
    // smaller number, not rewrite its request.
    if (nextQuantity > available) {
      return fail(
        409,
        `Only ${available} available; cart would hold ${nextQuantity}`
      );
    }

    if (existing) {
      await prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: nextQuantity },
      });
    } else {
      await prisma.cartItem.create({
        data: { cartId: cart.id, productId, quantity: nextQuantity },
      });
    }

    revalidateTag('cart');

    // Returned rather than left for a follow-up GET: an agent that has to
    // make a second call to see what it just did will sometimes not.
    return ok(cartView((await loadCart(user.id)) as never));
  } catch (error) {
    console.error('POST /api/v1/cart failed:', error);
    return fail(500, 'Failed to update cart');
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireApiUser(req);
    if (!user?.id) return fail(401, 'Authentication required');

    const cart = await loadCart(user.id);

    if (cart) {
      const productId = req.nextUrl.searchParams.get('productId');

      // Narrow when asked to: "remove the shoes" should not empty the
      // cart. Scoped to this cart's id either way, so a productId from
      // the query string can only ever reach the caller's own lines.
      await prisma.cartItem.deleteMany({
        where: productId
          ? { cartId: cart.id, productId }
          : { cartId: cart.id },
      });

      revalidateTag('cart');
    }

    return ok(cartView((await loadCart(user.id)) as never));
  } catch (error) {
    console.error('DELETE /api/v1/cart failed:', error);
    return fail(500, 'Failed to clear cart');
  }
}
