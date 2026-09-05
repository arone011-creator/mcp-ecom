// tests/unit/navigation.test.ts
//
// The header shipped as an 11-line stub rendering only a title, so a
// visitor could add to the cart but had no way to reach it except by
// typing the URL (finding 53). Meanwhile eleven components linked to
// /products, a route that did not exist (finding 25). Both are
// source-level guards; the real proof is the HTTP check on the deploy.
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const header = readFileSync(join(process.cwd(), 'components/header.tsx'), 'utf-8');

describe('site navigation', () => {
  it('the header links to the cart', () => {
    expect(header).toMatch(/href="\/cart"/);
  });

  it('the header shows a cart item count', () => {
    expect(header).toMatch(/itemCount/);
  });

  it('the header offers account links when signed in', () => {
    expect(header).toMatch(/href="\/orders"/);
  });

  it('sends a signed-out visitor to sign in when they click the wordmark', () => {
    // CHANGED 2026-09-05. The wordmark used to be an unconditional
    // href="/". A signed-out visitor clicking it landed back on a home
    // page that still looked signed in, which is the same confusion that
    // made the assistant's 401 read as a broken shop.
    expect(header).toMatch(/user \? '\/' : '\/auth\/signin'/);
  });

  it('has no separate sign-in button', () => {
    // The wordmark is the way in now. A button beside it that goes to
    // the same place is a second control for one action.
    expect(header).not.toMatch(/>Sign in</);
  });

  it('the header links to products', () => {
    expect(header).toMatch(/href="\/products"/);
  });

  it('reaches search through the search box, not a nav link', () => {
    // The box is the affordance; a link beside it labelled "Search" that
    // only opens an empty search page is a worse version of the box.
    expect(header).toMatch(/action="\/search"/);
    expect(header).not.toMatch(/href="\/search"/);
  });

  it('is more than the title-only stub it shipped as', () => {
    expect(header.split('\n').length).toBeGreaterThan(20);
  });
});

describe('linked routes exist', () => {
  // Every internal href that pages link to should resolve to a page file.
  const ROUTES: Array<[string, string]> = [
    ['/products', 'app/(store)/products/page.tsx'],
    ['/search', 'app/(store)/search/page.tsx'],
    ['/cart', 'app/(store)/cart/page.tsx'],
    ['/checkout', 'app/(store)/checkout/page.tsx'],
    ['/orders', 'app/(account)/orders/page.tsx'],
    ['/auth/signin', 'app/auth/signin/page.tsx'],
    ['/access-denied', 'app/access-denied/page.tsx'],
  ];

  it.each(ROUTES)('%s has a page', (_route, file) => {
    expect(existsSync(join(process.cwd(), file))).toBe(true);
  });

  it('the home page does not link to a category that does not exist', () => {
    const home = readFileSync(join(process.cwd(), 'app/page.tsx'), 'utf-8');
    const categories = readdirSync(join(process.cwd(), 'app/(store)/category'));
    // Only [slug] is a real segment; a hardcoded /category/<name> link is
    // only valid if that slug is seeded, which "featured" never was.
    expect(categories).toContain('[slug]');
    expect(home).not.toMatch(/href="\/category\/featured"/);
  });
});
