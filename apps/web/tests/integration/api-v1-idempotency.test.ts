// tests/integration/api-v1-idempotency.test.ts
//
// A retry after a timeout must not do the thing twice. A client that times
// out mid-request cannot know whether the work happened; without this its
// only options are to retry and risk a second cancellation, or not to
// retry and risk none at all.
//
// The claim row is taken before the work runs, so two concurrent identical
// requests race for a unique constraint rather than both executing.

const mockPrisma = {
  idempotencyKey: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  product: { findUnique: jest.fn() },
  cart: { findUnique: jest.fn(), upsert: jest.fn() },
  cartItem: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
};
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: mockPrisma }));
jest.mock('@/app/api/v1/_lib/session', () => ({ requireApiUser: jest.fn() }));
jest.mock('next/cache', () => ({ revalidateTag: jest.fn() }));
jest.mock('@/server/orders/cancel-order', () => ({ cancelOrderFor: jest.fn() }));

import { NextRequest, NextResponse } from 'next/server';
import { withIdempotency, requestHash } from '@/app/api/v1/_lib/idempotency';
import { requireApiUser } from '@/app/api/v1/_lib/session';
import { cancelOrderFor } from '@/server/orders/cancel-order';
import { POST as cartPost } from '@/app/api/v1/cart/route';
import { POST as cancelPost } from '@/app/api/v1/orders/[id]/cancel/route';

const USER = 'user_a';
const WHERE = {
  userId_scope_key: { userId: USER, scope: 'cart:add', key: 'k1' },
};

