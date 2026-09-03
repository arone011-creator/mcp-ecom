# M4 Storefront Task 2 - Short-Lived Tokens From a Session

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /api/v1/auth/refresh` — a signed-in browser exchanges its session cookie for a
15-minute bearer, without a password ever crossing the wire.

**Architecture:** A sibling of the existing token route that shares its secret, its clamp
bounds and its response envelope, and differs in exactly one way that matters: it reads the
session cookie **only**, never an `Authorization` header.

**Tech Stack:** Next.js route handler, next-auth `getToken`/`encode`, Jest integration project.

---

## The property this route lives or dies by, which the plan does not list

`PLAN_M4_STOREFRONT.txt` Task 2 asks for four proofs: 401 without a session, the token works
against `/whoami`, 15 minutes rather than 7 days, and the route never accepts a password.
There is a fifth, and it is the one that decides whether any of the others matter.

**The refresh route must not accept a bearer token.**

The obvious implementation calls `requireApiUser`, because every other v1 route does and it is
described in its own header as "the single identity choke point". But `requireApiUser` accepts
*either* a bearer *or* a cookie — and a bearer is exactly what this route hands out.

Wire it that way and the agent's own 15-minute token can call `/refresh` and receive a fresh
15 minutes, indefinitely. The token stops expiring. Every argument for a short lifetime —
"a token handed to an agent cannot be revoked; rotating `NEXTAUTH_SECRET` is the only kill
switch and it signs out every browser" (`token/route.ts`) — is undone by the endpoint meant to
support it.

So this route calls `getToken({ req, secret })` directly. Cookie only. A browser can refresh;
a token cannot refresh itself.

## Why it reads no request body at all

The cleanest way to prove a route never accepts a password is for it never to read a body.
Not "validates that no password is present" — never parses one. Nothing to bypass, nothing to
get wrong later, and the test is a fact about the code rather than a behaviour that could
regress.

`POST` with no body semantics is slightly unusual, and the docstring should say why.

## What it shares with the token route, and what it does not

| | `token` | `refresh` |
|---|---|---|
| Credential | email + password | session cookie |
| Lifetime | 7 days, caller may request less | **fixed 15 minutes** |
| Rate limited | by address and by account | by user id |
| Signing | `encode`, `NEXTAUTH_SECRET` | identical |
| Envelope | `ok({ token, tokenType, expiresIn, expiresAt, user })` | identical minus `user` |

The lifetime is **not** caller-controllable. `clampTtl` exists so a caller can ask for less
than the default; here there is no reason to let a caller ask for anything, and a fixed
constant is one fewer input. A test asserts the constant sits inside the shared clamp bounds,
so the two routes cannot drift into disagreeing about what a sane lifetime is.

`user` is omitted from the response: the browser calling this already knows who it is, and a
route that returns identity invites a client to trust it instead of `/whoami`.

---

## File Structure

- **Create** `apps/web/app/api/v1/auth/refresh/route.ts`
- **Create** `apps/web/tests/integration/api-v1-auth-refresh.test.ts` — integration, not unit,
  because importing a route pulls in `next/server` and the unit project runs in jsdom with no
  `Request` global. Every other route test is there for the same reason.

---

### Task 2.1: The route

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/web/tests/integration/api-v1-auth-refresh.test.ts
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

// getToken is faked to stand in for a session cookie; encode and decode
// stay REAL, so the token this route mints is a token requireApiUser can
// actually verify.
jest.mock('next-auth/jwt', () => ({
  ...jest.requireActual('next-auth/jwt'),
  getToken: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import {
  POST,
  REFRESH_TTL_SECONDS,
} from '@/app/api/v1/auth/refresh/route';
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

    const response = await POST(refreshRequest());

    expect(response.status).toBe(401);
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

  it('mints the same token whether a body is present or not', async () => {
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
```

- [ ] **Step 2: Run to verify it fails**

`npx jest --selectProjects=integration api-v1-auth-refresh`
Expected: cannot resolve `@/app/api/v1/auth/refresh/route`.

- [ ] **Step 3: Write the implementation**

