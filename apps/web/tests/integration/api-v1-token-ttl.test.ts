// tests/integration/api-v1-token-ttl.test.ts
//
// The token endpoint's default is seven days, which is right for a human
// pasting a credential into a script and wrong for a token that will be
// handed to an agent. These JWTs have no revocation -- rotating
// NEXTAUTH_SECRET is the only kill switch, and it signs out every browser
// -- so the only lever that shortens exposure is the lifetime itself.
//
// Clamped rather than rejected: asking for a year and getting a week is
// safe, and so is asking for one second and getting sixty. Both directions
// fail towards a shorter, valid token.
//
// Lives with the integration tests, not the unit ones: importing the route
// pulls in next/server, and the unit project runs in jsdom, which has no
// Request global. Every other route test is here for the same reason.

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
import {
  clampTtl,
  DEFAULT_TTL_SECONDS,
  MIN_TTL_SECONDS,
  POST,
} from '@/app/api/v1/auth/token/route';
import { clearRateLimits } from '@/app/api/v1/_lib/rate-limit';

const mockEncode = encode as unknown as jest.Mock;

function tokenRequest(body: unknown, ip = '203.0.113.9') {
  return new NextRequest('https://example.com/api/v1/auth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

describe('clampTtl', () => {
  it('defaults to seven days when unspecified', () => {
    expect(clampTtl(undefined)).toBe(DEFAULT_TTL_SECONDS);
    expect(DEFAULT_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
  });

  it('honours a short lifetime', () => {
    expect(clampTtl(900)).toBe(900);
  });

  it('clamps below the floor up to the floor', () => {
    expect(clampTtl(1)).toBe(MIN_TTL_SECONDS);
    expect(clampTtl(0)).toBe(MIN_TTL_SECONDS);
    expect(clampTtl(-30)).toBe(MIN_TTL_SECONDS);
  });

  it('clamps above the ceiling down to the default', () => {
    expect(clampTtl(365 * 24 * 60 * 60)).toBe(DEFAULT_TTL_SECONDS);
  });

  it('ignores values that are not whole numbers of seconds', () => {
    expect(clampTtl(90.5 as unknown as number)).toBe(DEFAULT_TTL_SECONDS);
    expect(clampTtl('900' as unknown as number)).toBe(DEFAULT_TTL_SECONDS);
    expect(clampTtl(NaN)).toBe(DEFAULT_TTL_SECONDS);
  });
});

// clampTtl passing in isolation does not prove the route calls it. These go
// through POST, so an exported-but-unused helper fails here.
describe('POST /api/v1/auth/token honours the requested lifetime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearRateLimits();
    (process.env as any).NEXTAUTH_SECRET = 'test-secret';
    mockCompare.mockResolvedValue(true);
    mockEncode.mockResolvedValue('minted.token.value');
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user_1',
      email: 'demo@example.com',
      name: 'Demo User',
      role: 'USER',
      password: '$2a$12$hashed',
    });
  });

  it('mints a short-lived token when one is asked for', async () => {
    const res = await POST(
      tokenRequest({ email: 'demo@example.com', password: 'x', ttlSeconds: 900 })
    );

    expect(mockEncode).toHaveBeenCalledWith(
      expect.objectContaining({ maxAge: 900 })
    );

    const body = await res.json();
    expect(body.data.expiresIn).toBe(900);
    // The advertised expiry has to match the token actually minted, or a
    // client will keep presenting one the API already considers dead.
    const advertised = new Date(body.data.expiresAt).getTime() - Date.now();
    expect(advertised).toBeGreaterThan(890_000);
    expect(advertised).toBeLessThanOrEqual(900_000);
  });

  it('still defaults to seven days when nothing is asked for', async () => {
    const res = await POST(
      tokenRequest({ email: 'demo@example.com', password: 'x' })
    );

    expect(mockEncode).toHaveBeenCalledWith(
      expect.objectContaining({ maxAge: DEFAULT_TTL_SECONDS })
    );
    expect((await res.json()).data.expiresIn).toBe(DEFAULT_TTL_SECONDS);
  });

  it('clamps a hostile lifetime instead of honouring it', async () => {
    await POST(
      tokenRequest({
        email: 'demo@example.com',
        password: 'x',
        ttlSeconds: 10 * 365 * 24 * 60 * 60,
      })
    );

    expect(mockEncode).toHaveBeenCalledWith(
      expect.objectContaining({ maxAge: DEFAULT_TTL_SECONDS })
    );
  });

  it('does not reject the exchange over an unusable lifetime', async () => {
    const res = await POST(
      tokenRequest({
        email: 'demo@example.com',
        password: 'x',
        ttlSeconds: 'soon',
      })
    );

    expect(res.status).toBe(200);
    expect(mockEncode).toHaveBeenCalledWith(
      expect.objectContaining({ maxAge: DEFAULT_TTL_SECONDS })
    );
  });
});
