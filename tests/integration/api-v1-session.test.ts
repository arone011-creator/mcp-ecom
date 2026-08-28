// tests/integration/api-v1-session.test.ts
//
// Behavioural tests for the API identity choke point. `next-auth/jwt` is
// mocked globally in tests/setup-integration.ts, so these assert how
// requireApiUser *routes* a request -- which credential it consults and
// which it ignores. The real cryptographic round trip is proven separately
// in api-v1-bearer.test.ts, which unmocks the module.
import { NextRequest } from 'next/server';
import { decode, getToken } from 'next-auth/jwt';
import { requireApiUser } from '@/app/api/v1/_lib/session';
import { ok, fail } from '@/app/api/v1/_lib/respond';

const mockGetToken = getToken as unknown as jest.Mock;
const mockDecode = decode as unknown as jest.Mock;

function req(headers: Record<string, string> = {}) {
  return new NextRequest('https://example.com/api/v1/orders', { headers });
}

describe('requireApiUser: cookie sessions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (process.env as any).NEXTAUTH_SECRET = 'test-secret';
  });

  it('returns the user when a valid session cookie is present', async () => {
    mockGetToken.mockResolvedValue({
      sub: 'user_a',
      email: 'a@x.com',
      role: 'USER',
    });
    await expect(requireApiUser(req())).resolves.toEqual({
      id: 'user_a',
      email: 'a@x.com',
      role: 'USER',
    });
  });

  it('returns null when no token is present', async () => {
    mockGetToken.mockResolvedValue(null);
    await expect(requireApiUser(req())).resolves.toBeNull();
  });

  it('returns null when the token has no subject', async () => {
    mockGetToken.mockResolvedValue({ email: 'a@x.com' });
    await expect(requireApiUser(req())).resolves.toBeNull();
  });

  it('defaults the role to USER when the token carries none', async () => {
    mockGetToken.mockResolvedValue({ sub: 'user_a', email: 'a@x.com' });
    await expect(requireApiUser(req())).resolves.toEqual({
      id: 'user_a',
      email: 'a@x.com',
      role: 'USER',
    });
  });

  it('reports a null email rather than undefined when the token has none', async () => {
    mockGetToken.mockResolvedValue({ sub: 'user_a', role: 'USER' });
    await expect(requireApiUser(req())).resolves.toEqual({
      id: 'user_a',
      email: null,
      role: 'USER',
    });
  });
});

