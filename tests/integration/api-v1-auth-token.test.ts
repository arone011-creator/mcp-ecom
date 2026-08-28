// tests/integration/api-v1-auth-token.test.ts
//
// POST /api/v1/auth/token is what makes bearer auth usable: without it the
// only way to obtain a token is to scrape a browser's session cookie, which
// no MCP server or script can do. It is also the one route that accepts a
// password, so it carries the enumeration, timing and brute-force defences.

const mockPrisma = { user: { findUnique: jest.fn() } };
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: mockPrisma }));

const mockCompare = jest.fn();
jest.mock('bcryptjs', () => ({
  __esModule: true,
  default: { compare: (...args: unknown[]) => mockCompare(...args) },
  compare: (...args: unknown[]) => mockCompare(...args),
}));

import { NextRequest } from 'next/server';
import { encode } from 'next-auth/jwt';
import { POST } from '@/app/api/v1/auth/token/route';
import { clearRateLimits } from '@/app/api/v1/_lib/rate-limit';

const mockEncode = encode as unknown as jest.Mock;

const USER = {
  id: 'user_1',
  email: 'demo@example.com',
  name: 'Demo User',
  role: 'USER',
  password: '$2a$12$hashed',
};

function tokenRequest(body: unknown, ip = '203.0.113.1') {
  return new NextRequest('https://example.com/api/v1/auth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const GOOD = { email: 'demo@example.com', password: 'demo1234' };

describe('POST /api/v1/auth/token', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearRateLimits();
    (process.env as any).NEXTAUTH_SECRET = 'test-secret';
    mockPrisma.user.findUnique.mockResolvedValue(USER);
    mockCompare.mockResolvedValue(true);
    mockEncode.mockResolvedValue('minted.token.value');
  });

  it('returns a bearer token for valid credentials', async () => {
    const res = await POST(tokenRequest(GOOD));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.token).toBe('minted.token.value');
    expect(body.data.tokenType).toBe('Bearer');
  });

  it('mints a token carrying the subject, email and role the API reads back', async () => {
    await POST(tokenRequest(GOOD));

    expect(mockEncode).toHaveBeenCalledWith(
      expect.objectContaining({
        token: { sub: 'user_1', email: 'demo@example.com', role: 'USER' },
        secret: 'test-secret',
      })
    );
  });

  it('scopes the token to a shorter life than the 30-day browser session', async () => {
    await POST(tokenRequest(GOOD));

    const { maxAge } = mockEncode.mock.calls[0][0];
    expect(maxAge).toBe(7 * 24 * 60 * 60);
    expect(maxAge).toBeLessThan(30 * 24 * 60 * 60);
  });

  it('reports when the token expires', async () => {
    const body = await (await POST(tokenRequest(GOOD))).json();

    expect(body.data.expiresIn).toBe(7 * 24 * 60 * 60);
    expect(Date.parse(body.data.expiresAt)).toBeGreaterThan(Date.now());
  });

  it('returns the identity the token belongs to', async () => {
    const body = await (await POST(tokenRequest(GOOD))).json();

    expect(body.data.user).toEqual({
      id: 'user_1',
      email: 'demo@example.com',
      name: 'Demo User',
      role: 'USER',
    });
  });

  it('never returns the password hash', async () => {
    const raw = await (await POST(tokenRequest(GOOD))).text();

    expect(raw).not.toContain('$2a$12$hashed');
    expect(raw).not.toContain('password');
  });

  it('marks the response no-store so the token is never cached', async () => {
    const res = await POST(tokenRequest(GOOD));

    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('looks the user up by lower-cased, trimmed email', async () => {
    await POST(tokenRequest({ ...GOOD, email: '  DEMO@Example.COM  ' }));

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'demo@example.com' } })
    );
  });
});

describe('POST /api/v1/auth/token: rejection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearRateLimits();
    (process.env as any).NEXTAUTH_SECRET = 'test-secret';
    mockPrisma.user.findUnique.mockResolvedValue(USER);
    mockCompare.mockResolvedValue(true);
    mockEncode.mockResolvedValue('minted.token.value');
  });

  // An unknown address and a wrong password must be indistinguishable, or
  // the endpoint becomes a way to enumerate who has an account here.
  it('gives the same 401 for an unknown email as for a wrong password', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const unknown = await POST(tokenRequest(GOOD));

    clearRateLimits();
    mockPrisma.user.findUnique.mockResolvedValue(USER);
    mockCompare.mockResolvedValue(false);
    const wrongPassword = await POST(tokenRequest(GOOD));

    expect(unknown.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    await expect(unknown.json()).resolves.toEqual(
      await wrongPassword.json()
    );
  });

  // Skipping bcrypt when the row is missing turns response time into the
  // same enumeration oracle by another route.
  it('still spends a hash comparison when the user does not exist', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await POST(tokenRequest(GOOD));

    expect(mockCompare).toHaveBeenCalled();
  });

  it('rejects an account that has no password set', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...USER, password: null });

    const res = await POST(tokenRequest(GOOD));

    expect(res.status).toBe(401);
    expect(mockEncode).not.toHaveBeenCalled();
  });

  it('rejects a malformed JSON body with 400', async () => {
    const res = await POST(tokenRequest('{not json'));

    expect(res.status).toBe(400);
  });

  it('rejects a missing password with 400', async () => {
    const res = await POST(tokenRequest({ email: 'demo@example.com' }));

    expect(res.status).toBe(400);
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a non-email address with 400', async () => {
    const res = await POST(tokenRequest({ email: 'nope', password: 'x' }));

    expect(res.status).toBe(400);
  });

  it('fails closed when NEXTAUTH_SECRET is unset', async () => {
    delete (process.env as any).NEXTAUTH_SECRET;

    const res = await POST(tokenRequest(GOOD));

    expect(res.status).toBe(500);
    expect(mockEncode).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/auth/token: brute-force limits', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearRateLimits();
    (process.env as any).NEXTAUTH_SECRET = 'test-secret';
    mockPrisma.user.findUnique.mockResolvedValue(USER);
    mockCompare.mockResolvedValue(false);
    mockEncode.mockResolvedValue('minted.token.value');
  });

  it('starts refusing after repeated failures from one address', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      statuses.push((await POST(tokenRequest(GOOD, '198.51.100.7'))).status);
    }

    expect(statuses).toContain(429);
    expect(statuses[0]).toBe(401);
  });

  it('sends Retry-After when it refuses', async () => {
    let res = await POST(tokenRequest(GOOD, '198.51.100.8'));
    for (let attempt = 0; attempt < 15 && res.status !== 429; attempt += 1) {
      res = await POST(tokenRequest(GOOD, '198.51.100.8'));
    }

    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  // Rotating source addresses is cheap, so the account itself needs a budget.
  it('limits attempts against one account even from many addresses', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      statuses.push(
        (await POST(tokenRequest(GOOD, `192.0.2.${attempt + 1}`))).status
      );
    }

    expect(statuses).toContain(429);
  });

  it('does not spend the account budget on successful sign-ins', async () => {
    mockCompare.mockResolvedValue(true);

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      statuses.push(
        (await POST(tokenRequest(GOOD, `192.0.2.${attempt + 1}`))).status
      );
    }

    expect(statuses.every((status) => status === 200)).toBe(true);
  });
});
