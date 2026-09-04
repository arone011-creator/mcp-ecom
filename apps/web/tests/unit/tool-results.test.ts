// tests/unit/tool-results.test.ts
//
// One raw tool result in, one card model out.
//
// THE FIXTURES ARE REAL. Every payload here was read off the DEPLOYED app
// on 2026-09-04 rather than written from the Pydantic models, because the
// two disagree in exactly the way that matters: the models are snake_case
// and the wire carries the API's camelCase aliases, and money is a STRING
// all the way down.

import { describeResult } from '@/lib/assistant/tool-results';

const ORDERS = [
  {
    id: 'cmtlty4mf0006fer0zolmb6j1',
    orderNumber: 'ORD-1788458388710',
    status: 'CANCELLED',
    total: '1089.98',
    subtotal: '999.99',
    tax: '80',
    shipping: '9.99',
    currency: 'USD',
    createdAt: '2026-09-03T17:59:48.711Z',
    cancelledAt: '2026-09-03T18:00:17.415Z',
    orderItems: [
      {
        price: '999.99',
        quantity: 1,
        productId: 'cmtbwxsuk000c7dfk2g1oidir',
        productSku: 'IPH15PRO-128-NT',
        productName: 'iPhone 15 Pro',
      },
    ],
  },
];

const PRODUCTS = [
  {
    id: 'p1',
    name: 'iPhone 15 Pro',
    slug: 'iphone-15-pro',
    price: '999.99',
    status: 'ACTIVE',
    sku: 'IPH15PRO-128-NT',
    images: [{ url: 'https://cdn.example.com/a.jpg', altText: 'A phone' }],
  },
];

const CART = {
  itemCount: 2,
  subtotal: '1999.98',
  items: [{ id: 'l1', quantity: 2, productId: 'p1', product: PRODUCTS[0] }],
};

describe('describeResult', () => {
  it('describes a list of orders', () => {
    const card = describeResult('get_orders', ORDERS);

    expect(card).toMatchObject({ kind: 'orders' });
    expect((card as { orders: unknown[] }).orders).toHaveLength(1);
    expect((card as { orders: Record<string, unknown>[] }).orders[0]).toMatchObject({
      id: 'cmtlty4mf0006fer0zolmb6j1',
      orderNumber: 'ORD-1788458388710',
      status: 'CANCELLED',
      total: '1089.98',
    });
  });

  it('names what an order contains', () => {
    const card = describeResult('get_orders', ORDERS) as {
      orders: { items: unknown[] }[];
    };

    expect(card.orders[0]!.items).toEqual([
      { name: 'iPhone 15 Pro', quantity: 1, price: '999.99' },
    ]);
  });

  it('describes one order the same way as a list of one', () => {
    // get_order answers an object, get_orders an array. One card model
    // either way, so the component has one shape to render.
    const single = describeResult('get_order', ORDERS[0]);

    expect(single).toMatchObject({ kind: 'orders' });
    expect((single as { orders: unknown[] }).orders).toHaveLength(1);
  });

  it('describes a list of products', () => {
    const card = describeResult('search_products', PRODUCTS) as {
      products: Record<string, unknown>[];
    };

    expect(card).toMatchObject({ kind: 'products' });
    expect(card.products[0]).toMatchObject({
      id: 'p1',
      name: 'iPhone 15 Pro',
      slug: 'iphone-15-pro',
      price: '999.99',
      image: 'https://cdn.example.com/a.jpg',
    });
  });

  it('describes a cart', () => {
    const card = describeResult('get_cart', CART) as {
      lines: Record<string, unknown>[];
    };

    expect(card).toMatchObject({ kind: 'cart', itemCount: 2, subtotal: '1999.98' });
    expect(card.lines[0]).toMatchObject({ name: 'iPhone 15 Pro', quantity: 2 });
  });

  it('describes the cart a change answered with', () => {
    // add_to_cart and remove_from_cart answer the whole cart, so the
    // customer sees the result of their change rather than a bare "done".
    expect(describeResult('add_to_cart', CART)).toMatchObject({ kind: 'cart' });
    expect(describeResult('remove_from_cart', CART)).toMatchObject({ kind: 'cart' });
  });

  it('keeps money as the string the API sent', () => {
    // A float loses the scale: 10.50 becomes 10.5, which is not a price.
    // The API preserves it deliberately and so does this.
    const card = describeResult('get_orders', [
      { ...ORDERS[0], total: '10.50' },
    ]) as { orders: { total: string }[] };

    expect(card.orders[0]!.total).toBe('10.50');
  });

  it('describes nothing for a tool it does not know', () => {
    // Not a JSON dump. A fallback blob would be a standing invitation to
    // render a result nobody designed for, which is how untrusted content
    // reaches a screen.
    expect(describeResult('check_inventory', { inStock: true })).toBeNull();
  });

  it('describes nothing for a result of the wrong shape', () => {
    expect(describeResult('get_orders', null)).toBeNull();
    expect(describeResult('get_orders', 'nonsense')).toBeNull();
    expect(describeResult('get_orders', [])).toBeNull();
    expect(describeResult('get_cart', { nope: true })).toBeNull();
  });

  it('survives a product with no image', () => {
    // The detail route returns no images key at all.
    const card = describeResult('search_products', [
      { id: 'p1', name: 'Lamp' },
    ]) as { products: { image: string | null }[] };

    expect(card.products[0]!.image).toBeNull();
  });

  it('survives a cart line whose product was deleted', () => {
    // A deleted product leaves the line without one. Losing the whole
    // card over that would be worse than showing an incomplete line.
    const card = describeResult('get_cart', {
      itemCount: 1,
      subtotal: '0.00',
      items: [{ id: 'l1', quantity: 1, product: null }],
    }) as { lines: { name: string }[] };

    expect(card.lines[0]!.name).toBe('This product is no longer available');
  });

  it('drops an entry that is not an object', () => {
    const card = describeResult('search_products', [
      PRODUCTS[0],
      'nonsense',
      null,
    ]) as { products: unknown[] };

    expect(card.products).toHaveLength(1);
  });

  it('never renders a url it was not given for an image', () => {
    // An image url comes out of product data an admin can edit. A
    // javascript: or data: url in an <img src> is a rendering bug with
    // teeth, so only http(s) survives.
    const card = describeResult('search_products', [
      { id: 'p1', name: 'Lamp', images: [{ url: 'javascript:alert(1)' }] },
    ]) as { products: { image: string | null }[] };

    expect(card.products[0]!.image).toBeNull();
  });
});
