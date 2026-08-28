// File: app/(store)/checkout/checkout-form.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { placeDemoOrder } from '@/server/actions/checkout-demo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// No payment fields anywhere: this demo writes a real order and never
// touches a payment provider. Saying so on the form matters more than it
// looks -- a checkout that asks for a card number in a public demo is a
// phishing surface even when nothing is charged.
export default function CheckoutForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const result = await placeDemoOrder(new FormData(event.currentTarget));

    if (result.success) {
      router.push('/orders');
      router.refresh();
      return;
    }

    setError(result.error);
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="shippingName" className="text-sm font-medium">
          Full name
        </label>
        <Input id="shippingName" name="shippingName" required autoComplete="name" />
      </div>

      <div className="space-y-2">
        <label htmlFor="shippingAddress" className="text-sm font-medium">
          Address
        </label>
        <Input
          id="shippingAddress"
          name="shippingAddress"
          required
          autoComplete="street-address"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label htmlFor="shippingCity" className="text-sm font-medium">
            City
          </label>
          <Input
            id="shippingCity"
            name="shippingCity"
            required
            autoComplete="address-level2"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="shippingState" className="text-sm font-medium">
            State
          </label>
          <Input
            id="shippingState"
            name="shippingState"
            autoComplete="address-level1"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label htmlFor="shippingZip" className="text-sm font-medium">
            ZIP code
          </label>
          <Input
            id="shippingZip"
            name="shippingZip"
            required
            autoComplete="postal-code"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="customerPhone" className="text-sm font-medium">
            Phone
          </label>
          <Input id="customerPhone" name="customerPhone" autoComplete="tel" />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <Button type="submit" className="w-full" size="lg" disabled={pending}>
        {pending ? 'Placing order...' : 'Place order'}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        This is a demo. No payment is taken and no card details are collected.
      </p>
    </form>
  );
}
