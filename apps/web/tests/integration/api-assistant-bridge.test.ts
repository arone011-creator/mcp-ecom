// tests/integration/api-assistant-bridge.test.ts
//
// POST /api/assistant -- the browser's only door to the agent.
//
// Two things must not cross to the browser: the bearer this route mints,
// and the `control` frames, which carry the agent's MCP session id. The
// second is the easier leak, because it arrives looking like ordinary
// stream content and has to be actively withheld -- and that session id
// is what would let a caller mint an approval against the agent's own
// session, which is the boundary Task 5 defends.

jest.mock('next-auth/jwt', () => ({
  ...jest.requireActual('next-auth/jwt'),
  getToken: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import { POST } from '@/app/api/assistant/route';
import { recallTurn } from '@/lib/assistant/turns';

const mockGetToken = getToken as unknown as jest.Mock;
const SIGNED_IN = { sub: 'user_1', email: 'c@example.com', role: 'USER' };

const AGENT_WIRE =
  'event: control\ndata: {"turn_id":"t1","session_id":"mcp-sess-9"}\n\n' +
  'event: assistant\ndata: {"v":1,"seq":0,"type":"message","data":{"text":"hi"}}\n\n';

function agentResponds(wire = AGENT_WIRE, status = 200) {
  return jest.fn().mockImplementation(async () =>
    new Response(wire, {
      status,
      headers: { 'content-type': 'text/event-stream' },
    })
  );
}

function ask(body: unknown = { utterance: 'what did I order?' }) {
  return new NextRequest('https://example.com/api/assistant', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const originalFetch = global.fetch;

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = 'test-secret-value-for-the-bridge-route';
  process.env.AGENT_SERVICE_URL = 'https://agent.example.com';
  process.env.AGENT_SERVICE_KEY = 'agent-key';
  mockGetToken.mockReset();
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('POST /api/assistant', () => {
  it('refuses an unauthenticated caller', async () => {
    mockGetToken.mockResolvedValue(null);
    global.fetch = agentResponds();

    expect((await POST(ask())).status).toBe(401);
    // And spends nothing: no token minted, no agent call, no model cost.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refuses a request with no utterance', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    global.fetch = agentResponds();

    expect((await POST(ask({}))).status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refuses a blank utterance', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    global.fetch = agentResponds();

    expect((await POST(ask({ utterance: '   ' }))).status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sends the service key and a freshly minted bearer to the agent', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    const fetchMock = agentResponds();
    global.fetch = fetchMock;

    await POST(ask());

    const [url, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init.headers);

    expect(String(url)).toBe('https://agent.example.com/turn');
    expect(headers.get('x-agent-key')).toBe('agent-key');
    expect(headers.get('authorization')).toMatch(/^Bearer .+/);
  });

  it('never lets the bearer reach the browser', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    const fetchMock = agentResponds();
    global.fetch = fetchMock;

    const body = await (await POST(ask())).text();

    const sent = new Headers(fetchMock.mock.calls[0][1].headers)
      .get('authorization')!
      .replace('Bearer ', '');

    expect(sent.length).toBeGreaterThan(20);
    expect(body).not.toContain(sent);
  });

  it('never forwards a control frame', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    global.fetch = agentResponds();

    const body = await (await POST(ask())).text();

    expect(body).not.toContain('mcp-sess-9');
    expect(body).not.toContain('control');
    expect(body).toContain('"type":"message"');
  });

  it('remembers the control frame while the turn is still open', async () => {
    // Asserted MID-STREAM on purpose. A real approval happens while the
    // agent is paused and the stream is still open; by the time it
    // closes there is nothing left to approve.
    mockGetToken.mockResolvedValue(SIGNED_IN);
    global.fetch = agentResponds();

    const response = await POST(ask());
    const reader = response.body!.getReader();
    await reader.read();

    expect(recallTurn('t1')).toMatchObject({
      sessionId: 'mcp-sess-9',
      userId: 'user_1',
    });

    await reader.cancel();
  });

  it('forgets the turn once the conversation is over', async () => {
    // Nothing may approve a turn that has already finished.
    mockGetToken.mockResolvedValue(SIGNED_IN);
    global.fetch = agentResponds(
      'event: control\ndata: {"turn_id":"t_done","session_id":"s"}\n\n' +
        'event: assistant\ndata: {"v":1,"seq":0,"type":"message","data":{"text":"hi"}}\n\n'
    );

    await (await POST(ask())).text();

    expect(recallTurn('t_done')).toBeNull();
  });

  it('reports an agent that refuses without leaking why', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    global.fetch = agentResponds('', 401);

    const response = await POST(ask());

    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('agent-key');
  });

  it('refuses to call the agent when it is not configured', async () => {
    delete process.env.AGENT_SERVICE_KEY;
    mockGetToken.mockResolvedValue(SIGNED_IN);
    global.fetch = agentResponds();

    expect((await POST(ask())).status).toBe(500);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('a dropped connection', () => {
  it('aborts the agent request rather than leaving it running', async () => {
    // Otherwise the agent keeps a turn -- and an MCP session -- alive
    // with nowhere to send its events.
    mockGetToken.mockResolvedValue(SIGNED_IN);
    const fetchMock = agentResponds();
    global.fetch = fetchMock;

    const controller = new AbortController();
    const request = new NextRequest('https://example.com/api/assistant', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ utterance: 'hi' }),
      signal: controller.signal,
    });

    await POST(request);
    const passedSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;

    expect(passedSignal).toBeDefined();
    expect(passedSignal.aborted).toBe(false);

    controller.abort();
    expect(passedSignal.aborted).toBe(true);
  });
});
