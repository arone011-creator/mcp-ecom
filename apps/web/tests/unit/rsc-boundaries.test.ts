// tests/unit/rsc-boundaries.test.ts
//
// Async Server Components cannot be rendered by React Testing Library, so
// these are source-level guards. The real proof is the HTTP check in the
// task's verification step -- this test exists to keep the fix from
// silently regressing.
import { readFileSync } from 'fs';
import { join } from 'path';

const SERVER_PAGES = [
  'app/(store)/search/page.tsx',
  'app/(store)/products/[slug]/page.tsx',
  'app/(store)/category/[slug]/page.tsx',
  'app/(account)/orders/[id]/page.tsx',
];

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf-8');
}

describe('server component boundaries', () => {
  it.each(SERVER_PAGES)('%s passes no event handlers', path => {
    const source = read(path);
    if (source.includes("'use client'")) return;
    expect(source).not.toMatch(/\bon[A-Z][a-zA-Z]*=\{/);
  });

  it.each(SERVER_PAGES)('%s types its dynamic props as Promises', path => {
    const source = read(path);
    if (/\bparams:/.test(source)) {
      expect(source).toMatch(/params:\s*Promise</);
    }
    if (/\bsearchParams:/.test(source)) {
      expect(source).toMatch(/searchParams:\s*Promise</);
    }
  });

  it('search page awaits searchParams before reading properties', () => {
    const source = read('app/(store)/search/page.tsx');
    expect(source).toMatch(/await\s+searchParams/);
    expect(source).not.toMatch(/searchParams\.q\b/);
  });
});
