// app/api/v1/_lib/order-view.ts
//
// Orders are returned only to the person who placed them, so most of the
// row is fair game. Two things are not: stripePaymentIntentId and
// stripeSessionId are columns left behind when Stripe was removed in M1,
// and payment processor references are not something to hand out for no
// reason. userId is dropped as redundant -- it is always the caller.
//
// Allowlisted for the same reason products are: a column added later
// should not appear in the API by accident.

const PUBLIC_ORDER_FIELDS = [
  'id',
  'orderNumber',
  'status',
  'subtotal',
  'tax',
  'shipping',
  'discount',
  'total',
  'currency',
  'customerEmail',
  'customerPhone',
  'shippingName',
  'shippingAddress',
  'shippingCity',
  'shippingState',
  'shippingZip',
  'shippingCountry',
  'billingName',
  'billingAddress',
  'billingCity',
  'billingState',
  'billingZip',
  'billingCountry',
  'shippingMethod',
  'notes',
  'paidAt',
  'trackingNumber',
  'shippedAt',
  'deliveredAt',
  'cancelledAt',
  'createdAt',
  'updatedAt',
  'orderItems',
] as const;

export function publicOrder(
  order: Record<string, unknown>
): Record<string, unknown> {
  const view: Record<string, unknown> = {};

  for (const field of PUBLIC_ORDER_FIELDS) {
    if (field in order) view[field] = order[field];
  }

  return view;
}

export function publicOrders(
  orders: Record<string, unknown>[]
): Record<string, unknown>[] {
  return orders.map(publicOrder);
}
