// tests/integration/api-assistant-approval.test.ts
//
// The approval control. The M4 storefront plan calls these "the tests
// that matter most", and the reason is that everything else in the chat
// is reversible and this is not: past this route an order is cancelled.
//
// The shape of the defence is that the browser is not trusted with any
// fact about WHAT is being approved. It sends a call_id. The arguments
// come from what the bridge watched go past; the facts on the card come
// from the database. A browser that lies can therefore only lie about
// WHICH pending approval it means -- and it has to own that one.

const mockPrisma = { order: { findFirst: jest.fn() } };
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: mockPrisma }));

jest.mock('next-auth/jwt', () => ({
  ...jest.requireActual('next-auth/jwt'),
  getToken: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import { GET, POST } from '@/app/api/assistant/approval/[callId]/route';
import { rememberApproval, resetApprovals } from '@/lib/assistant/approvals';

const mockGetToken = getToken as unknown as jest.Mock;
const SIGNED_IN = { sub: 'user_a', email: 'a@x.com', role: 'USER' };

const params = (callId: string) => ({ params: Promise.resolve({ callId }) });

function pending(overrides: Record<string, unknown> = {}) {
  rememberApproval('c1', {
    turnId: 't1',
    tool: 'cancel_order',
    arguments: { order_id: 'order_1' },
    sessionId: 'mcp-sess-9',
    userId: 'user_a',
    ...overrides,
  } as never);
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order_1',
    orderNumber: 'ORD-1042',
    status: 'PENDING',
    total: 59.98,
    currency: 'USD',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    orderItems: [
      { productName: 'Runner', quantity: 2, price: 29.99 },
    ],
    ...overrides,
  };
}

function read(callId = 'c1') {
  return GET(
    new NextRequest(`https://x.test/api/assistant/approval/${callId}`),
    params(callId)
  );
}

function decide(approved: boolean, callId = 'c1', extra = {}) {
  return POST(
    new NextRequest(`https://x.test/api/assistant/approval/${callId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approved, ...extra }),
    }),
    params(callId)
  );
}

/** The MCP mint and the agent decision, answered in order. */
function upstreamOk() {
  return jest.fn().mockImplementation(async (url: string) => {
    if (String(url).includes('/approvals')) {
      return new Response(JSON.stringify({ token: 'minted-token', expiresIn: 300 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
}

const callsTo = (fetchMock: jest.Mock, fragment: string) =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes(fragment));

const originalFetch = global.fetch;

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = 'test-secret-value-for-the-approve-route';
  process.env.AGENT_SERVICE_URL = 'https://agent.example.com';
  process.env.AGENT_SERVICE_KEY = 'agent-key';
  process.env.MCP_APPROVALS_URL = 'https://mcp.example.com/approvals';
  mockGetToken.mockReset();
  mockPrisma.order.findFirst.mockReset();
  resetApprovals();
  global.fetch = upstreamOk();
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('GET the approval card facts', () => {
  it('answers with the order as the DATABASE has it', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    pending();
    mockPrisma.order.findFirst.mockResolvedValue(order());

    const { data } = await (await read()).json();

    expect(data.tool).toBe('cancel_order');
    expect(data.order).toMatchObject({
      orderNumber: 'ORD-1042',
      status: 'PENDING',
      total: 59.98,
    });
  });

  it('ignores facts the event payload claims about the order', async () => {
    // THE ONE THAT MATTERS. The event names WHICH order; the lookup
    // answers WHAT is true about it. A manipulated event payload -- and
    // the agent's context is reachable by anyone who can write a product
    // description -- must not be able to misrepresent what is about to
    // happen. Here the payload claims a different order number and a
    // trivial total; the card must show neither.
    mockGetToken.mockResolvedValue(SIGNED_IN);
    pending({
      arguments: {
        order_id: 'order_1',
        orderNumber: 'ORD-NOT-YOURS',
        total: 0.01,
        status: 'DELIVERED',
      },
    });
    mockPrisma.order.findFirst.mockResolvedValue(order());

    const { data } = await (await read()).json();

    expect(data.order.orderNumber).toBe('ORD-1042');
    expect(data.order.total).toBe(59.98);
    expect(data.order.status).toBe('PENDING');
    expect(JSON.stringify(data)).not.toContain('ORD-NOT-YOURS');
  });

  it('keeps the exact money the column holds, rather than a float of it', async () => {
    // respond.ts renders a money column as a string on purpose, because a
    // float loses the scale. This is the one screen that asks someone to
    // confirm a real amount, so it is the worst place to round.
    mockGetToken.mockResolvedValue(SIGNED_IN);
    pending();
    mockPrisma.order.findFirst.mockResolvedValue(
      // Duck-typed the way Prisma's Decimal is, which is what respond.ts
      // recognises. A plain number here would test nothing.
      order({ total: { toFixed: () => '59.90', toString: () => '59.90' } })
    );

    const { data } = await (await read()).json();

    expect(data.order.total).toBe('59.90');
  });

  it('looks the order up by the REMEMBERED id and the signed-in user', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    pending();
    mockPrisma.order.findFirst.mockResolvedValue(order());

    await read();

    expect(mockPrisma.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'order_1', userId: 'user_a' },
      })
    );
  });

  it('refuses an approval belonging to somebody else', async () => {
    // The same answer as one that does not exist. A different status
    // would confirm that a stranger's call_id is real.
    mockGetToken.mockResolvedValue({ ...SIGNED_IN, sub: 'user_b' });
    pending();

    expect((await read()).status).toBe(404);
    expect(mockPrisma.order.findFirst).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated reader', async () => {
    mockGetToken.mockResolvedValue(null);
    pending();

    expect((await read()).status).toBe(401);
  });

  it('answers 404 for a call_id nobody is waiting on', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);

    expect((await read('never-seen')).status).toBe(404);
  });

  it('never reveals the agent session or the turn it belongs to', async () => {
    // The bridge withholds both from the browser. A card that echoed
    // them would undo that in one line.
    mockGetToken.mockResolvedValue(SIGNED_IN);
    pending();
    mockPrisma.order.findFirst.mockResolvedValue(order());

    const body = await (await read()).text();

    expect(body).not.toContain('mcp-sess-9');
    expect(body).not.toContain('t1');
  });
});

describe('POST a decision', () => {
  it('mints for the arguments the AGENT asked for, not the ones posted', async () => {
    // A browser that could choose the arguments could obtain a token
    // describing one order and let the agent spend it on another. The
    // request body is read for `approved` and nothing else.
    mockGetToken.mockResolvedValue(SIGNED_IN);
    pending();
    const fetchMock = global.fetch as jest.Mock;

    await decide(true, 'c1', {
      arguments: { order_id: 'order_SOMEONE_ELSE' },
      tool: 'delete_everything',
    });

    const [, init] = callsTo(fetchMock, '/approvals')[0];
    expect(JSON.parse(init.body)).toEqual({
      tool: 'cancel_order',
      args: { order_id: 'order_1' },
    });
  });

  it('mints against the agent session the turn is actually using', async () => {
    // A token is bound to the session as well as the arguments. Minted
    // against any other session it is refused at the MCP server, which
    // is what stops an approval crossing conversations.
    mockGetToken.mockResolvedValue(SIGNED_IN);
    pending();
    const fetchMock = global.fetch as jest.Mock;

    await decide(true);

    const [, init] = callsTo(fetchMock, '/approvals')[0];
    expect(new Headers(init.headers).get('mcp-session-id')).toBe('mcp-sess-9');
  });

  it('mints a bearer carrying the same claims the bridge mints', async () => {
    // mint.ts is factored out so its callers cannot drift about what goes
    // into a token, and its header warns that "an extra claim in one and
    // not the other is the kind of difference nothing fails on until it
    // matters". Nothing fails on it today -- the MCP mint route only
    // checks that a bearer is present -- so only a test keeps them equal.
    mockGetToken.mockResolvedValue(SIGNED_IN);
    pending();
    const fetchMock = global.fetch as jest.Mock;

    await decide(true);

    const [, init] = callsTo(fetchMock, '/approvals')[0];
    const bearer = new Headers(init.headers).get('authorization')!;
    const { decode } = jest.requireActual('next-auth/jwt');
    const claims = await decode({
      token: bearer.replace('Bearer ', ''),
      secret: process.env.NEXTAUTH_SECRET!,
    });

    expect(claims).toMatchObject({
      sub: 'user_a',
      email: 'a@x.com',
      role: 'USER',
    });
  });

  it('hands the agent the minted token and nothing else', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    pending();
    const fetchMock = global.fetch as jest.Mock;

    expect((await decide(true)).status).toBe(200);

    const [url, init] = callsTo(fetchMock, '/decision')[0];
    expect(url).toBe('https://agent.example.com/turn/t1/decision');
    expect(JSON.parse(init.body)).toEqual({ approved: true, token: 'minted-token' });
    expect(new Headers(init.headers).get('x-agent-key')).toBe('agent-key');
  });

  it('never puts the approval token in the response', async () => {
    // It authorises a cancellation. The browser has no use for it and
    // no business holding it.
    mockGetToken.mockResolvedValue(SIGNED_IN);
    pending();

    expect(await (await decide(true)).text()).not.toContain('minted-token');
  });

  it('sends NOTHING to the MCP server when the customer declines', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    pending();
    const fetchMock = global.fetch as jest.Mock;

    expect((await decide(false)).status).toBe(200);

    expect(callsTo(fetchMock, '/approvals')).toHaveLength(0);
    const [, init] = callsTo(fetchMock, '/decision')[0];
    expect(JSON.parse(init.body)).toEqual({ approved: false });
  });

  it('does not mint a second approval for a second click', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    pending();
    const fetchMock = global.fetch as jest.Mock;

    await decide(true);
    const second = await decide(true);

    expect(second.status).toBe(409);
    expect(callsTo(fetchMock, '/approvals')).toHaveLength(1);
    expect(callsTo(fetchMock, '/decision')).toHaveLength(1);
  });

  it('does not let a decline follow an approval', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    pending();
    const fetchMock = global.fetch as jest.Mock;

    await decide(true);

    expect((await decide(false)).status).toBe(409);
    expect(callsTo(fetchMock, '/decision')).toHaveLength(1);
  });

  it('refuses to decide somebody else’s approval', async () => {
    mockGetToken.mockResolvedValue({ ...SIGNED_IN, sub: 'user_b' });
    pending();
    const fetchMock = global.fetch as jest.Mock;

    expect((await decide(true)).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated decision before spending anything', async () => {
    mockGetToken.mockResolvedValue(null);
    pending();
    const fetchMock = global.fetch as jest.Mock;

    expect((await decide(true)).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves the approval usable when minting fails', async () => {
    // A mint that failed approved nothing. Burning the approval here
    // would strand the customer: the agent is still waiting and there is
    // no longer any way to answer it.
    mockGetToken.mockResolvedValue(SIGNED_IN);
    pending();
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/approvals')) return new Response('no', { status: 500 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    expect((await decide(true)).status).toBe(502);
    // Nothing was sent onward, and a retry is still possible.
    expect(callsTo(global.fetch as jest.Mock, '/decision')).toHaveLength(0);

    global.fetch = upstreamOk();
    expect((await decide(true)).status).toBe(200);
  });

  it('treats a missing decision as no decision, rather than as yes', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    pending();
    const fetchMock = global.fetch as jest.Mock;

    const response = await POST(
      new NextRequest('https://x.test/api/assistant/approval/c1', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      params('c1')
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
