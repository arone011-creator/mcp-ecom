// tests/unit/result-cards.test.tsx
//
// The cards. Presentational: handed a card model from tool-results.ts and
// nothing else -- no fetching, no model prose, no raw result.

import { render, screen } from '@testing-library/react';

import { ResultCards } from '@/components/assistant/result-cards';

const PRODUCTS = {
  kind: 'products' as const,
  products: [
    {
      id: 'p1',
      name: 'iPhone 15 Pro',
      slug: 'iphone-15-pro',
      price: '999.99',
      image: 'https://cdn.example.com/a.jpg',
    },
  ],
};

const ORDERS = {
  kind: 'orders' as const,
  orders: [
    {
      id: 'o1',
      orderNumber: 'ORD-1788458388710',
      status: 'CANCELLED',
      total: '1089.98',
      createdAt: '2026-09-03T17:59:48.711Z',
      items: [{ name: 'iPhone 15 Pro', quantity: 1, price: '999.99' }],
    },
  ],
};

const CART = {
  kind: 'cart' as const,
  itemCount: 2,
  subtotal: '1999.98',
  lines: [{ id: 'l1', name: 'iPhone 15 Pro', quantity: 2, price: '999.99' }],
};

describe('ResultCards', () => {
  it('shows a product with its price', () => {
    render(<ResultCards card={PRODUCTS} />);

    expect(screen.getByText('iPhone 15 Pro')).toBeInTheDocument();
    expect(screen.getByText(/999\.99/)).toBeInTheDocument();
  });

  it('links a product to its own page', () => {
    // The point of a card over a paragraph: somewhere to go.
    render(<ResultCards card={PRODUCTS} />);

    expect(screen.getByRole('link', { name: /iPhone 15 Pro/ })).toHaveAttribute(
      'href',
      '/products/iphone-15-pro'
    );
  });

  it('does not link a product that has no slug', () => {
    // A link to /products/null is worse than no link.
    render(
      <ResultCards
        card={{
          kind: 'products',
          products: [{ ...PRODUCTS.products[0]!, slug: null }],
        }}
      />
    );

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('iPhone 15 Pro')).toBeInTheDocument();
  });

  it('shows an order with its number, status and total', () => {
    render(<ResultCards card={ORDERS} />);

    expect(screen.getByText(/ORD-1788458388710/)).toBeInTheDocument();
    expect(screen.getByText(/Cancelled/)).toBeInTheDocument();
    expect(screen.getByText(/1089\.98/)).toBeInTheDocument();
  });

  it('links an order to its own page', () => {
    render(<ResultCards card={ORDERS} />);

    expect(
      screen.getByRole('link', { name: /ORD-1788458388710/ })
    ).toHaveAttribute('href', '/orders/o1');
  });

  it('names what is in an order', () => {
    render(<ResultCards card={ORDERS} />);

    expect(screen.getByText(/iPhone 15 Pro/)).toBeInTheDocument();
  });

  it('shows a cart with its subtotal', () => {
    render(<ResultCards card={CART} />);

    expect(screen.getByText(/1999\.98/)).toBeInTheDocument();
    expect(screen.getByText(/iPhone 15 Pro/)).toBeInTheDocument();
  });

  it('says so plainly when a cart is empty', () => {
    render(
      <ResultCards
        card={{ kind: 'cart', itemCount: 0, subtotal: '0.00', lines: [] }}
      />
    );

    expect(screen.getByText(/empty/i)).toBeInTheDocument();
  });

  it('renders a product name as text, never as markup', () => {
    // A NAME COMES OUT OF PRODUCT DATA AN ADMIN CAN EDIT. The same rule
    // the chat text follows, applied where it is easy to forget because
    // the data feels like ours.
    render(
      <ResultCards
        card={{
          kind: 'products',
          products: [
            { ...PRODUCTS.products[0]!, name: '<img src=x onerror=alert(1)>' },
          ],
        }}
      />
    );

    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  it('shows no image when there is none', () => {
    render(
      <ResultCards
        card={{
          kind: 'products',
          products: [{ ...PRODUCTS.products[0]!, image: null }],
        }}
      />
    );

    expect(document.querySelector('img')).toBeNull();
  });
});
