// tests/unit/checkout-demo.test.ts
//
// placeDemoOrder is the demo's stand-in for a payment flow: it writes a
// real Order and OrderItems, decrements inventory and empties the cart,
// with no Stripe anywhere. It is also what an MCP place_order tool will
// ultimately sit on, so the authorisation and stock checks are tested as
// carefully as the arithmetic.

const mockPrisma: any = {
  cart: { findUnique: jest.fn() },
  order: { create: jest.fn() },
  orderItem: { createMany: jest.fn() },
  inventory: { findUnique: jest.fn(), update: jest.fn() },
  cartItem: { deleteMany: jest.fn() },
};
// Interactive transaction: hand the callback the same mock so assertions
// see every call, while still proving the work runs inside $transaction.
mockPrisma.$transaction = jest.fn((cb: any) => cb(mockPrisma));

const mockGetCurrentUser = jest.fn();

jest.mock('@/lib/prisma', () => ({ __esModule: true, default: mockPrisma }));
jest.mock('@/lib/roles', () => ({
  getCurrentUser: (...a: unknown[]) => mockGetCurrentUser(...a),
}));
jest.mock('next/cache', () => ({ revalidateTag: jest.fn() }));

import { placeDemoOrder } from '@/server/actions/checkout-demo';

const USER = { id: 'user_a', email: 'a@x.com' };

function buildForm() {
  const form = new FormData();
  form.set('shippingName', 'John Doe');
  form.set('shippingAddress', '123 Main St');
  form.set('shippingCity', 'New York');
  form.set('shippingState', 'NY');
  form.set('shippingZip', '10001');
  form.set('customerPhone', '+1234567890');
  return form;
}

function cartWith(price: number, quantity: number, available = 100) {
  mockPrisma.cart.findUnique.mockResolvedValue({
    id: 'cart_1',
    items: [
      {
        productId: 'prod_1',
        quantity,
        product: { id: 'prod_1', name: 'Runner', price, sku: 'SKU1' },
      },
    ],
  });
  mockPrisma.inventory.findUnique.mockResolvedValue({
    productId: 'prod_1',
    quantity: available,
    available,
  });
}

describe('placeDemoOrder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: any) => cb(mockPrisma));
    mockGetCurrentUser.mockResolvedValue(USER);
    mockPrisma.order.create.mockResolvedValue({
      id: 'order_1',
      orderNumber: 'ORD-1',
    });
  });

  it('refuses when there is no session', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    await expect(placeDemoOrder(buildForm())).resolves.toEqual({
      success: false,
      error: 'Authentication required',
    });
    expect(mockPrisma.order.create).not.toHaveBeenCalled();
  });

  it('refuses when the cart is empty', async () => {
    mockPrisma.cart.findUnique.mockResolvedValue({ id: 'cart_1', items: [] });
    await expect(placeDemoOrder(buildForm())).resolves.toEqual({
      success: false,
      error: 'Cart is empty',
    });
    expect(mockPrisma.order.create).not.toHaveBeenCalled();
  });

  it('refuses to oversell and creates nothing', async () => {
    cartWith(50, 5, 2);
    const result = await placeDemoOrder(buildForm());
    expect(result.success).toBe(false);
    expect(mockPrisma.order.create).not.toHaveBeenCalled();
    expect(mockPrisma.inventory.update).not.toHaveBeenCalled();
    expect(mockPrisma.cartItem.deleteMany).not.toHaveBeenCalled();
  });

  it('creates an order with 8% tax and flat 9.99 shipping', async () => {
    cartWith(50, 2);
    const result = await placeDemoOrder(buildForm());

    expect(result).toMatchObject({ success: true, orderId: 'order_1' });

    const created = mockPrisma.order.create.mock.calls[0][0].data;
    expect(created.subtotal).toBe(100);
    expect(created.tax).toBe(8);
    expect(created.shipping).toBe(9.99);
    expect(created.total).toBe(117.99);
    expect(created.status).toBe('PENDING');
    expect(created.userId).toBe('user_a');
  });

  it('rounds money to two decimals rather than carrying float noise', async () => {
    // 999.99 * 0.08 = 79.9992, which must not reach a Decimal(10,2) column
    // as-is or the stored total stops matching subtotal + tax + shipping.
    cartWith(999.99, 1);
    await placeDemoOrder(buildForm());

    const created = mockPrisma.order.create.mock.calls[0][0].data;
    expect(created.subtotal).toBe(999.99);
    expect(created.tax).toBe(80);
    expect(created.total).toBe(1089.98);
    expect(created.subtotal + created.tax + created.shipping).toBe(
      created.total
    );
  });

  it('snapshots product name, sku and price onto the order items', async () => {
    cartWith(50, 2);
    await placeDemoOrder(buildForm());

    expect(mockPrisma.orderItem.createMany).toHaveBeenCalledWith({
      data: [
        {
          orderId: 'order_1',
          productId: 'prod_1',
          quantity: 2,
          price: 50,
          productName: 'Runner',
          productSku: 'SKU1',
        },
      ],
    });
  });

  it('decrements inventory and clears the cart', async () => {
    cartWith(50, 2, 10);
    await placeDemoOrder(buildForm());

    expect(mockPrisma.inventory.update).toHaveBeenCalledWith({
      where: { productId: 'prod_1' },
      data: { quantity: 8, available: 8 },
    });
    expect(mockPrisma.cartItem.deleteMany).toHaveBeenCalledWith({
      where: { cartId: 'cart_1' },
    });
  });

  it('does everything inside a single transaction', async () => {
    cartWith(50, 2);
    await placeDemoOrder(buildForm());
    // Without this, a failure between order.create and cartItem.deleteMany
    // leaves a paid-looking order beside a cart that still has the items.
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('never records Stripe payment fields', async () => {
    cartWith(10, 1);
    await placeDemoOrder(buildForm());

    const created = mockPrisma.order.create.mock.calls[0][0].data;
    expect(created.stripePaymentIntentId).toBeUndefined();
    expect(created.stripeSessionId).toBeUndefined();
  });

  it('carries the shipping details from the form onto the order', async () => {
    cartWith(10, 1);
    await placeDemoOrder(buildForm());

    const created = mockPrisma.order.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      customerEmail: 'a@x.com',
      customerPhone: '+1234567890',
      shippingName: 'John Doe',
      shippingAddress: '123 Main St',
      shippingCity: 'New York',
      shippingState: 'NY',
      shippingZip: '10001',
    });
  });
});
