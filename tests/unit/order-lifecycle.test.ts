// tests/unit/order-lifecycle.test.ts
//
// cancelOrder is the one function worth rescuing from the Stripe-coupled
// checkout module. server/actions/orders.ts shipped a cancelOrder that
// took a raw orderId and flipped the status with no authentication, no
// ownership check and no status guard (finding 8). This is the version
// that does all three, and these tests exist so a future refactor cannot
// quietly drop one.

const mockPrisma = {
  order: { findUnique: jest.fn(), update: jest.fn() },
  inventory: { findUnique: jest.fn(), update: jest.fn() },
};
const mockGetCurrentUser = jest.fn();

jest.mock('@/lib/prisma', () => ({ __esModule: true, default: mockPrisma }));
jest.mock('@/lib/roles', () => ({
  getCurrentUser: (...args: unknown[]) => mockGetCurrentUser(...args),
}));
jest.mock('next/cache', () => ({ revalidateTag: jest.fn() }));

import { cancelOrder } from '@/server/actions/order-lifecycle';

const OWNER = { id: 'user-1', email: 'customer@example.com' };

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    userId: 'user-1',
    status: 'PENDING',
    orderItems: [],
    ...overrides,
  };
}

describe('cancelOrder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue(OWNER);
    mockPrisma.order.update.mockResolvedValue({});
  });

  it('refuses an anonymous caller', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    await expect(cancelOrder('order-1')).resolves.toEqual({
      success: false,
      error: 'Authentication required',
    });
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });

  it('reports a missing order without touching anything', async () => {
    mockPrisma.order.findUnique.mockResolvedValue(null);
    await expect(cancelOrder('nope')).resolves.toEqual({
      success: false,
      error: 'Order not found',
    });
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });

  it("refuses to cancel another user's order", async () => {
    mockPrisma.order.findUnique.mockResolvedValue(
      order({ userId: 'someone-else' })
    );
    await expect(cancelOrder('order-1')).resolves.toEqual({
      success: false,
      error: 'Unauthorized',
    });
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });

  it.each(['SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'])(
    'refuses to cancel an order that is already %s',
    async status => {
      mockPrisma.order.findUnique.mockResolvedValue(order({ status }));
      await expect(cancelOrder('order-1')).resolves.toEqual({
        success: false,
        error: 'Order cannot be cancelled',
      });
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    }
  );

  it('cancels a PENDING order and stamps cancelledAt', async () => {
    mockPrisma.order.findUnique.mockResolvedValue(order({ status: 'PENDING' }));

    await expect(cancelOrder('order-1')).resolves.toEqual({ success: true });

    expect(mockPrisma.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { status: 'CANCELLED', cancelledAt: expect.any(Date) },
    });
    // Nothing was reserved for a PENDING order, so nothing is given back.
    expect(mockPrisma.inventory.update).not.toHaveBeenCalled();
  });

  it('restores inventory when cancelling a PROCESSING order', async () => {
    mockPrisma.order.findUnique.mockResolvedValue(
      order({
        status: 'PROCESSING',
        orderItems: [{ productId: 'p1', quantity: 3 }],
      })
    );
    mockPrisma.inventory.findUnique.mockResolvedValue({
      productId: 'p1',
      available: 5,
      reserved: 4,
    });

    await expect(cancelOrder('order-1')).resolves.toEqual({ success: true });

    expect(mockPrisma.inventory.update).toHaveBeenCalledWith({
      where: { productId: 'p1' },
      data: { available: 8, reserved: 1 },
    });
  });

  it('never drives reserved stock negative', async () => {
    mockPrisma.order.findUnique.mockResolvedValue(
      order({
        status: 'PROCESSING',
        orderItems: [{ productId: 'p1', quantity: 10 }],
      })
    );
    mockPrisma.inventory.findUnique.mockResolvedValue({
      productId: 'p1',
      available: 0,
      reserved: 2,
    });

    await cancelOrder('order-1');

    expect(mockPrisma.inventory.update).toHaveBeenCalledWith({
      where: { productId: 'p1' },
      data: { available: 10, reserved: 0 },
    });
  });
});
