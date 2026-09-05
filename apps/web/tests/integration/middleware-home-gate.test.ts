// tests/integration/middleware-home-gate.test.ts
//
// THE FRONT DOOR IS THE SIGN-IN PAGE UNLESS YOU ARE SIGNED IN.
//
// The site's default URL showed the storefront to anyone. That is the
// last piece of the same confusion that made the assistant's 401 read as
// a broken shop: a signed-out visitor landed on a page that looked like a
// working, signed-in storefront, with no indication of which they were.
//
// The interesting case is NOT the redirect -- it is the exact match. '/'
// cannot join the startsWith list this middleware already keeps, because
// every path on the site starts with '/', and putting it there would
// silently gate the entire application including its API routes.

jest.mock('@/lib/prisma', () => ({ __esModule: true, default: {} }));

const mockGetToken = jest.fn();

jest.mock('next-auth/jwt', () => ({
  getToken: (...args: unknown[]) => mockGetToken(...args),
}));

import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

function request(path: string) {
  return new NextRequest(`https://demo.test${path}`, {
    headers: { host: 'demo.test', 'x-forwarded-proto': 'https' },
  });
}

function signedOut() {
  mockGetToken.mockResolvedValue(null);
}

function signedIn() {
  mockGetToken.mockResolvedValue({ sub: 'u1', email: 'c@example.com' });
}

beforeEach(() => mockGetToken.mockReset());

describe('the home page when nobody is signed in', () => {
  it('sends the visitor to sign in', async () => {
    signedOut();

    const res = await middleware(request('/'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'https://demo.test/auth/signin?callbackUrl=%2F'
    );
  });

  it('remembers where they were going, so signing in lands them home', async () => {
    // Without the callback they would sign in and be dropped on the
    // profile page, which is not where they were trying to go.
    signedOut();

    const res = await middleware(request('/'));

    expect(res.headers.get('location')).toContain('callbackUrl');
  });
});

describe('the home page when a customer is signed in', () => {
  it('is shown, not redirected', async () => {
    signedIn();

    const res = await middleware(request('/'));

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });
});

describe('gating the home page gates ONLY the home page', () => {
  // THE MUST PROVE. '/' is matched exactly for a reason: in the
  // startsWith list beside it, it would match every path on the site --
  // every product page, every API route, the sign-in page itself -- and
  // the sign-in redirect would then redirect to a page that redirects.
  it.each(['/products', '/cart', '/search', '/products/aurora-smart-speaker'])(
    'leaves %s reachable while signed out',
    async (path) => {
      signedOut();

      const res = await middleware(request(path));

      expect(res.headers.get('location')).toBeNull();
    }
  );

  it('leaves the sign-in page itself reachable', async () => {
    // The one that would be fatal: a sign-in page behind a sign-in gate
    // is a site nobody can enter.
    signedOut();

    const res = await middleware(request('/auth/signin'));

    expect(res.headers.get('location')).toBeNull();
  });

  it('leaves the API alone', async () => {
    // The agent reaches /api/v1 with a bearer token and no cookie. A gate
    // that caught it would take the whole AI layer down.
    signedOut();

    const res = await middleware(request('/api/v1/products'));

    expect(res.headers.get('location')).toBeNull();
  });
});
