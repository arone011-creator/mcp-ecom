// File: app/(account)/orders/page.tsx
import { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Package } from 'lucide-react';
import { getCurrentUser } from '@/lib/roles';
import { getOrders } from '@/server/queries/orders';
import { formatPrice, formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Your Orders',
  description: 'Every order you have placed.',
};

export const dynamic = 'force-dynamic';

// getOrders scopes to the caller unless they hold ORDER_READ_ALL, so this
// page shows the signed-in user their own orders and nobody else's.
export default async function OrdersPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/auth/signin?callbackUrl=%2Forders');
  }

  const { orders } = await getOrders();

  if (orders.length === 0) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <Package className="mx-auto mb-4 h-16 w-16 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-semibold">No orders yet</h1>
        <p className="mb-6 text-muted-foreground">
          When you place an order it will show up here.
        </p>
        <Button asChild>
          <Link href="/search">Start shopping</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="mb-8 text-3xl font-bold tracking-tight">Your orders</h1>

      <ul className="space-y-4">
        {orders.map(order => (
          <li key={order.id} className="rounded-lg border p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <Link
                  href={`/orders/${order.id}`}
                  className="text-lg font-medium hover:underline"
                >
                  {order.orderNumber}
                </Link>
                <p className="mt-1 text-sm text-muted-foreground">
                  Placed {formatDate(order.createdAt)} &middot;{' '}
                  {order.orderItems.length}{' '}
                  {order.orderItems.length === 1 ? 'item' : 'items'}
                </p>
              </div>

              <div className="text-right">
                <Badge variant="secondary">{order.status}</Badge>
                <p className="mt-2 text-lg font-semibold">
                  {formatPrice(Number(order.total))}
                </p>
              </div>
            </div>

            <ul className="mt-4 space-y-1 text-sm text-muted-foreground">
              {order.orderItems.map(item => (
                <li key={item.id}>
                  {item.productName} &times; {item.quantity}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
