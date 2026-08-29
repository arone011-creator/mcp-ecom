// tests/integration/middleware-https.test.ts
//
// The production HTTPS upgrade rebuilt the destination URL from the
// pathname alone, so every query parameter was dropped on the way through.
// Railway sets x-forwarded-proto, so the redirect does not fire there --
// which is exactly why this went unnoticed. A client configured with an
// http:// base URL would have its filters silently discarded and be handed
// a full, unfiltered result set with a 200.

jest.mock('@/lib/prisma', () => ({ __esModule: true, default: {} }));

import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

const REAL_NODE_ENV = process.env.NODE_ENV;

function insecureRequest(path: string) {
  return new NextRequest(`http://demo.test${path}`, {
    headers: { host: 'demo.test', 'x-forwarded-proto': 'http' },
  });
}

describe('production HTTPS upgrade', () => {
  beforeAll(() => {
    (process.env as any).NODE_ENV = 'production';
  });

  afterAll(() => {
    (process.env as any).NODE_ENV = REAL_NODE_ENV;
  });

  it('redirects an insecure request to https', async () => {
    const res = await middleware(insecureRequest('/products'));

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://demo.test/products');
  });

  it('preserves the query string across the upgrade', async () => {
    const res = await middleware(
      insecureRequest('/api/v1/products?q=shoes&minRating=4&limit=5')
    );

    expect(res.headers.get('location')).toBe(
      'https://demo.test/api/v1/products?q=shoes&minRating=4&limit=5'
    );
  });

  it('leaves an already-secure request alone', async () => {
    const req = new NextRequest('https://demo.test/api/v1/products?q=shoes', {
      headers: { host: 'demo.test', 'x-forwarded-proto': 'https' },
    });

    const res = await middleware(req);

    expect(res.status).not.toBe(301);
  });
});
