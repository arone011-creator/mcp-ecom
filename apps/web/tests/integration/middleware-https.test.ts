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

  it('leaves a request with no x-forwarded-proto header alone (Railway private network)', async () => {
    // Railway's private network is a Wireguard tunnel straight to this
    // container -- no proxy in front to set the header at all, unlike
    // public traffic through Railway's edge, which always sets it to
    // 'http' or 'https'. Absence, not a spoofable Host value, is what
    // this depends on.
    const req = new NextRequest('http://web.railway.internal/api/v1/products', {
      headers: { host: 'web.railway.internal' },
    });

    const res = await middleware(req);

    expect(res.status).not.toBe(301);
  });

  it('still redirects a request claiming to be internal but carrying an explicit http proto', async () => {
    // A spoofed Host header alone must not be enough to skip the upgrade --
    // only genuine absence of x-forwarded-proto does that. This is the
    // regression test for the vulnerability a Host-based exception would
    // have introduced.
    const req = new NextRequest('http://web.railway.internal/api/v1/products', {
      headers: { host: 'web.railway.internal', 'x-forwarded-proto': 'http' },
    });

    const res = await middleware(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://web.railway.internal/api/v1/products'
    );
  });
});
