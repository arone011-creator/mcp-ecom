// tests/integration/api-v1-cart.test.ts
//
// The cart is the first thing an agent writes to, so the rules it enforces
// are the ones that decide whether "add two of those" does something sane.
//
// These deliberately mirror server/actions/cart.ts rather than inventing a
// second set: adding increments an existing line, an unpublished product
// is not addable, and nothing may exceed available stock. A user who adds
// through the site and an agent that adds through the API must not get
// different carts.

const mockPrisma = {
  cart: { findUnique: jest.fn(), upsert: jest.fn() },
  cartItem: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
  product: { findUnique: jest.fn() },
};
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: mockPrisma }));
jest.mock('@/app/api/v1/_lib/session', () => ({ requireApiUser: jest.fn() }));
jest.mock('next/cache', () => ({ revalidateTag: jest.fn() }));

import { NextRequest } from 'next/server';
import { requireApiUser } from '@/app/api/v1/_lib/session';
import { GET, POST, DELETE } from '@/app/api/v1/cart/route';

const mockUser = requireApiUser as unknown as jest.Mock;

const USER_A = { id: 'user_a', email: 'a@x.com', role: 'USER' };

function postReq(body: unknown) {
  return new NextRequest('https://x.test/api/v1/cart', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const getReq = () => new NextRequest('https://x.test/api/v1/cart');

const deleteReq = (query = '') =>
  new NextRequest(`https://x.test/api/v1/cart${query}`, { method: 'DELETE' });

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    status: 'PUBLISHED',
    inventory: [{ available: 10 }],
    ...overrides,
  };
}

function cartWithItems(items: unknown[] = []) {
  return { id: 'cart_a', items };
}

function cartLine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ci_1',
    quantity: 2,
    productId: 'p1',
    variantId: null,
    product: { id: 'p1', name: 'Runner', slug: 'runner', price: 29.99 },
    ...overrides,
  };
}

describe('GET /api/v1/cart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser.mockResolvedValue(USER_A);
    mockPrisma.cart.findUnique.mockResolvedValue(null);
  });

  it('401s without a credential and never touches the database', async () => {
    mockUser.mockResolvedValue(null);

    expect((await GET(getReq())).status).toBe(401);
    expect(mockPrisma.cart.findUnique).not.toHaveBeenCalled();
  });

  it('reads only the authenticated user cart', async () => {
    await GET(getReq());

    expect(mockPrisma.cart.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user_a' } })
    );
  });

  it('returns an empty cart rather than 404 when none exists yet', async () => {
    const res = await GET(getReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.items).toEqual([]);
    expect(body.data.itemCount).toBe(0);
  });

  it('returns the lines with a count and subtotal', async () => {
    mockPrisma.cart.findUnique.mockResolvedValue(
      cartWithItems([cartLine(), cartLine({ id: 'ci_2', quantity: 1 })])
    );

    const body = await (await GET(getReq())).json();

    expect(body.data.items).toHaveLength(2);
    expect(body.data.itemCount).toBe(3);
    expect(body.data.subtotal).toBe('89.97');
  });

  it('reports a failure without echoing the underlying error', async () => {
    mockPrisma.cart.findUnique.mockRejectedValue(
      new Error('connection string: postgres://u:p@h')
    );

    const res = await GET(getReq());

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('postgres://');
  });
});

describe('POST /api/v1/cart: validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser.mockResolvedValue(USER_A);
    mockPrisma.product.findUnique.mockResolvedValue(product());
    mockPrisma.cart.upsert.mockResolvedValue({ id: 'cart_a' });
    mockPrisma.cartItem.findFirst.mockResolvedValue(null);
    mockPrisma.cart.findUnique.mockResolvedValue(cartWithItems());
  });

  it('401s without a credential and never writes', async () => {
    mockUser.mockResolvedValue(null);

    expect((await POST(postReq({ productId: 'p1', quantity: 1 }))).status).toBe(
      401
    );
    expect(mockPrisma.cart.upsert).not.toHaveBeenCalled();
  });

  it('400s on a malformed body', async () => {
    expect((await POST(postReq('{not json'))).status).toBe(400);
  });

  it('400s without a productId', async () => {
    expect((await POST(postReq({ quantity: 1 }))).status).toBe(400);
  });

  it.each([0, -3, 1.5, 'two', null])(
    '400s when quantity is %p',
    async (quantity) => {
      const res = await POST(postReq({ productId: 'p1', quantity }));

      expect(res.status).toBe(400);
      expect(mockPrisma.cartItem.create).not.toHaveBeenCalled();
    }
  );

  it('400s when quantity exceeds the per-line maximum', async () => {
    expect(
      (await POST(postReq({ productId: 'p1', quantity: 1000 }))).status
    ).toBe(400);
  });

  it('404s when the product does not exist', async () => {
    mockPrisma.product.findUnique.mockResolvedValue(null);

    expect((await POST(postReq({ productId: 'nope', quantity: 1 }))).status).toBe(
      404
    );
  });

  // Matches the storefront: an unpublished product is not addable, and is
  // reported the same way an absent one is.
  it('404s when the product is not published', async () => {
    mockPrisma.product.findUnique.mockResolvedValue(
      product({ status: 'DRAFT' })
    );

    expect((await POST(postReq({ productId: 'p1', quantity: 1 }))).status).toBe(
      404
    );
  });

  it('409s when the requested quantity exceeds available stock', async () => {
    mockPrisma.product.findUnique.mockResolvedValue(
      product({ inventory: [{ available: 2 }] })
    );

    const res = await POST(postReq({ productId: 'p1', quantity: 5 }));

    expect(res.status).toBe(409);
    expect(mockPrisma.cartItem.create).not.toHaveBeenCalled();
  });

  it('409s when the line total after adding would exceed available stock', async () => {
    mockPrisma.product.findUnique.mockResolvedValue(
      product({ inventory: [{ available: 5 }] })
    );
    mockPrisma.cartItem.findFirst.mockResolvedValue(cartLine({ quantity: 4 }));

    const res = await POST(postReq({ productId: 'p1', quantity: 2 }));

    expect(res.status).toBe(409);
    expect(mockPrisma.cartItem.update).not.toHaveBeenCalled();
  });

  it('409s when the product has no inventory record at all', async () => {
    mockPrisma.product.findUnique.mockResolvedValue(
      product({ inventory: [] })
    );

    expect((await POST(postReq({ productId: 'p1', quantity: 1 }))).status).toBe(
      409
    );
  });
});

