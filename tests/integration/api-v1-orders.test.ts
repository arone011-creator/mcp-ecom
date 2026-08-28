// tests/integration/api-v1-orders.test.ts
//
// The cross-user denial cases are the point of this file. M1 shipped an
// order read that cached one user's orders under a shared key and returned
// them to whoever asked next; these routes exist partly to not do that
// again, and these tests are what stop a later refactor from quietly
// dropping the ownership filter.

const mockPrisma = {
  order: { findMany: jest.fn(), findFirst: jest.fn() },
};
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: mockPrisma }));

jest.mock('@/app/api/v1/_lib/session', () => ({ requireApiUser: jest.fn() }));
jest.mock('@/server/orders/cancel-order', () => ({ cancelOrderFor: jest.fn() }));

import { NextRequest } from 'next/server';
import { requireApiUser } from '@/app/api/v1/_lib/session';
import { cancelOrderFor } from '@/server/orders/cancel-order';
import { GET as listOrders } from '@/app/api/v1/orders/route';
import { GET as getOrder } from '@/app/api/v1/orders/[id]/route';
import { POST as postCancel } from '@/app/api/v1/orders/[id]/cancel/route';

const mockUser = requireApiUser as unknown as jest.Mock;
const mockCancel = cancelOrderFor as unknown as jest.Mock;

const USER_A = { id: 'user_a', email: 'a@x.com', role: 'USER' };

const req = (path: string) => new NextRequest(`https://x.test${path}`);

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order_1',
    orderNumber: 'ORD-1',
    status: 'PENDING',
    total: 59.98,
    currency: 'USD',
    customerEmail: 'a@x.com',
    userId: 'user_a',
    stripePaymentIntentId: 'pi_secret_reference',
    stripeSessionId: 'cs_secret_reference',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    orderItems: [
      { productId: 'p1', productName: 'Runner', quantity: 2, price: 29.99 },
    ],
    ...overrides,
  };
}

describe('GET /api/v1/orders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser.mockResolvedValue(USER_A);
    mockPrisma.order.findMany.mockResolvedValue([]);
  });

  it('401s without a credential and never touches the database', async () => {
    mockUser.mockResolvedValue(null);

    const res = await listOrders(req('/api/v1/orders'));

    expect(res.status).toBe(401);
    expect(mockPrisma.order.findMany).not.toHaveBeenCalled();
  });

  it('scopes the query to the authenticated user, ignoring any userId in the query string', async () => {
    await listOrders(req('/api/v1/orders?userId=user_b'));

    expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user_a' } })
    );
  });

  // Order.userId is nullable, so `where: { userId: undefined }` is not an
  // impossible filter -- to Prisma it means "no filter at all", and the
  // route would hand back every order in the system.
  it('refuses to query at all when the resolved id is empty', async () => {
    mockUser.mockResolvedValue({ ...USER_A, id: '' });

    const res = await listOrders(req('/api/v1/orders'));

    expect(res.status).toBe(401);
    expect(mockPrisma.order.findMany).not.toHaveBeenCalled();
  });

  it('returns the newest orders first', async () => {
    await listOrders(req('/api/v1/orders'));

    expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } })
    );
  });

  it('returns orders with their items', async () => {
    mockPrisma.order.findMany.mockResolvedValue([order()]);

    const body = await (await listOrders(req('/api/v1/orders'))).json();

    expect(body.data.orders).toHaveLength(1);
    expect(body.data.orders[0].orderItems[0].productName).toBe('Runner');
  });

  it('caps limit at 50', async () => {
    await listOrders(req('/api/v1/orders?limit=9999'));

    expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 })
    );
  });

  it('floors limit at 1', async () => {
    await listOrders(req('/api/v1/orders?limit=0'));

    expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 1 })
    );
  });

  it('never returns the leftover Stripe payment references', async () => {
    mockPrisma.order.findMany.mockResolvedValue([order()]);

    const raw = await (await listOrders(req('/api/v1/orders'))).text();

    expect(raw).not.toContain('pi_secret_reference');
    expect(raw).not.toContain('stripePaymentIntentId');
  });

  it('reports a failure without echoing the underlying error', async () => {
    mockPrisma.order.findMany.mockRejectedValue(
      new Error('connection string: postgres://u:p@h')
    );

    const res = await listOrders(req('/api/v1/orders'));

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('postgres://');
  });
});

