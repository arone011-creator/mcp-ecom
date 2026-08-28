// File: app/(store)/checkout/page.tsx
import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/roles';
import { getCart } from '@/server/actions/cart';
import { formatPrice } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import CheckoutForm from './checkout-form';

export const metadata: Metadata = {
  title: 'Checkout',
  description: 'Place your demo order. No payment is taken.',
};

export const dynamic = 'force-dynamic';

const TAX_RATE = 0.08;
const FLAT_SHIPPING = 9.99;

export default async function CheckoutPage() {
  const user = await getCurrentUser();

  // placeDemoOrder refuses anonymous callers anyway; redirecting here
  // means the visitor gets the sign-in page rather than a form that can
  // only fail on submit.
  if (!user) {
    redirect('/auth/signin?callbackUrl=%2Fcheckout');
  }

  const cart = await getCart();

  if (cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="mb-2 text-2xl font-semibold">Your cart is empty</h1>
        <p className="mb-6 text-muted-foreground">
          Add something to your cart before checking out.
        </p>
        <Button asChild>
          <Link href="/search">Find something to buy</Link>
        </Button>
      </div>
    );
  }

  const subtotal = cart.total;
  const tax = Math.round(subtotal * TAX_RATE * 100) / 100;
  const total = Math.round((subtotal + tax + FLAT_SHIPPING) * 100) / 100;

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="mb-8 text-3xl font-bold tracking-tight">Checkout</h1>

      <div className="grid gap-12 lg:grid-cols-2">
        <section>
          <h2 className="mb-4 text-lg font-semibold">Shipping details</h2>
          <CheckoutForm />
        </section>

        <section>
          <h2 className="mb-4 text-lg font-semibold">Order summary</h2>
          <div className="space-y-3 rounded-lg border p-6">
            {cart.items.map(item => (
              <div key={item.id} className="flex justify-between text-sm">
                <span>
                  {item.product.name} &times; {item.quantity}
                </span>
                <span>{formatPrice(item.product.price * item.quantity)}</span>
              </div>
            ))}

            <div className="border-t pt-3 text-sm">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>{formatPrice(subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>Tax</span>
                <span>{formatPrice(tax)}</span>
              </div>
              <div className="flex justify-between">
                <span>Shipping</span>
                <span>{formatPrice(FLAT_SHIPPING)}</span>
              </div>
            </div>

            <div className="flex justify-between border-t pt-3 text-base font-semibold">
              <span>Total</span>
              <span>{formatPrice(total)}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