function conflict() {
  // Prisma reports a unique-constraint violation as P2002.
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

beforeEach(() => {
  jest.clearAllMocks();
  // Prisma's methods return promises. A bare jest.fn() returns undefined,
  // which would make the wrapper look broken where the mock is.
  mockPrisma.idempotencyKey.update.mockResolvedValue({});
  mockPrisma.idempotencyKey.delete.mockResolvedValue({});
});

describe('withIdempotency', () => {
  it('runs the handler when no key header is present', async () => {
    const handler = jest.fn().mockResolvedValue(NextResponse.json({ data: 1 }));

    const res = await withIdempotency(null, USER, 'cart:add', { a: 1 }, handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    // The storefront's own fetches send no key. Requiring one would be a
    // breaking change to a shipped API for a caller that does not exist yet.
    expect(mockPrisma.idempotencyKey.create).not.toHaveBeenCalled();
  });

  it('claims the key before running the handler', async () => {
    const order: string[] = [];
    mockPrisma.idempotencyKey.create.mockImplementation(async () => {
      order.push('claim');
      return {};
    });
    const handler = jest.fn().mockImplementation(async () => {
      order.push('handler');
      return NextResponse.json({ data: 1 });
    });

    await withIdempotency('k1', USER, 'cart:add', { a: 1 }, handler);

    // Claim-then-execute, not execute-then-record: the other order leaves a
    // window where both racers are doing the work.
    expect(order).toEqual(['claim', 'handler']);
  });

  it('stores the outcome so a retry can replay it', async () => {
    mockPrisma.idempotencyKey.create.mockResolvedValue({});
    const handler = jest
      .fn()
      .mockResolvedValue(NextResponse.json({ data: { itemCount: 2 } }));

    await withIdempotency('k1', USER, 'cart:add', { a: 1 }, handler);

    expect(mockPrisma.idempotencyKey.update).toHaveBeenCalledWith({
      where: WHERE,
      data: { status: 200, response: { data: { itemCount: 2 } } },
    });
  });

  it('replays a completed key without running the handler again', async () => {
    mockPrisma.idempotencyKey.create.mockRejectedValue(conflict());
    mockPrisma.idempotencyKey.findUnique.mockResolvedValue({
      requestHash: requestHash({ a: 1 }),
      status: 200,
      response: { data: { itemCount: 2 } },
    });
    const handler = jest.fn();

    const res = await withIdempotency('k1', USER, 'cart:add', { a: 1 }, handler);

    expect(handler).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { itemCount: 2 } });
    expect(res.headers.get('idempotent-replay')).toBe('true');
  });

  it('refuses a key reused with different arguments', async () => {
    mockPrisma.idempotencyKey.create.mockRejectedValue(conflict());
    mockPrisma.idempotencyKey.findUnique.mockResolvedValue({
      requestHash: requestHash({ a: 1 }),
      status: 200,
      response: { data: 1 },
    });
    const handler = jest.fn();

    const res = await withIdempotency('k1', USER, 'cart:add', { a: 2 }, handler);

    // The binding that matters. Without it a key approved for one call can
    // be spent on another.
    expect(handler).not.toHaveBeenCalled();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Idempotency-Key was already used with different arguments',
    });
  });

  it('reports an in-flight duplicate as 409 rather than running twice', async () => {
    mockPrisma.idempotencyKey.create.mockRejectedValue(conflict());
    mockPrisma.idempotencyKey.findUnique.mockResolvedValue({
      requestHash: requestHash({ a: 1 }),
      status: 0,
      response: null,
    });
    const handler = jest.fn();

    const res = await withIdempotency('k1', USER, 'cart:add', { a: 1 }, handler);

    expect(handler).not.toHaveBeenCalled();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'A request with this Idempotency-Key is still in progress',
    });
  });

  it('releases the claim when the handler 500s, so a retry can retry', async () => {
    mockPrisma.idempotencyKey.create.mockResolvedValue({});
    const handler = jest
      .fn()
      .mockResolvedValue(NextResponse.json({ error: 'boom' }, { status: 500 }));

    await withIdempotency('k1', USER, 'cart:add', { a: 1 }, handler);

    // A 5xx is not an outcome, it is the absence of one. Storing it would
    // make every retry replay the server error forever.
    expect(mockPrisma.idempotencyKey.delete).toHaveBeenCalledWith({ where: WHERE });
    expect(mockPrisma.idempotencyKey.update).not.toHaveBeenCalled();
  });

  it('releases the claim when the handler throws', async () => {
    mockPrisma.idempotencyKey.create.mockResolvedValue({});
    const handler = jest.fn().mockRejectedValue(new Error('kaboom'));

    await expect(
      withIdempotency('k1', USER, 'cart:add', { a: 1 }, handler)
    ).rejects.toThrow('kaboom');

    expect(mockPrisma.idempotencyKey.delete).toHaveBeenCalledWith({ where: WHERE });
  });

  it('stores a 4xx, because a rejected request is a settled outcome', async () => {
    mockPrisma.idempotencyKey.create.mockResolvedValue({});
    const handler = jest
      .fn()
      .mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 409 }));

    await withIdempotency('k1', USER, 'cart:add', { a: 1 }, handler);

    expect(mockPrisma.idempotencyKey.update).toHaveBeenCalledWith({
      where: WHERE,
      data: { status: 409, response: { error: 'nope' } },
    });
  });

  it('returns the handler response itself, not a rebuilt copy', async () => {
    mockPrisma.idempotencyKey.create.mockResolvedValue({});
    const original = NextResponse.json({ data: { itemCount: 2 } });
    const handler = jest.fn().mockResolvedValue(original);

    const res = await withIdempotency('k1', USER, 'cart:add', { a: 1 }, handler);

    // Reading the body to store it must not consume it for the caller.
    expect(res).toBe(original);
    expect(await res.json()).toEqual({ data: { itemCount: 2 } });
  });

  it('scopes the claim to the caller, so two users cannot collide', async () => {
    mockPrisma.idempotencyKey.create.mockResolvedValue({});
    const handler = jest.fn().mockResolvedValue(NextResponse.json({ data: 1 }));

    await withIdempotency('k1', 'user_b', 'cart:add', { a: 1 }, handler);

    expect(mockPrisma.idempotencyKey.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user_b', scope: 'cart:add', key: 'k1' }),
    });
  });
});

describe('requestHash', () => {
  it('does not depend on key order', () => {
    expect(requestHash({ a: 1, b: 2 })).toBe(requestHash({ b: 2, a: 1 }));
  });

  it('separates different arguments', () => {
    expect(requestHash({ a: 1 })).not.toBe(requestHash({ a: 2 }));
  });

  it('separates a missing field from an explicit null', () => {
    expect(requestHash({ a: 1 })).not.toBe(requestHash({ a: 1, b: null }));
  });

  it('does not confuse a number with its string form', () => {
    expect(requestHash({ a: 1 })).not.toBe(requestHash({ a: '1' }));
  });
});

