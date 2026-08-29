// tests/integration/api-v1-whoami.test.ts
//
// The MCP server cannot decode a NextAuth JWT -- it is an encrypted JWE,
// and a second implementation of that crypto in Python is exactly the
// duplicated rule the adapter principle exists to prevent. So it asks the
// API who the caller is, and this is the route that answers.

jest.mock('@/app/api/v1/_lib/session', () => ({ requireApiUser: jest.fn() }));

import { NextRequest } from 'next/server';
import { requireApiUser } from '@/app/api/v1/_lib/session';
import { GET } from '@/app/api/v1/auth/whoami/route';

const mockUser = requireApiUser as unknown as jest.Mock;
const req = () => new NextRequest('https://x.test/api/v1/auth/whoami');

describe('GET /api/v1/auth/whoami', () => {
  beforeEach(() => jest.clearAllMocks());

  it('401s without a credential', async () => {
    mockUser.mockResolvedValue(null);

    const res = await GET(req());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Authentication required' });
  });

  it('echoes the verified caller', async () => {
    mockUser.mockResolvedValue({ id: 'u1', email: 'a@x.com', role: 'USER' });

    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { id: 'u1', email: 'a@x.com', role: 'USER' },
    });
  });

  it('never caches the answer', async () => {
    mockUser.mockResolvedValue({ id: 'u1', email: 'a@x.com', role: 'USER' });

    const res = await GET(req());

    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
