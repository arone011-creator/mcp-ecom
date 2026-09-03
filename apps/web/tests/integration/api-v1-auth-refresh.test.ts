// tests/integration/api-v1-auth-refresh.test.ts
//
// POST /api/v1/auth/refresh -- a signed-in browser trades its session
// cookie for a short-lived bearer, so the chat widget can talk to the
// agent without the page ever handling a password.
//
// The test that matters most is the one the plan does not ask for: this
// route must refuse a bearer. requireApiUser accepts either a bearer or
// a cookie, and a bearer is what this route ISSUES -- wire it that way
// and the agent's own token refreshes itself forever, which undoes every
// reason the lifetime is short in the first place.
//
// Lives with the integration tests because importing a route pulls in
// next/server, and the unit project runs in jsdom with no Request global.

// getToken is faked to stand in for a session cookie; encode and decode
// stay REAL, so the token this route mints is one requireApiUser can
// actually verify.
jest.mock('next-auth/jwt', () => ({
  ...jest.requireActual('next-auth/jwt'),
  getToken: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import { POST, REFRESH_TTL_SECONDS } from '@/app/api/v1/auth/refresh/route';
import {
  DEFAULT_TTL_SECONDS,
  MIN_TTL_SECONDS,
} from '@/app/api/v1/auth/token/route';
import { GET as whoami } from '@/app/api/v1/auth/whoami/route';
import { clearRateLimits } from '@/app/api/v1/_lib/rate-limit';

const mockGetToken = getToken as unknown as jest.Mock;

const SIGNED_IN = { sub: 'user_1', email: 'customer@example.com', role: 'USER' };

function refreshRequest(init: RequestInit = {}) {
  return new NextRequest('https://example.com/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.9' },
    ...init,
  });
}

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = 'test-secret-value-for-refresh-route';
  mockGetToken.mockReset();
  clearRateLimits();
});

describe('POST /api/v1/auth/refresh', () => {
  it('refuses a caller with no session', async () => {
    mockGetToken.mockResolvedValue(null);

    expect((await POST(refreshRequest())).status).toBe(401);
  });

  it('refuses a session whose token carries no subject', async () => {
    // Everything downstream is keyed on the id; a token without one
    // cannot authorise anything and must not mint anything either.
    mockGetToken.mockResolvedValue({ email: 'x@example.com' });

    expect((await POST(refreshRequest())).status).toBe(401);
  });

  it('mints a bearer for a signed-in browser', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);

    const response = await POST(refreshRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.tokenType).toBe('Bearer');
    expect(typeof body.data.token).toBe('string');
    expect(body.data.token.length).toBeGreaterThan(0);
  });

  it('mints for fifteen minutes, not seven days', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);

    const body = await (await POST(refreshRequest())).json();

    expect(body.data.expiresIn).toBe(15 * 60);
    expect(body.data.expiresIn).not.toBe(DEFAULT_TTL_SECONDS);
  });

  it('keeps its lifetime inside the bounds the token route already agreed', () => {
    // Two routes, one idea of a sane lifetime. Asserted so they cannot
    // drift apart silently.
    expect(REFRESH_TTL_SECONDS).toBeGreaterThanOrEqual(MIN_TTL_SECONDS);
    expect(REFRESH_TTL_SECONDS).toBeLessThanOrEqual(DEFAULT_TTL_SECONDS);
  });

  it('does not return the user, because the caller already knows', async () => {
    // A route that hands back identity invites a client to trust it
    // instead of /whoami, which is the one place that resolves it.
    mockGetToken.mockResolvedValue(SIGNED_IN);

    const body = await (await POST(refreshRequest())).json();

    expect(body.data.user).toBeUndefined();
  });

  it('refuses to mint when the server has no signing secret', async () => {
    delete process.env.NEXTAUTH_SECRET;
    mockGetToken.mockResolvedValue(SIGNED_IN);

    expect((await POST(refreshRequest())).status).toBe(500);
  });
});

describe('the refresh route and passwords', () => {
  it('ignores a body carrying credentials', async () => {
    // It never reads a body at all, which is why there is nothing here
    // to bypass.
    mockGetToken.mockResolvedValue(null);

    const response = await POST(
      refreshRequest({
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'customer@example.com',
          password: 'demo1234',
        }),
      })
    );

    expect(response.status).toBe(401);
  });

  it('mints the same lifetime whether a body is present or not', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);

    const withBody = await (
      await POST(
        refreshRequest({
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password: 'demo1234', ttlSeconds: 999999 }),
        })
      )
    ).json();

    // A caller cannot lengthen its own token by asking, either.
    expect(withBody.data.expiresIn).toBe(REFRESH_TTL_SECONDS);
  });
});

describe('a token cannot refresh itself', () => {
  it('refuses a bearer token even when it is perfectly valid', async () => {
    // THE ONE THAT MATTERS. requireApiUser would accept this, and then
    // the agent's own 15-minute token could mint itself another 15
    // minutes forever -- an un-expiring token, which is precisely what
    // the short lifetime exists to prevent.
    mockGetToken.mockResolvedValue(null);

    const { encode } = jest.requireActual('next-auth/jwt');
    const bearer = await encode({
      token: SIGNED_IN,
      secret: process.env.NEXTAUTH_SECRET,
      maxAge: 900,
    });

    const response = await POST(
      refreshRequest({ headers: { authorization: `Bearer ${bearer}` } })
    );

    expect(response.status).toBe(401);
  });
});

describe('the minted token', () => {
  it('is accepted by /api/v1/auth/whoami', async () => {
    // The end-to-end point of the route: what it mints must work as a
    // credential against the API the agent will actually call.
    mockGetToken.mockResolvedValue(SIGNED_IN);

    const body = await (await POST(refreshRequest())).json();

    const identified = await whoami(
      new NextRequest('https://example.com/api/v1/auth/whoami', {
        headers: { authorization: `Bearer ${body.data.token}` },
      })
    );

    expect(identified.status).toBe(200);
    expect((await identified.json()).data.id).toBe('user_1');
  });
});

describe('the shared mint helper', () => {
  it('produces a token /whoami accepts', async () => {
    // Factored out so the refresh route and the assistant bridge cannot
    // drift about what goes into a token.
    const { mintBearer } = await import('@/app/api/v1/_lib/mint');

    const token = await mintBearer(
      { sub: 'user_9', email: 'a@b.com', role: 'USER' },
      process.env.NEXTAUTH_SECRET as string,
      REFRESH_TTL_SECONDS
    );

    const identified = await whoami(
      new NextRequest('https://example.com/api/v1/auth/whoami', {
        headers: { authorization: `Bearer ${token}` },
      })
    );

    expect(identified.status).toBe(200);
    expect((await identified.json()).data.id).toBe('user_9');
  });
});

describe('rate limiting', () => {
  it('stops a runaway client minting without bound', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);

    const statuses: number[] = [];
    for (let i = 0; i < 25; i += 1) {
      statuses.push((await POST(refreshRequest())).status);
    }

    expect(statuses).toContain(429);
    // Generous enough that a widget refreshing every fifteen minutes
    // never sees it.
    expect(statuses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(10);
  });
});