describe('requireApiUser: bearer tokens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (process.env as any).NEXTAUTH_SECRET = 'test-secret';
  });

  it('decodes the bearer token rather than consulting the cookie', async () => {
    mockDecode.mockResolvedValue({
      sub: 'user_b',
      email: 'b@x.com',
      role: 'ADMIN',
    });
    await expect(
      requireApiUser(req({ authorization: 'Bearer tok_b' }))
    ).resolves.toEqual({ id: 'user_b', email: 'b@x.com', role: 'ADMIN' });
    expect(mockDecode).toHaveBeenCalledWith({
      token: 'tok_b',
      secret: 'test-secret',
    });
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it('prefers the bearer token over an ambient session cookie', async () => {
    mockDecode.mockResolvedValue({ sub: 'bearer_user', role: 'USER' });
    mockGetToken.mockResolvedValue({ sub: 'cookie_user', role: 'ADMIN' });
    await expect(
      requireApiUser(req({ authorization: 'Bearer tok_b' }))
    ).resolves.toMatchObject({ id: 'bearer_user' });
  });

  it('accepts a lowercase bearer scheme', async () => {
    mockDecode.mockResolvedValue({ sub: 'user_b', role: 'USER' });
    await expect(
      requireApiUser(req({ authorization: 'bearer tok_b' }))
    ).resolves.toMatchObject({ id: 'user_b' });
  });

  it('url-decodes the bearer value', async () => {
    mockDecode.mockResolvedValue({ sub: 'user_b', role: 'USER' });
    await requireApiUser(req({ authorization: 'Bearer a%2Bb' }));
    expect(mockDecode).toHaveBeenCalledWith({
      token: 'a+b',
      secret: 'test-secret',
    });
  });

  // The security-relevant case: a presented-but-invalid credential must not
  // silently downgrade to whatever cookie happens to ride along on the request.
  it('returns null when the bearer token fails to decode, without falling back to the cookie', async () => {
    mockDecode.mockRejectedValue(new Error('decryption operation failed'));
    mockGetToken.mockResolvedValue({ sub: 'cookie_user', role: 'ADMIN' });
    await expect(
      requireApiUser(req({ authorization: 'Bearer garbage' }))
    ).resolves.toBeNull();
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it('returns null when the bearer token decodes to something without a subject', async () => {
    mockDecode.mockResolvedValue({ email: 'b@x.com' });
    await expect(
      requireApiUser(req({ authorization: 'Bearer tok_b' }))
    ).resolves.toBeNull();
  });

  it('falls back to the cookie for a non-bearer authorization scheme', async () => {
    mockGetToken.mockResolvedValue({ sub: 'cookie_user', role: 'USER' });
    await expect(
      requireApiUser(req({ authorization: 'Basic dXNlcjpwYXNz' }))
    ).resolves.toMatchObject({ id: 'cookie_user' });
    expect(mockDecode).not.toHaveBeenCalled();
  });

  it('falls back to the cookie for a bearer header with no value', async () => {
    mockGetToken.mockResolvedValue({ sub: 'cookie_user', role: 'USER' });
    await expect(
      requireApiUser(req({ authorization: 'Bearer' }))
    ).resolves.toMatchObject({ id: 'cookie_user' });
    expect(mockDecode).not.toHaveBeenCalled();
  });

  it('returns null when NEXTAUTH_SECRET is unset rather than trusting the token', async () => {
    delete (process.env as any).NEXTAUTH_SECRET;
    mockDecode.mockResolvedValue({ sub: 'user_b', role: 'USER' });
    await expect(
      requireApiUser(req({ authorization: 'Bearer tok_b' }))
    ).resolves.toBeNull();
    expect(mockDecode).not.toHaveBeenCalled();
  });
});

describe('response envelope', () => {
  it('wraps success payloads under data', async () => {
    const body = await ok({ id: 'x' }).json();
    expect(body).toEqual({ data: { id: 'x' } });
  });

  // Money is Decimal in the schema; JSON.stringify renders it as {} without
  // this. A string preserves the scale that a float would round away.
  it('serialises Decimal-like values as strings', async () => {
    const decimalish = { toFixed: () => '10.50', toString: () => '10.50' };
    const body = await ok({ price: decimalish }).json();
    expect(body.data.price).toBe('10.50');
  });

  it('serialises Decimal-like values nested in arrays', async () => {
    const decimalish = { toFixed: () => '3.00', toString: () => '3.00' };
    const body = await ok({ items: [{ price: decimalish }] }).json();
    expect(body.data.items[0].price).toBe('3.00');
  });

  it('serialises Dates as ISO strings', async () => {
    const body = await ok({
      createdAt: new Date('2026-01-02T03:04:05.000Z'),
    }).json();
    expect(body.data.createdAt).toBe('2026-01-02T03:04:05.000Z');
  });

  it('preserves nulls', async () => {
    const body = await ok({ cancelledAt: null }).json();
    expect(body.data.cancelledAt).toBeNull();
  });

  it('honours a custom success status', () => {
    expect(ok({ id: 'x' }, 201).status).toBe(201);
  });

  it('returns the given status and message on failure', async () => {
    const response = fail(403, 'Forbidden');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
  });
});

describe('response caching', () => {
  // M1 shipped a cross-user order leak through unstable_cache. These
  // responses are per-caller by construction, so no shared cache -- CDN,
  // proxy, or browser -- may store one and hand it to someone else.
  it('marks success responses no-store', () => {
    expect(ok({ id: 'x' }).headers.get('cache-control')).toBe('no-store');
  });

  it('marks failure responses no-store', () => {
    expect(fail(401, 'Unauthorized').headers.get('cache-control')).toBe(
      'no-store'
    );
  });
});