describe('POST /api/v1/cart: writing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser.mockResolvedValue(USER_A);
    mockPrisma.product.findUnique.mockResolvedValue(product());
    mockPrisma.cart.upsert.mockResolvedValue({ id: 'cart_a' });
    mockPrisma.cartItem.findFirst.mockResolvedValue(null);
    mockPrisma.cart.findUnique.mockResolvedValue(cartWithItems());
  });

  it('writes to the authenticated user cart, ignoring a supplied cartId', async () => {
    await POST(
      postReq({ productId: 'p1', quantity: 2, cartId: 'cart_someone_else' })
    );

    expect(mockPrisma.cart.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user_a' } })
    );
    expect(mockPrisma.cartItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cartId: 'cart_a' }),
      })
    );
  });

  it('creates the line when the product is not in the cart yet', async () => {
    await POST(postReq({ productId: 'p1', quantity: 2 }));

    expect(mockPrisma.cartItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ productId: 'p1', quantity: 2 }),
      })
    );
  });

  // "Add two more" has to mean three when one is already there. The
  // storefront increments; an API that replaced instead would silently
  // undo whatever the user already had.
  it('increments an existing line rather than replacing it', async () => {
    mockPrisma.cartItem.findFirst.mockResolvedValue(cartLine({ quantity: 1 }));

    await POST(postReq({ productId: 'p1', quantity: 2 }));

    expect(mockPrisma.cartItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { quantity: 3 } })
    );
  });

  it('replaces the quantity when the caller asks to set it', async () => {
    mockPrisma.cartItem.findFirst.mockResolvedValue(cartLine({ quantity: 5 }));

    await POST(postReq({ productId: 'p1', quantity: 2, mode: 'set' }));

    expect(mockPrisma.cartItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { quantity: 2 } })
    );
  });

  it('rejects an unrecognised mode rather than guessing', async () => {
    expect(
      (await POST(postReq({ productId: 'p1', quantity: 1, mode: 'multiply' })))
        .status
    ).toBe(400);
  });

  it('returns the updated cart so the caller need not re-read it', async () => {
    mockPrisma.cart.findUnique.mockResolvedValue(
      cartWithItems([cartLine({ quantity: 2 })])
    );

    const body = await (await POST(postReq({ productId: 'p1', quantity: 2 }))).json();

    expect(body.data.items).toHaveLength(1);
    expect(body.data.itemCount).toBe(2);
  });

  it('reports a failure without echoing the underlying error', async () => {
    mockPrisma.product.findUnique.mockRejectedValue(
      new Error('connection string: postgres://u:p@h')
    );

    const res = await POST(postReq({ productId: 'p1', quantity: 1 }));

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('postgres://');
  });
});

describe('DELETE /api/v1/cart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser.mockResolvedValue(USER_A);
    mockPrisma.cart.findUnique.mockResolvedValue(cartWithItems([cartLine()]));
    mockPrisma.cartItem.deleteMany.mockResolvedValue({ count: 1 });
  });

  it('401s without a credential and never deletes', async () => {
    mockUser.mockResolvedValue(null);

    expect((await DELETE(deleteReq())).status).toBe(401);
    expect(mockPrisma.cartItem.deleteMany).not.toHaveBeenCalled();
  });

  it('clears only the authenticated user cart', async () => {
    await DELETE(deleteReq());

    expect(mockPrisma.cartItem.deleteMany).toHaveBeenCalledWith({
      where: { cartId: 'cart_a' },
    });
  });

  // Without this an agent asked to remove one item can only empty the
  // whole cart, which is a destructive answer to a narrow request.
  it('removes a single line when a productId is given', async () => {
    await DELETE(deleteReq('?productId=p1'));

    expect(mockPrisma.cartItem.deleteMany).toHaveBeenCalledWith({
      where: { cartId: 'cart_a', productId: 'p1' },
    });
  });

  it('is a no-op when the user has no cart', async () => {
    mockPrisma.cart.findUnique.mockResolvedValue(null);

    const res = await DELETE(deleteReq());

    expect(res.status).toBe(200);
    expect(mockPrisma.cartItem.deleteMany).not.toHaveBeenCalled();
  });

  it('reports a failure without echoing the underlying error', async () => {
    mockPrisma.cart.findUnique.mockRejectedValue(
      new Error('connection string: postgres://u:p@h')
    );

    const res = await DELETE(deleteReq());

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('postgres://');
  });
});
