// tests/integration/api-order-simulation.test.ts
//
// POST /api/orders/{id}/simulation
//
// NOT UNDER /api/v1, deliberately: that surface is documented as the
// entire set of capabilities the AI layer may use, and freezing a demo
// clock is not one of them. Cookie-authenticated, so the agent -- which
// holds a bearer and no cookie -- structurally cannot reach it.

jest.mock('next-auth/jwt', () => ({
  ...jest.requireActual('next-auth/jwt'),
  getToken: jest.fn(),
}));

const mockPrisma = {
  order: { findFirst: jest.fn(), update: jest.fn() },
};
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: mockPrisma }));

import { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import { POST } from '@/app/api/orders/[id]/simulation/route';

const mockGetToken = getToken as unknown as jest.Mock;
const SIGNED_IN = { sub: 'user_1', email: 'c@example.com', role: 'USER' };

const STARTED = new Date('2026-09-05T12:00:00.000Z');

function ask(action: unknown, id = 'ord_1') {
  return {
    req: new NextRequest(`https://x.test/api/orders/${id}/simulation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    }),
    ctx: { params: Promise.resolve({ id }) },
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ord_1',
    simulationStartedAt: STARTED,
    simulationPausedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = 'test-secret-value-for-the-simulation-route';
  mockGetToken.mockReset().mockResolvedValue(SIGNED_IN);
  mockPrisma.order.findFirst.mockReset().mockResolvedValue(row());
  mockPrisma.order.update.mockReset().mockResolvedValue({});
});

describe('POST /api/orders/{id}/simulation', () => {
  it('refuses an unauthenticated caller and writes nothing', async () => {
    mockGetToken.mockResolvedValue(null);
    const { req, ctx } = ask('pause');

    expect((await POST(req, ctx)).status).toBe(401);
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });

  it('pauses a running order', async () => {
    const { req, ctx } = ask('pause');
    const response = await POST(req, ctx);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { paused: true } });

    const [args] = mockPrisma.order.update.mock.calls[0];
    expect(args.data.simulationPausedAt).toBeInstanceOf(Date);
  });

  it('gives the whole pause back on resume', async () => {
    // THE MUST PROVE, asserted on the arithmetic rather than on the null.
    // Without the shift, an order would leap forward by however long it
    // sat paused -- which is the opposite of what pausing is for.
    const pausedAt = new Date(STARTED.getTime() + 30_000);
    mockPrisma.order.findFirst.mockResolvedValue(
      row({ simulationPausedAt: pausedAt })
    );

    const before = Date.now();
    const { req, ctx } = ask('resume');
    await POST(req, ctx);

    const [args] = mockPrisma.order.update.mock.calls[0];
    expect(args.data.simulationPausedAt).toBeNull();

    // start += (now - pausedAt), so elapsed is back to the 30 seconds it
    // had actually run for.
    const shifted = args.data.simulationStartedAt as Date;
    const elapsedAfter = before - shifted.getTime();
    expect(elapsedAfter).toBeGreaterThanOrEqual(29_000);
    expect(elapsedAfter).toBeLessThan(35_000);
  });

  it('pausing an already-paused order changes nothing', async () => {
    mockPrisma.order.findFirst.mockResolvedValue(
      row({ simulationPausedAt: new Date() })
    );
    const { req, ctx } = ask('pause');

    expect((await POST(req, ctx)).status).toBe(200);
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });

  it('resuming a running order changes nothing', async () => {
    const { req, ctx } = ask('resume');

    expect((await POST(req, ctx)).status).toBe(200);
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });

  it('answers 404 for an order that is not this customer’s', async () => {
    // The same answer as one that does not exist, like every other order
    // route: a distinguishable refusal confirms a stranger's id is real.
    mockPrisma.order.findFirst.mockResolvedValue(null);
    const { req, ctx } = ask('pause');

    expect((await POST(req, ctx)).status).toBe(404);
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });

  it('scopes the lookup to the caller', async () => {
    const { req, ctx } = ask('pause');
    await POST(req, ctx);

    const [args] = mockPrisma.order.findFirst.mock.calls[0];
    expect(args.where).toEqual({ id: 'ord_1', userId: 'user_1' });
  });

  it('does nothing to an order that has no clock', async () => {
    // Every order that predates this feature. Not an error -- the caller
    // asked for a state it is already in.
    mockPrisma.order.findFirst.mockResolvedValue(
      row({ simulationStartedAt: null })
    );
    const { req, ctx } = ask('pause');

    expect((await POST(req, ctx)).status).toBe(200);
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });

  it('refuses an action it does not recognise', async () => {
    const { req, ctx } = ask('delete-everything');

    expect((await POST(req, ctx)).status).toBe(400);
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });

  it('refuses a body that is not JSON', async () => {
    const req = new NextRequest('https://x.test/api/orders/ord_1/simulation', {
      method: 'POST',
      body: 'not json',
    });

    const response = await POST(req, {
      params: Promise.resolve({ id: 'ord_1' }),
    });

    expect(response.status).toBe(400);
  });
});
