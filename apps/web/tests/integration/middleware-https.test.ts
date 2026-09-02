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

  it('leaves a request from Railway\'s private network alone', async () => {
    // Confirmed live against the deployed service: Railway's private
    // network sets x-forwarded-proto to 'http', same as genuine public
    // plain-HTTP traffic -- that header alone cannot tell them apart. What
    // does: x-forwarded-for is a Unique Local Address (RFC 4193, fd00::/8)
    // only a real peer on Railway's Wireguard mesh could produce, and
    // (also confirmed live) Railway sets this from the actual connection,
    // discarding whatever a caller sends.
    const req = new NextRequest('http://web.railway.internal:8080/api/v1/products', {
      headers: {
        host: 'web.railway.internal:8080',
        'x-forwarded-proto': 'http',
        'x-forwarded-for': 'fd12:b352:dbb2:1:d000:5a:5103:eab0',
      },
    });

    const res = await middleware(req);

    expect(res.status).not.toBe(301);
  });

  it('still redirects a request claiming to be internal without a genuine private-network address', async () => {
    // A spoofed Host header, or x-forwarded-proto alone, must not be
    // enough to skip the upgrade -- only a genuine ULA in x-forwarded-for
    // does that. Regression test for the vulnerability either of the
    // weaker signals alone would have introduced.
    const req = new NextRequest('http://web.railway.internal:8080/api/v1/products', {
      headers: {
        host: 'web.railway.internal:8080',
        'x-forwarded-proto': 'http',
        'x-forwarded-for': '203.0.113.7',
      },
    });

    const res = await middleware(req);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://web.railway.internal:8080/api/v1/products'
    );
  });

  it('still redirects private-network-claiming traffic with no x-forwarded-for at all', async () => {
    const req = new NextRequest('http://web.railway.internal:8080/api/v1/products', {
      headers: {
        host: 'web.railway.internal:8080',
        'x-forwarded-proto': 'http',
      },
    });

    const res = await middleware(req);

    expect(res.status).toBe(301);
  });
});
