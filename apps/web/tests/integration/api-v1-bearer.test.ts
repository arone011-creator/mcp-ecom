// tests/integration/api-v1-bearer.test.ts
//
// The other session test mocks `next-auth/jwt` and therefore proves only
// that requireApiUser calls the right function. This one unmocks it and
// runs a real encrypt/decrypt round trip, so a change that breaks actual
// bearer auth fails here rather than in production. Every token below is
// minted by next-auth's own `encode`, which is what the token endpoint
// hands to clients.
jest.unmock('next-auth/jwt');

import { NextRequest } from 'next/server';
import { encode } from 'next-auth/jwt';
import { requireApiUser } from '@/app/api/v1/_lib/session';

const SECRET = 'round-trip-secret-value';

function withBearer(token: string) {
  return new NextRequest('https://example.com/api/v1/orders', {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('bearer tokens: real round trip', () => {
  beforeEach(() => {
    (process.env as any).NEXTAUTH_SECRET = SECRET;
    // getToken derives the session cookie name from this; keeping it http
    // means the unprefixed name, matching the cookie header used below.
    (process.env as any).NEXTAUTH_URL = 'http://localhost:3000';
  });

  it('accepts a token minted by next-auth encode with the same secret', async () => {
    const token = await encode({
      token: { sub: 'user_real', email: 'real@x.com', role: 'USER' },
      secret: SECRET,
    });

    await expect(requireApiUser(withBearer(token))).resolves.toEqual({
      id: 'user_real',
      email: 'real@x.com',
      role: 'USER',
    });
  });

  it('carries the role through the encryption intact', async () => {
    const token = await encode({
      token: { sub: 'admin_real', email: 'admin@x.com', role: 'ADMIN' },
      secret: SECRET,
    });

    await expect(requireApiUser(withBearer(token))).resolves.toMatchObject({
      role: 'ADMIN',
    });
  });

  it('rejects a token minted with a different secret', async () => {
    const token = await encode({
      token: { sub: 'user_real', role: 'USER' },
      secret: 'a-completely-different-secret',
    });

    await expect(requireApiUser(withBearer(token))).resolves.toBeNull();
  });

  it('rejects an expired token', async () => {
    // Well past next-auth's 15s clock tolerance.
    const token = await encode({
      token: { sub: 'user_real', role: 'USER' },
      secret: SECRET,
      maxAge: -600,
    });

    await expect(requireApiUser(withBearer(token))).resolves.toBeNull();
  });

  it('rejects a tampered token', async () => {
    const token = await encode({
      token: { sub: 'user_real', role: 'USER' },
      secret: SECRET,
    });
    // Flip a character in the ciphertext segment.
    const parts = token.split('.');
    parts[3] = parts[3].startsWith('A')
      ? `B${parts[3].slice(1)}`
      : `A${parts[3].slice(1)}`;

    await expect(requireApiUser(withBearer(parts.join('.')))).resolves.toBeNull();
  });

  it('rejects a string that is not a token at all', async () => {
    await expect(requireApiUser(withBearer('not-a-jwt'))).resolves.toBeNull();
  });

  it('accepts the same token presented as a session cookie', async () => {
    // Proves the bearer path and the browser path share one trust root, so
    // the API cannot drift from the storefront's idea of who is signed in.
    const token = await encode({
      token: { sub: 'user_real', email: 'real@x.com', role: 'USER' },
      secret: SECRET,
    });

    const req = new NextRequest('https://example.com/api/v1/orders', {
      headers: { cookie: `next-auth.session-token=${token}` },
    });

    await expect(requireApiUser(req)).resolves.toMatchObject({
      id: 'user_real',
    });
  });
});
