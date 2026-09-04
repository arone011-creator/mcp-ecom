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

// A product exactly as the deployed catalogue serves one: the image is a
// SITE-RELATIVE path, not an absolute url.
const PRODUCT = {
  id: 'cmtbwxtwi000o7dfkf5kyt5g3',
  sku: 'MBA-M2-256-SG',
  name: 'MacBook Air M2',
  slug: 'macbook-air-m2',
  price: '1199.99',
  status: 'PUBLISHED',
  images: [
    {
      url: '/images/products/macbook-air-m2.svg',
      altText: 'MacBook Air M2 - Main Image',
    },
  ],
};

// AND search_products ANSWERS AN ENVELOPE, NOT A LIST. This is the shape
// the deployed app returns; the first version of this file invented a
// bare array for it and the card silently rendered nothing.
const SEARCH = { products: [PRODUCT], pagination: { page: 1 } };

const CART = {
  itemCount: 2,
  subtotal: '2399.98',
  items: [{ id: 'l1', quantity: 2, productId: PRODUCT.id, product: PRODUCT }],
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

  it('describes the products inside a search envelope', () => {
    // search_products answers {products, pagination}. Reading it as a
    // bare list is how the first version of this rendered nothing at all
    // against the real app while every test here stayed green.
    const card = describeResult('search_products', SEARCH) as {
      products: Record<string, unknown>[];
    };

    expect(card).toMatchObject({ kind: 'products' });
    expect(card.products[0]).toMatchObject({
      id: 'cmtbwxtwi000o7dfkf5kyt5g3',
      name: 'MacBook Air M2',
      slug: 'macbook-air-m2',
      price: '1199.99',
      image: '/images/products/macbook-air-m2.svg',
    });
  });

  it('describes nothing for a search envelope with no products key', () => {
    expect(describeResult('search_products', { pagination: {} })).toBeNull();
    expect(describeResult('search_products', [PRODUCT])).toBeNull();
  });

  it('describes one product from get_product, which is not an envelope', () => {
    const card = describeResult('get_product', PRODUCT) as { products: unknown[] };

    expect(card).toMatchObject({ kind: 'products' });
    expect(card.products).toHaveLength(1);
  });

  it('describes nothing for cancel_order', () => {
    // It returns the raw response of POST /cancel, whose shape has not
    // been observed here. A guess that renders a card is worse than the
    // chip alone.
    expect(describeResult('cancel_order', { ok: true })).toBeNull();
  });

  it('describes a cart', () => {
    const card = describeResult('get_cart', CART) as {
      lines: Record<string, unknown>[];
    };

    expect(card).toMatchObject({ kind: 'cart', itemCount: 2, subtotal: '2399.98' });
    expect(card.lines[0]).toMatchObject({ name: 'MacBook Air M2', quantity: 2 });
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
    const card = describeResult('search_products', {
      products: [{ id: 'p1', name: 'Lamp' }],
    }) as { products: { image: string | null }[] };

    expect(card.products[0]!.image).toBeNull();
  });

  it('keeps a site-relative image path', () => {
    // What the seeded catalogue actually serves. Requiring an absolute
    // url rejected every real product image.
    const card = describeResult('search_products', SEARCH) as {
      products: { image: string | null }[];
    };

    expect(card.products[0]!.image).toBe('/images/products/macbook-air-m2.svg');
  });

  it('refuses a protocol-relative image url', () => {
    // "//evil.example.com/x.png" looks relative and is not: it points
    // off this origin, which is the whole thing being guarded against.
    const card = describeResult('search_products', {
      products: [{ id: 'p1', name: 'Lamp', images: [{ url: '//evil.example.com/x.png' }] }],
    }) as { products: { image: string | null }[] };

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
    const card = describeResult('search_products', {
      products: [PRODUCT, 'nonsense', null],
    }) as { products: unknown[] };

    expect(card.products).toHaveLength(1);
  });

  it('never renders a url it was not given for an image', () => {
    // An image url comes out of product data an admin can edit. A
    // javascript: or data: url in an <img src> is a rendering bug with
    // teeth, so only http(s) survives.
    const card = describeResult('search_products', {
      products: [{ id: 'p1', name: 'Lamp', images: [{ url: 'javascript:alert(1)' }] }],
    }) as { products: { image: string | null }[] };

    expect(card.products[0]!.image).toBeNull();
  });
});
