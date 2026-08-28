// tests/unit/cart-view.test.tsx
//
// The cart page used to render from a localStorage-backed provider that
// the server never wrote to, while addToCart wrote to Postgres. Items
// added to the cart were therefore invisible on /cart (finding 44). These
// tests pin the fix: the view renders whatever the server hands it.
import { render, screen } from '@testing-library/react';
import CartView, { type CartViewItem } from '@/app/(store)/cart/cart-view';

jest.mock('@/server/actions/cart', () => ({
  updateCartItem: jest.fn(),
  removeFromCart: jest.fn(),
}));
jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

function item(overrides: Partial<CartViewItem> = {}): CartViewItem {
  return {
    id: 'ci_1',
    quantity: 2,
    product: {
      id: 'p_1',
      name: 'iPhone 15 Pro',
      slug: 'iphone-15-pro',
      sku: 'IPH15PRO-128-NT',
      price: 999.99,
      stock: 25,
      images: [{ url: '/images/iphone.jpg' }],
    },
    ...overrides,
  };
}

describe('CartView', () => {
  it('renders the items the server supplied', () => {
    render(<CartView items={[item()]} totalAmount={1999.98} totalItems={2} />);

    expect(screen.getByText('iPhone 15 Pro')).toBeInTheDocument();
    expect(screen.getByText(/IPH15PRO-128-NT/)).toBeInTheDocument();
  });

  it('shows the empty state only when the server returns no items', () => {
    const { unmount } = render(
      <CartView items={[]} totalAmount={0} totalItems={0} />
    );
    expect(screen.getByText(/your cart is empty/i)).toBeInTheDocument();
    unmount();

    render(<CartView items={[item()]} totalAmount={1999.98} totalItems={2} />);
    expect(screen.queryByText(/your cart is empty/i)).not.toBeInTheDocument();
  });

  it('reports the server-supplied totals rather than recomputing from state', () => {
    render(<CartView items={[item()]} totalAmount={1999.98} totalItems={2} />);
    expect(screen.getByText(/2 items in your cart/i)).toBeInTheDocument();
    expect(screen.getByText(/Subtotal \(2 items\)/i)).toBeInTheDocument();
  });

  it('offers a route to checkout when the cart has contents', () => {
    render(<CartView items={[item()]} totalAmount={1999.98} totalItems={2} />);
    expect(
      screen.getByRole('link', { name: /proceed to checkout/i })
    ).toHaveAttribute('href', '/checkout');
  });
});
