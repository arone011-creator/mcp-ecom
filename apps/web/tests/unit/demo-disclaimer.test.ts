// tests/unit/demo-disclaimer.test.ts
//
// THE HOME PAGE MUST NOT PRETEND TO BE A SHOP.
//
// It opened with "Welcome to Our Amazing Store" and "Discover incredible
// products at unbeatable prices" -- copy from a real storefront template,
// on a site where every product, price and order is invented and no
// payment is ever taken. Anyone arriving without context had nothing
// telling them otherwise, and the assistant will happily discuss those
// fictional prices as though they were real.
//
// Source-level, like navigation.test.ts: this is a fact about what the
// page says, and the page is a server component with no harness.

import { readFileSync } from 'fs';
import { join } from 'path';

const home = readFileSync(join(process.cwd(), 'app/page.tsx'), 'utf-8');

describe('the home page says what this actually is', () => {
  it('calls itself a demo', () => {
    expect(home).toMatch(/demo/i);
  });

  it('says the products and prices are not real', () => {
    expect(home).toMatch(/fictional|not real|dummy/i);
  });

  it('says no payment is taken', () => {
    expect(home).toMatch(/payment/i);
  });

  it('names what it is a demonstration OF', () => {
    // "This is a demo" on its own invites the question it should answer.
    expect(home).toMatch(/Model Context Protocol|MCP/);
  });

  it('no longer runs the stock storefront copy', () => {
    expect(home).not.toMatch(/Amazing Store/);
    expect(home).not.toMatch(/unbeatable prices/);
  });
});
