// tests/unit/product-artwork.test.ts
//
// EVERY PRODUCT THE SEED CREATES MUST HAVE ARTWORK THAT EXISTS ON DISK.
//
// The deployed site showed a grey "No Image" box on every card, because
// the database had no product_images rows at all. A missing FILE is the
// other way to arrive at the same blank card, and it is the one a test
// can catch: an image path is just a string until something asks the
// filesystem whether it resolves.
//
// Source-level, deliberately. The seed needs a database and the cards are
// server components; what is checkable here is that every path the seed
// would write points at a file that is really there.

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const seed = readFileSync(join(process.cwd(), 'prisma/seed.ts'), 'utf-8');
const migration = readFileSync(
  join(
    process.cwd(),
    'prisma/migrations/20260905160000_product_images_and_new_arrivals/migration.sql'
  ),
  'utf-8'
);

const imagePaths = Array.from(
  seed.matchAll(/'(\/images\/products\/[^']+\.svg)'/g),
  (m) => m[1] as string
);

const slugs = Array.from(
  seed.matchAll(/slug: '([a-z0-9-]+)',/g),
  (m) => m[1] as string
);

describe('product artwork', () => {
  it('the seed references some', () => {
    // Guards the regex above as much as the seed: a pattern that matched
    // nothing would make every test below pass vacuously.
    expect(imagePaths.length).toBeGreaterThan(20);
  });

  it.each([...new Set(imagePaths)])('%s exists on disk', (path) => {
    expect(existsSync(join(process.cwd(), 'public', path))).toBe(true);
  });

  it('gives every product two images, a main and an alternate', () => {
    const productSlugs = slugs.filter((s) => !['electronics', 'clothing', 'home-garden', 'smartphones', 'laptops', 'mens-clothing'].includes(s));

    for (const slug of productSlugs) {
      expect(imagePaths).toContain(`/images/products/${slug}.svg`);
      expect(imagePaths).toContain(`/images/products/${slug}-alt.svg`);
    }
  });

  it('the artwork is drawn, not a text label on a rectangle', () => {
    // The originals were a coloured rect with the product name typed on
    // it. That is a placeholder wearing an image's filename.
    const art = readFileSync(
      join(process.cwd(), 'public/images/products/aurora-smart-speaker.svg'),
      'utf-8'
    );

    expect(art).toMatch(/<linearGradient/);
    expect(art).toMatch(/<circle|<path|<rect/);
  });
});

describe('the data migration that reaches production', () => {
  it('only ever adds', () => {
    // THE MUST PROVE. This runs automatically against the deployed
    // database on the next deploy. It may create rows; it may not remove
    // or overwrite one.
    expect(migration).not.toMatch(/\bDELETE\b/i);
    expect(migration).not.toMatch(/\bDROP\b/i);
    expect(migration).not.toMatch(/\bTRUNCATE\b/i);
  });

  it('is safe to run twice', () => {
    // Every INSERT is guarded, and the one UPDATE appends a tag only
    // after checking it is absent.
    const inserts = migration.match(/INSERT INTO/g) ?? [];
    const guards = migration.match(/NOT EXISTS/g) ?? [];

    expect(inserts.length).toBeGreaterThan(0);
    expect(guards.length).toBeGreaterThanOrEqual(inserts.length);
    expect(migration).toMatch(/NOT \('featured' = ANY\("tags"\)\)/);
  });

  it('gives the new products stock, not just a listing', () => {
    // A product with no inventory row cannot say "In Stock" and
    // check_inventory reports nothing for it, so it is only half added.
    expect(migration).toMatch(/INSERT INTO "inventory"/);
  });
});
