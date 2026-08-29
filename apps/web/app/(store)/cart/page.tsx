// File: app/(store)/cart/page.tsx
import { Metadata } from 'next';
import { getCart } from '@/server/actions/cart';
import CartView from './cart-view';

export const metadata: Metadata = {
  title: 'Your Cart',
  description: 'Review the items in your cart before checking out.',
};

// The cart lives in Postgres, written by the addToCart server action.
// Reading it here rather than from the client provider is what makes the
// page show what was actually added.
export const dynamic = 'force-dynamic';

export default async function CartPage() {
  const cart = await getCart();

  return (
    <CartView
      items={cart.items as never}
      totalAmount={cart.total}
      totalItems={cart.itemCount}
    />
  );
}