describe('GET /api/v1/orders/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser.mockResolvedValue(USER_A);
  });

  const detail = (id: string) =>
    getOrder(req(`/api/v1/orders/${id}`), { params: Promise.resolve({ id }) });

  it('401s without a credential and never touches the database', async () => {
    mockUser.mockResolvedValue(null);

    expect((await detail('order_1')).status).toBe(401);
    expect(mockPrisma.order.findFirst).not.toHaveBeenCalled();
  });

  it('returns the order when the caller owns it', async () => {
    mockPrisma.order.findFirst.mockResolvedValue(order());

    const body = await (await detail('order_1')).json();

    expect(body.data.orderNumber).toBe('ORD-1');
  });

  // Ownership lives in the where clause, so someone else's order is
  // indistinguishable from one that does not exist. A 403 here would
  // confirm the id is real and turn the route into an enumeration oracle.
  it("404s rather than 403s for another user's order", async () => {
    mockPrisma.order.findFirst.mockResolvedValue(null);

    const res = await detail('order_b');

    expect(res.status).toBe(404);
    expect(mockPrisma.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'order_b', userId: 'user_a' } })
    );
  });

  it('refuses to query at all when the resolved id is empty', async () => {
    mockUser.mockResolvedValue({ ...USER_A, id: '' });

    expect((await detail('order_1')).status).toBe(401);
    expect(mockPrisma.order.findFirst).not.toHaveBeenCalled();
  });

  it('never returns the leftover Stripe payment references', async () => {
    mockPrisma.order.findFirst.mockResolvedValue(order());

    const raw = await (await detail('order_1')).text();

    expect(raw).not.toContain('cs_secret_reference');
  });

  it('reports a failure without echoing the underlying error', async () => {
    mockPrisma.order.findFirst.mockRejectedValue(
      new Error('connection string: postgres://u:p@h')
    );

    const res = await detail('order_1');

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('postgres://');
  });
});

describe('POST /api/v1/orders/[id]/cancel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser.mockResolvedValue(USER_A);
    mockCancel.mockResolvedValue({ success: true });
  });

  const cancel = (id: string) =>
    postCancel(req(`/api/v1/orders/${id}/cancel`), {
      params: Promise.resolve({ id }),
    });

  it('401s without a credential and never calls the action', async () => {
    mockUser.mockResolvedValue(null);

    const res = await cancel('order_1');

    expect(res.status).toBe(401);
    expect(mockCancel).not.toHaveBeenCalled();
  });

  // The acting user comes from the verified credential, never from the
  // request. Passing anything caller-supplied here would let one account
  // cancel another's orders.
  it('acts as the authenticated user', async () => {
    await cancel('order_1');

    expect(mockCancel).toHaveBeenCalledWith('user_a', 'order_1');
  });

  it('ignores any identity supplied in the request itself', async () => {
    await postCancel(
      req('/api/v1/orders/order_1/cancel?as=user_b&userId=user_b'),
      { params: Promise.resolve({ id: 'order_1' }) }
    );

    expect(mockCancel).toHaveBeenCalledWith('user_a', 'order_1');
  });

  it('returns 200 on success', async () => {
    expect((await cancel('order_1')).status).toBe(200);
  });

  // Someone else's order answers exactly as a non-existent one does. A 403
  // here would say "this id is real, it just is not yours" -- which is the
  // enumeration oracle the GET route deliberately refuses to be, and there
  // is no point closing that door on one route and leaving it open on
  // another against the same ids.
  it('maps an Unauthorized result to 404, not 403', async () => {
    mockCancel.mockResolvedValue({ success: false, error: 'Unauthorized' });

    expect((await cancel('order_1')).status).toBe(404);
  });

  it('maps a missing order to 404', async () => {
    mockCancel.mockResolvedValue({ success: false, error: 'Order not found' });

    expect((await cancel('order_1')).status).toBe(404);
  });

  it('answers a missing order and an unowned one identically', async () => {
    mockCancel.mockResolvedValue({ success: false, error: 'Order not found' });
    const missing = await cancel('order_1');

    mockCancel.mockResolvedValue({ success: false, error: 'Unauthorized' });
    const unowned = await cancel('order_1');

    expect(missing.status).toBe(unowned.status);
    await expect(missing.json()).resolves.toEqual(await unowned.json());
  });

  it('maps a non-cancellable status to 409', async () => {
    mockCancel.mockResolvedValue({
      success: false,
      error: 'Order cannot be cancelled',
    });

    expect((await cancel('order_1')).status).toBe(409);
  });

  it('maps an unrecognised failure to 400', async () => {
    mockCancel.mockResolvedValue({ success: false, error: 'Something else' });

    expect((await cancel('order_1')).status).toBe(400);
  });

  it('reports a thrown failure without echoing the underlying error', async () => {
    mockCancel.mockRejectedValue(
      new Error('connection string: postgres://u:p@h')
    );

    const res = await cancel('order_1');

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('postgres://');
  });
});
