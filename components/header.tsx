// Location: components/header.tsx
//
// This was an 11-line stub rendering only a title: no navigation, no cart
// link, no sign-in. The cart could be added to but never reached except
// by typing the URL (finding 53).
//
// A server component so the cart badge and the account link reflect the
// database and the real session rather than client state. The root layout
// is a server component, so this is passed as a child of CartProvider and
// stays on the server.
import Link from 'next/link';
import { ShoppingCart, Search, User } from 'lucide-react';
import { getCurrentUser } from '@/lib/roles';
import { getCartItemCount } from '@/server/queries/cart';
import { Button } from '@/components/ui/button';

export async function Header() {
  // getCartItemCount is a single read-only aggregate. The obvious
  // getCart() would upsert a cart row and fetch every line item on every
  // page view, purely to render this number (finding 56).
  //
  // Both are still guarded: a header failure must not take down every
  // page that renders it.
  const [user, itemCount] = await Promise.all([
    getCurrentUser().catch(() => null),
    getCartItemCount().catch(() => 0),
  ]);

  return (
    <header className="sticky top-0 z-40 border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="text-xl font-bold tracking-tight">
          MCP Commerce
        </Link>

        <nav className="ml-4 hidden items-center gap-4 text-sm sm:flex">
          <Link href="/products" className="hover:text-foreground/70">
            Products
          </Link>
          <Link href="/search" className="hover:text-foreground/70">
            Search
          </Link>
        </nav>

        <form action="/search" method="get" className="ml-auto hidden md:block">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              name="q"
              placeholder="Search products..."
              aria-label="Search products"
              className="h-9 w-56 rounded-md border bg-background pl-8 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </form>

        <div className="ml-auto flex items-center gap-1 md:ml-2">
          <Button asChild variant="ghost" size="sm" className="relative">
            <Link
              href="/cart"
              aria-label={
                itemCount > 0
                  ? `Cart, ${itemCount} ${itemCount === 1 ? 'item' : 'items'}`
                  : 'Cart, empty'
              }
            >
              <ShoppingCart className="h-5 w-5" />
              {itemCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
                  {itemCount > 99 ? '99+' : itemCount}
                </span>
              )}
            </Link>
          </Button>

          {user ? (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/orders">Orders</Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/profile" aria-label="Your profile">
                  <User className="h-5 w-5" />
                </Link>
              </Button>
            </>
          ) : (
            <Button asChild size="sm">
              <Link href="/auth/signin">Sign in</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
