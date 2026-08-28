// tests/unit/cart-count.test.ts
//
// The header renders on every page. It previously called getCart(), which
// goes through getCartSession() and performs a cart.upsert -- a WRITE --
// plus a findMany, on every single page view. With the database in
// Singapore and the app in San Francisco that is two Pacific crossings
// per page, one of them a write, purely to render a number (finding 56).
//
// getCartItemCount is read-only: one aggregate, no upsert, and it never
// creates a cart for a visitor who does not have one.

const mockPrisma = { cartItem: { aggregate: jest.fn() } };
const mockGetCurrentSession = jest.fn();
const mockCookieGet = jest.fn();

jest.mock('@/lib/prisma', () => ({ __esModule: true, default: mockPrisma }));
jest.mock('@/lib/auth', () => ({
  getCurrentSession: (...a: unknown[]) => mockGetCurrentSession(...a),
}));
jest.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => mockCookieGet(n) }),
}));

import { getCartItemCount } from '@/server/queries/cart';

describe('getCartItemCount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.cartItem.aggregate.mockResolvedValue({ _sum: { quantity: 3 } });
  });

  it('counts by user when signed in', async () => {
    mockGetCurrentSession.mockResolvedValue({ user: { id: 'u1' } });

    await expect(getCartItemCount()).resolves.toBe(3);
    expect(mockPrisma.cartItem.aggregate).toHaveBeenCalledWith({
      _sum: { quantity: true },
      where: { cart: { userId: 'u1' } },
    });
  });

  it('counts by cart cookie when signed out', async () => {
    mockGetCurrentSession.mockResolvedValue(null);
    mockCookieGet.mockReturnValue({ value: 'sess-abc' });

    await expect(getCartItemCount()).resolves.toBe(3);
    expect(mockPrisma.cartItem.aggregate).toHaveBeenCalledWith({
      _sum: { quantity: true },
      where: { cart: { sessionId: 'sess-abc' } },
    });
  });

  it('returns zero without touching the database when there is no cart cookie', async () => {
    mockGetCurrentSession.mockResolvedValue(null);
    mockCookieGet.mockReturnValue(undefined);

    await expect(getCartItemCount()).resolves.toBe(0);
    // The old path would have created a cart row for every anonymous
    // visitor on every page.
    expect(mockPrisma.cartItem.aggregate).not.toHaveBeenCalled();
  });

  it('reports zero for an empty cart rather than null', async () => {
    mockGetCurrentSession.mockResolvedValue({ user: { id: 'u1' } });
    mockPrisma.cartItem.aggregate.mockResolvedValue({ _sum: { quantity: null } });

    await expect(getCartItemCount()).resolves.toBe(0);
  });

  it('never lets a database failure break the page it renders on', async () => {
    mockGetCurrentSession.mockResolvedValue({ user: { id: 'u1' } });
    mockPrisma.cartItem.aggregate.mockRejectedValue(new Error('pool timeout'));

    await expect(getCartItemCount()).resolves.toBe(0);
  });
});
