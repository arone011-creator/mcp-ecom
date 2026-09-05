// tests/unit/product-query-images.test.ts
//
// A PRODUCT QUERY THAT FORGETS TO SELECT IMAGES IS INDISTINGUISHABLE
// FROM A PRODUCT THAT HAS NONE.
//
// ProductCard falls back to a grey "No Image" placeholder when a product
// carries no images. That fallback is correct, and it is also why this
// bug is invisible: the page renders, nothing errors, every card is
// simply blank. /products shipped that way -- eleven cards, all "No
// Image" -- while the home page looked perfect, because the two use
// different queries and only one of them asked for images.
//
// That is now the THIRD distinct cause of a blank product card in this
// project: no rows in the database, no file on disk, and a query that
// never asked. This test covers the third; product-artwork.test.ts
// covers the second, and the migration covers the first.
//
// Source-level, because these are cached server functions over a real
// database and what is checkable here is the shape of the query.

import { readFileSync } from 'fs';
import { join } from 'path';

const source = readFileSync(
  join(process.cwd(), 'server/queries/products.ts'),
  'utf-8'
);

const lines = source.split('\n');

/** Every product.findMany, with the name of the export it sits in. */
function findManyCalls() {
  const calls: Array<{ name: string; line: number; body: string }> = [];

  lines.forEach((line, i) => {
    if (!line.includes('product.findMany')) return;

    let name = 'unknown';
    for (let j = i; j >= 0; j--) {
      const match = /export const (\w+)/.exec(lines[j] as string);
      if (match) {
        name = match[1] as string;
        break;
      }
    }

    calls.push({ name, line: i + 1, body: lines.slice(i, i + 30).join('\n') });
  });

  return calls;
}

describe('every product query that builds a card selects its images', () => {
  const calls = findManyCalls();

  it('finds the queries at all', () => {
    // Guards the parser: a regex that matched nothing would make the
    // test below pass while checking nothing.
    expect(calls.length).toBeGreaterThan(5);
  });

  it.each(
    findManyCalls()
      // getProductTags reads nothing but the tags column -- it builds no
      // card and has no business loading images for every product.
      .filter((c) => !c.body.includes('select: { tags: true }'))
      .map((c) => [c.name, c.line, c.body] as const)
  )('%s (line %d) includes images', (_name, _line, body) => {
    expect(body).toContain('images:');
  });
});
