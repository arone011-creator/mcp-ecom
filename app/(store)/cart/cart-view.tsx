// File: app/(store)/cart/cart-view.tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Minus, Plus, Trash2, ShoppingBag, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { formatPrice } from '@/lib/utils';
import { updateCartItem, removeFromCart } from '@/server/actions/cart';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/use-toast';

export interface CartViewItem {
  id: string;
  quantity: number;
  product: {
    id: string;
    name: string;
    slug: string;
    sku: string;
    price: number;
    stock: number;
    images: Array<{ url: string }>;
  };
}

export interface CartViewProps {
  items: CartViewItem[];
  totalAmount: number;
  totalItems: number;
}

// Items arrive from the server, which reads the cart out of Postgres --
// the same rows the addToCart server action writes. This page used to
// render from a localStorage-backed provider that the server never wrote
// to, so anything added to the cart was invisible here (finding 44).
export default function CartView({
  items,
  totalAmount,
  totalItems,
}: CartViewProps) {
  const [isUpdating, setIsUpdating] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  const handleUpdateQuantity = async (itemId: string, newQuantity: number) => {
    if (newQuantity < 1) return;

    setIsUpdating(itemId);
    try {
      const formData = new FormData();
      formData.append('quantity', newQuantity.toString());
      await updateCartItem(itemId, formData);
      router.refresh();
      toast({
        title: 'Cart updated',
        description: 'Item quantity has been updated.',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update cart item.',
      });
    } finally {
      setIsUpdating(null);
    }
  };

  const handleRemoveItem = async (itemId: string, productId: string) => {
    setIsUpdating(itemId);
    try {
      const formData = new FormData();
      formData.append('productId', productId);
      await removeFromCart(formData);
      router.refresh();
      toast({
        title: 'Item removed',
        description: 'Item has been removed from your cart.',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to remove item from cart.',
      });
    } finally {
      setIsUpdating(null);
    }
  };

  if (!items.length) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="text-center">
          <ShoppingBag className="mx-auto h-24 w-24 text-muted-foreground" />
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-gray-900">
            Your cart is empty
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Looks like you haven't added anything to your cart yet.
          </p>
          <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Button asChild size="lg">
              <Link href="/products">Continue Shopping</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Home
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">
          Shopping Cart
        </h1>
        <p className="mt-2 text-lg text-muted-foreground">
          {totalItems} {totalItems === 1 ? 'item' : 'items'} in your cart
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Cart Items */}
        <div className="lg:col-span-2">
          <div className="space-y-4">
            {items.map(item => (
              <div
                key={item.id}
                className="flex items-center space-x-4 rounded-lg border p-4"
              >
                {/* Product Image */}
                <div className="flex-shrink-0">
                  <Image
                    src={
                      item.product.images[0]?.url || '/images/placeholder.png'
                    }
                    alt={item.product.name}
                    width={80}
                    height={80}
                    className="h-20 w-20 rounded-md object-cover"
                  />
                </div>

                {/* Product Details */}
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/products/${item.product.slug}`}
                    className="text-lg font-medium text-gray-900 hover:text-gray-700"
                  >
                    {item.product.name}
                  </Link>
                  <p className="mt-1 text-sm text-muted-foreground">
                    SKU: {item.product.sku}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-gray-900">
                    {formatPrice(item.product.price)}
                  </p>
                  {item.product.stock < 10 && (
                    <Badge variant="destructive" className="mt-2">
                      Only {item.product.stock} left in stock
                    </Badge>
                  )}
                </div>

                {/* Quantity Controls */}
                <div className="flex items-center space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      handleUpdateQuantity(item.id, item.quantity - 1)
                    }
                    disabled={item.quantity <= 1 || isUpdating === item.id}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <Input
                    type="number"
                    min="1"
                    max={item.product.stock}
                    value={item.quantity}
                    onChange={e => {
                      const newQuantity = parseInt(e.target.value);
                      if (
                        newQuantity > 0 &&
                        newQuantity <= item.product.stock
                      ) {
                        handleUpdateQuantity(item.id, newQuantity);
                      }
                    }}
                    className="w-16 text-center"
                    disabled={isUpdating === item.id}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      handleUpdateQuantity(item.id, item.quantity + 1)
                    }
                    disabled={
                      item.quantity >= item.product.stock ||
                      isUpdating === item.id
                    }
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>

                {/* Item Total */}
                <div className="text-right">
                  <p className="text-lg font-semibold text-gray-900">
                    {formatPrice(item.product.price * item.quantity)}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveItem(item.id, item.product.id)}
                    disabled={isUpdating === item.id}
                    className="mt-2 text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="mr-1 h-4 w-4" />
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Continue Shopping */}
          <div className="mt-8">
            <Button asChild variant="outline">
              <Link href="/products">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Continue Shopping
              </Link>
            </Button>
          </div>
        </div>

        {/* Order Summary */}
        <div className="lg:col-span-1">
          <div className="rounded-lg border bg-gray-50 p-6">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">
              Order Summary
            </h2>

            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span>Subtotal ({totalItems} items)</span>
                <span>{formatPrice(totalAmount)}</span>
              </div>

              <div className="flex justify-between text-sm">
                <span>Shipping</span>
                <span className="text-green-600">
                  {totalAmount >= 100 ? 'FREE' : formatPrice(15)}
                </span>
              </div>

              <div className="flex justify-between text-sm">
                <span>Tax</span>
                <span>{formatPrice(totalAmount * 0.08)}</span>
              </div>

              <Separator />

              <div className="flex justify-between text-lg font-semibold">
                <span>Total</span>
                <span>
                  {formatPrice(
                    totalAmount +
                      (totalAmount >= 100 ? 0 : 15) +
                      totalAmount * 0.08
                  )}
                </span>
              </div>
            </div>

            {totalAmount < 100 && (
              <div className="mt-4 rounded-md bg-blue-50 p-3">
                <p className="text-sm text-blue-700">
                  Add {formatPrice(100 - totalAmount)} more for free shipping!
                </p>
              </div>
            )}

            <Button asChild className="mt-6 w-full" size="lg">
              <Link href="/checkout">Proceed to Checkout</Link>
            </Button>

            <div className="mt-4 text-center">
              <p className="text-xs text-muted-foreground">
                Secure checkout with SSL encryption
              </p>
            </div>
          </div>

          {/* Promo Code */}
          <div className="mt-6 rounded-lg border p-4">
            <h3 className="mb-3 font-medium text-gray-900">Promo Code</h3>
            <div className="flex space-x-2">
              <Input placeholder="Enter promo code" className="flex-1" />
              <Button variant="outline">Apply</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