```typescript
// app/api/v1/auth/refresh/route.ts
//
// POST /api/v1/auth/refresh -- a signed-in browser trades its session
// cookie for a short-lived bearer, so the chat widget can authenticate
// to the agent without the page ever handling a password.
//
// THIS ROUTE DOES NOT USE requireApiUser, and that is the whole point.
// requireApiUser accepts a bearer OR a cookie, and a bearer is what this
// route issues -- so wiring it that way would let the agent's own token
// mint itself a fresh one, forever. A token that can refresh itself does
// not expire, which undoes the only lever we have: these JWTs cannot be
// revoked, and rotating NEXTAUTH_SECRET signs out every browser.
//
// A browser may refresh. A token may not.
//
// It also never reads a request body. Not "rejects a password" -- never
// parses one. That is why there is nothing here to bypass.
import type { NextRequest } from 'next/server';
import { encode, getToken } from 'next-auth/jwt';

import { ok, fail } from '../../_lib/respond';
import { isRateLimited, recordAttempt } from '../../_lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Long enough to hold a conversation, short enough that a leaked token
// is stale before it is useful. Deliberately not caller-controllable:
// clampTtl exists so a caller can ask for LESS than a long default, and
// here there is no default worth shortening.
export const REFRESH_TTL_SECONDS = 15 * 60;

const MINT_WINDOW_MS = 5 * 60 * 1000;
// A widget refreshing on a fifteen-minute token will never approach
// this; a client stuck in a loop hits it immediately.
const MINT_LIMIT = 20;

export async function POST(req: NextRequest) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    // Minting against a missing secret produces a token nothing can
    // verify. Loudly broken beats quietly issuing junk -- the same call
    // the token route makes.
    return fail(500, 'Server is not configured to issue tokens');
  }

  // Cookie only. See the header: getToken rather than requireApiUser is
  // the security property this route is built around.
  const session = await getToken({ req, secret });
  if (!session?.sub) return fail(401, 'Authentication required');

  const key = `refresh:user:${session.sub}`;
  const verdict = isRateLimited(key, MINT_LIMIT, MINT_WINDOW_MS);
  if (verdict.limited) {
    const response = fail(429, 'Too many refreshes. Try again shortly.');
    response.headers.set('retry-after', String(verdict.retryAfterSeconds));
    return response;
  }
  recordAttempt(key, MINT_WINDOW_MS);

  const token = await encode({
    token: {
      sub: session.sub,
      email: session.email,
      role: session.role,
    },
    secret,
    maxAge: REFRESH_TTL_SECONDS,
  });

  return ok({
    token,
    tokenType: 'Bearer',
    expiresIn: REFRESH_TTL_SECONDS,
    expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000).toISOString(),
  });
}
```

- [ ] **Step 4: Run to verify it passes**, then the whole suite —
  `npx jest --selectProjects=integration` and `npx tsc --noEmit`. This task adds files and
  modifies none, so nothing existing may break.

- [ ] **Step 5: Commit.**

---

### Task 2.2: Record it

- [ ] **Mark Task 2 done** in `docs/PLAN_M4_STOREFRONT.txt`, recording the fifth property —
  that the route refuses a bearer, why `requireApiUser` is deliberately not used, and that a
  future reader "tidying" this route to match the others would silently create an un-expiring
  token.

---

## Self-Review

**Spec coverage.** The plan's four proofs map to: 401 without a session (`refuses a caller
with no session`), accepted by `/whoami` (`the minted token` block), 15 minutes not 7 days
(`mints for fifteen minutes`), and never accepts a password (`the refresh route and
passwords`). The fifth, unlisted, is `a token cannot refresh itself`.

**Placeholders.** None. Every step carries its code.

**Type consistency.** `REFRESH_TTL_SECONDS` is exported and asserted against
`MIN_TTL_SECONDS`/`DEFAULT_TTL_SECONDS` from the token route, so the two cannot drift.
Response shape matches `ok()`'s envelope, minus `user`.

**One thing carried, not solved.** `isRateLimited` is in-process, so the limit is per replica
— the same limitation the token route's limiter and the MCP server's nonce store already
document. It bounds a runaway client, which is what it is for; it is not a defence against a
distributed one.