// The wrapper working in isolation does not prove either route calls it.
// Without these, withIdempotency could be dead code and every test above
// would still pass.
describe('the mutating routes are actually wired to it', () => {
  const mockUser = requireApiUser as unknown as jest.Mock;
  const mockCancel = cancelOrderFor as unknown as jest.Mock;

  beforeEach(() => {
    mockUser.mockResolvedValue({ id: USER, email: 'a@x.com', role: 'USER' });
    mockPrisma.idempotencyKey.create.mockResolvedValue({});
    mockPrisma.product.findUnique.mockResolvedValue({
      id: 'p1',
      status: 'PUBLISHED',
      inventory: [{ available: 10 }],
    });
    mockPrisma.cart.upsert.mockResolvedValue({ id: 'cart_a' });
    mockPrisma.cart.findUnique.mockResolvedValue({ id: 'cart_a', items: [] });
    mockPrisma.cartItem.findFirst.mockResolvedValue(null);
    mockPrisma.cartItem.create.mockResolvedValue({});
    mockCancel.mockResolvedValue({ success: true });
  });

  function cartRequest(key?: string) {
    return new NextRequest('https://x.test/api/v1/cart', {
      method: 'POST',
      body: JSON.stringify({ productId: 'p1', quantity: 2 }),
      headers: {
        'content-type': 'application/json',
        ...(key ? { 'idempotency-key': key } : {}),
      },
    });
  }

  it('POST /api/v1/cart claims the key it was given', async () => {
    await cartPost(cartRequest('k9'));

    expect(mockPrisma.idempotencyKey.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ key: 'k9', userId: USER, scope: 'cart:add' }),
    });
  });

  it('POST /api/v1/cart runs unguarded when no key is sent', async () => {
    await cartPost(cartRequest());

    expect(mockPrisma.idempotencyKey.create).not.toHaveBeenCalled();
    expect(mockPrisma.cartItem.create).toHaveBeenCalled();
  });

  it('a replayed cart key does not touch the cart again', async () => {
    mockPrisma.idempotencyKey.create.mockRejectedValue(conflict());
    mockPrisma.idempotencyKey.findUnique.mockResolvedValue({
      requestHash: requestHash({ productId: 'p1', quantity: 2, mode: 'add' }),
      status: 200,
      response: { data: { itemCount: 2, subtotal: '59.98', items: [] } },
    });

    const res = await cartPost(cartRequest('k9'));

    expect(res.status).toBe(200);
    expect(mockPrisma.cartItem.create).not.toHaveBeenCalled();
    expect(mockPrisma.cartItem.update).not.toHaveBeenCalled();
  });

  it('cancel claims the key it was given', async () => {
    const req = new NextRequest('https://x.test/api/v1/orders/o1/cancel', {
      method: 'POST',
      headers: { 'idempotency-key': 'k7' },
    });

    await cancelPost(req, { params: Promise.resolve({ id: 'o1' }) });

    expect(mockPrisma.idempotencyKey.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ key: 'k7', scope: 'order:cancel' }),
    });
  });

  it('a replayed cancel key never reaches cancelOrderFor', async () => {
    mockPrisma.idempotencyKey.create.mockRejectedValue(conflict());
    mockPrisma.idempotencyKey.findUnique.mockResolvedValue({
      requestHash: requestHash({ orderId: 'o1' }),
      status: 200,
      response: { data: { orderId: 'o1', status: 'CANCELLED' } },
    });

    const req = new NextRequest('https://x.test/api/v1/orders/o1/cancel', {
      method: 'POST',
      headers: { 'idempotency-key': 'k7' },
    });

    const res = await cancelPost(req, { params: Promise.resolve({ id: 'o1' }) });

    // The whole point: the second cancellation does not happen.
    expect(res.status).toBe(200);
    expect(mockCancel).not.toHaveBeenCalled();
  });
});
