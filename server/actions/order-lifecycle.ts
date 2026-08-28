// server/actions/order-lifecycle.ts
'use server';

import { getCurrentUser } from '@/lib/roles';
import { cancelOrderFor } from '@/server/orders/cancel-order';

// The storefront's entry point to cancellation: resolves who is asking
// from the session cookie, then delegates.
//
// Note what this signature does NOT take. Every export of a 'use server'
// module is reachable over HTTP with client-supplied arguments, so an
// `actingUserId` parameter here would be an open invitation to cancel
// someone else's order. The identity is established inside, never passed
// in. The rules themselves live in server/orders/cancel-order.ts so that
// the v1 API -- which authenticates by bearer token and has no cookie to
// read -- can enforce exactly the same ones.
export async function cancelOrder(orderId: string) {
  const user = await getCurrentUser();

  if (!user) {
    return { success: false, error: 'Authentication required' };
  }

  return cancelOrderFor(user.id, orderId);
}
