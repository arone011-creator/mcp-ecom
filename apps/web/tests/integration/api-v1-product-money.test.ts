// tests/integration/api-v1-product-money.test.ts
//
// The same product used to come back with two different types for price:
//
//   GET /api/v1/products?q=iphone  ->  "price": 999.99     (a JSON number)
//   GET /api/v1/products/{id}      ->  "price": "999.99"   (a JSON string)
//
// searchProducts converts Decimal to Number for the storefront, which
// renders it and does arithmetic on it; getProductById does not, so there
// the Decimal reaches respond.ts and is stringified. Both are reasonable
// on their own and the pair is not: a consumer that reads a price from the
// list and compares it to one from the detail page gets a type mismatch,
// and the float has already lost the scale respond.ts went out of its way
// to preserve.
//
// Fixed in the API's view layer rather than in server/queries/products.ts.
// That module feeds the storefront too, where product-card.tsx does
// `comparePrice > price` -- with strings that becomes a lexicographic
// comparison, "999.99" > "1099.99" is true, and every sale badge inverts.
// The API is the surface that was inconsistent, so the API's own view is
// where it gets settled.

import { publicProduct, publicProducts } from '@/app/api/v1/_lib/product-view';

describe('publicProduct money fields', () => {
  it('stringifies a numeric price, as the search path produces', () => {
    const view = publicProduct({ id: 'p1', name: 'X', price: 999.99 });

    expect(view.price).toBe('999.99');
  });

  it('leaves an already-stringified price alone', () => {
    const view = publicProduct({ id: 'p1', name: 'X', price: '999.99' });

    expect(view.price).toBe('999.99');
  });

  it('renders a Decimal-like value through its own toString', () => {
    // What Prisma actually hands back on the uncached path.
    const decimal = { toFixed: () => '999.99', toString: () => '999.99' };

    const view = publicProduct({ id: 'p1', price: decimal });

    expect(view.price).toBe('999.99');
  });

  it('keeps two decimal places on a value that lost them', () => {
    // Number(10.50) is 10.5, and "10.5" is not a price.
    const view = publicProduct({ id: 'p1', price: 10.5 });

    expect(view.price).toBe('10.50');
  });

  it('normalises comparePrice the same way', () => {
    const view = publicProduct({
      id: 'p1',
      price: 999.99,
      comparePrice: 1099.9,
    });

    expect(view.comparePrice).toBe('1099.90');
  });

  it('leaves a null comparePrice null rather than inventing a zero', () => {
    const view = publicProduct({ id: 'p1', price: 999.99, comparePrice: null });

    expect(view.comparePrice).toBeNull();
  });

  it('omits a money field the query did not select', () => {
    const view = publicProduct({ id: 'p1', name: 'X' });

    expect('price' in view).toBe(false);
    expect('comparePrice' in view).toBe(false);
  });

  it('normalises prices on nested variants too', () => {
    const view = publicProduct({
      id: 'p1',
      price: 10,
      variants: [
        { id: 'v1', name: 'S', price: 12.5 },
        { id: 'v2', name: 'M', price: '13.00' },
      ],
    });

    expect(view.variants).toEqual([
      { id: 'v1', name: 'S', price: '12.50' },
      { id: 'v2', name: 'M', price: '13.00' },
    ]);
  });

  it('leaves non-money fields untouched', () => {
    const view = publicProduct({
      id: 'p1',
      name: 'X',
      slug: 'x',
      price: 1,
      tags: ['a'],
      categoryId: 'c1',
    });

    expect(view).toMatchObject({
      id: 'p1',
      name: 'X',
      slug: 'x',
      tags: ['a'],
      categoryId: 'c1',
    });
  });

  it('still drops the fields that were never public', () => {
    const view = publicProduct({
      id: 'p1',
      price: 1,
      costPrice: 400,
      barcode: '123',
      trackQuantity: true,
    });

    expect('costPrice' in view).toBe(false);
    expect('barcode' in view).toBe(false);
    expect('trackQuantity' in view).toBe(false);
  });

  it('gives every product in a list the same treatment', () => {
    const views = publicProducts([
      { id: 'p1', price: 999.99 },
      { id: 'p2', price: '10.00' },
    ]);

    expect(views.map(v => v.price)).toEqual(['999.99', '10.00']);
  });

  it('does not turn an unparseable price into NaN', () => {
    // Better to hand back what was there than to invent "NaN" as a price.
    const view = publicProduct({ id: 'p1', price: 'unavailable' });

    expect(view.price).toBe('unavailable');
  });
});
