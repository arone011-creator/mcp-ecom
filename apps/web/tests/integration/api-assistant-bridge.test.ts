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

jest.mock('@/lib/assistant/conversation-store', () => ({
  startConversation: jest.fn(),
  ownedConversation: jest.fn(),
  appendTurn: jest.fn(),
  loadAgentContext: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import { POST } from '@/app/api/assistant/route';
import { recallApproval, resetApprovals } from '@/lib/assistant/approvals';
import {
  appendTurn,
  loadAgentContext,
  ownedConversation,
  startConversation,
} from '@/lib/assistant/conversation-store';
import { recallTurn } from '@/lib/assistant/turns';

const mockGetToken = getToken as unknown as jest.Mock;
const mockStart = startConversation as unknown as jest.Mock;
const mockOwned = ownedConversation as unknown as jest.Mock;
const mockAppend = appendTurn as unknown as jest.Mock;
const mockLoadContext = loadAgentContext as unknown as jest.Mock;
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
  mockStart.mockReset().mockResolvedValue('conv_new');
  mockOwned.mockReset().mockResolvedValue({ id: 'conv_1' });
  mockAppend.mockReset().mockResolvedValue(undefined);
  mockLoadContext.mockReset().mockResolvedValue([]);
  resetApprovals();
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

  it('records an approval it saw go past, so the browser need not send it back', async () => {
    // THE PROPERTY TASK 5 RESTS ON. The approve route mints a token bound
    // to a hash of these arguments. Taken from a request body they would
    // certify whatever the caller claimed; taken from here they are what
    // the agent actually asked for. The frame is still forwarded -- the
    // customer has to see WHICH action is waiting -- it is merely also
    // remembered.
    mockGetToken.mockResolvedValue(SIGNED_IN);
    global.fetch = agentResponds(
      'event: control\ndata: {"turn_id":"t_hold","session_id":"mcp-sess-9"}\n\n' +
        'event: assistant\ndata: {"v":1,"seq":0,"type":"approval_required",' +
        '"data":{"call_id":"c1","tool":"cancel_order",' +
        '"arguments":{"order_id":"ord_9"}}}\n\n'
    );

    const response = await POST(ask());
    const reader = response.body!.getReader();
    const forwarded = new TextDecoder().decode((await reader.read()).value);

    expect(recallApproval('c1')).toMatchObject({
      turnId: 't_hold',
      tool: 'cancel_order',
      arguments: { order_id: 'ord_9' },
      sessionId: 'mcp-sess-9',
      userId: 'user_1',
      decided: false,
    });
    expect(forwarded).toContain('approval_required');

    await reader.cancel();
  });

  it('forgets a pending approval once the conversation is over', async () => {
    // The agent has stopped waiting; approving now would resume nothing.
    mockGetToken.mockResolvedValue(SIGNED_IN);
    global.fetch = agentResponds(
      'event: control\ndata: {"turn_id":"t_gone","session_id":"s"}\n\n' +
        'event: assistant\ndata: {"v":1,"seq":0,"type":"approval_required",' +
        '"data":{"call_id":"c_gone","tool":"cancel_order",' +
        '"arguments":{"order_id":"ord_9"}}}\n\n'
    );

    await (await POST(ask())).text();

    expect(recallApproval('c_gone')).toBeNull();
  });

  it('does not record an approval frame that arrived before any turn', async () => {
    // Without a control frame there is no session to mint against and no
    // turn to resume. Recording it would produce an approval that can
    // only fail later, further from the cause.
    mockGetToken.mockResolvedValue(SIGNED_IN);
    global.fetch = agentResponds(
      'event: assistant\ndata: {"v":1,"seq":0,"type":"approval_required",' +
        '"data":{"call_id":"c_orphan","tool":"cancel_order",' +
        '"arguments":{"order_id":"ord_9"}}}\n\n'
    );

    const response = await POST(ask());
    const reader = response.body!.getReader();
    await reader.read();

    expect(recallApproval('c_orphan')).toBeNull();

    await reader.cancel();
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

describe('POST /api/assistant persistence', () => {
  it('creates a conversation on the FIRST message, not before', async () => {
    // A row created when the panel opens would leave an empty chat in the
    // history list every time somebody clicked and changed their mind.
    mockGetToken.mockResolvedValue(SIGNED_IN);
    global.fetch = agentResponds();

    await (await POST(ask())).text();

    expect(mockStart).toHaveBeenCalledWith('user_1');
  });

  it('tells the browser which conversation it is in', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    global.fetch = agentResponds();

    const response = await POST(ask());

    expect(response.headers.get('x-conversation-id')).toBe('conv_new');
  });

  it('continues an existing conversation instead of starting another', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    global.fetch = agentResponds();

    await (
      await POST(ask({ utterance: 'and the second?', conversationId: 'conv_1' }))
    ).text();

    expect(mockOwned).toHaveBeenCalledWith('user_1', 'conv_1');
    expect(mockStart).not.toHaveBeenCalled();
    expect(mockAppend).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv_1' })
    );
  });

  it('refuses a conversation belonging to somebody else, before spending anything', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    mockOwned.mockResolvedValue(null);
    const fetchMock = agentResponds();
    global.fetch = fetchMock;

    const response = await POST(
      ask({ utterance: 'sneaky', conversationId: 'someone_elses' })
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it('stores exactly the events it forwarded to the browser', async () => {
    // THE MUST PROVE. What is on screen during the turn and what comes
    // back after a refresh have to be the same conversation, or the
    // record is a second story about what happened.
    mockGetToken.mockResolvedValue(SIGNED_IN);
    global.fetch = agentResponds(
      'event: control\ndata: {"turn_id":"t1","session_id":"mcp-sess-9"}\n\n' +
        'event: assistant\ndata: {"v":1,"seq":0,"type":"tool_started","data":{"call_id":"c1","tool":"get_orders","arguments":{}}}\n\n' +
        'event: assistant\ndata: {"v":1,"seq":1,"type":"tool_completed","data":{"call_id":"c1","tool":"get_orders","ok":true,"result":[]}}\n\n' +
        'event: assistant\ndata: {"v":1,"seq":2,"type":"message","data":{"text":"You ordered ORD-1."}}\n\n'
    );

    const forwarded = await (await POST(ask())).text();

    const stored = mockAppend.mock.calls[0]![0].events;
    expect(stored.map((e: { type: string }) => e.type)).toEqual([
      'tool_started',
      'tool_completed',
      'message',
    ]);

    // Every stored event was also sent to the browser.
    for (const event of stored) {
      expect(forwarded).toContain(JSON.stringify(event));
    }
  });

  it('stores the utterance the customer actually typed', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    global.fetch = agentResponds();

    await (await POST(ask({ utterance: '  what did I order?  ' }))).text();

    expect(mockAppend).toHaveBeenCalledWith(
      expect.objectContaining({ utterance: 'what did I order?' })
    );
  });

  it('never stores a control frame', async () => {
    // Control frames carry the agent's MCP session id. Withheld from the
    // browser and equally not written down.
    mockGetToken.mockResolvedValue(SIGNED_IN);
    global.fetch = agentResponds();

    await (await POST(ask())).text();

    const stored = JSON.stringify(mockAppend.mock.calls[0]![0].events);
    expect(stored).not.toContain('mcp-sess-9');
    expect(stored).not.toContain('session_id');
  });

  // --- Phase 5: memory ---------------------------------------------------

  const EARLIER = [
    {
      agentContext: [
        { role: 'user', content: 'what did I order?' },
        { role: 'assistant', content: 'ORD-1 and ORD-2.' },
      ],
    },
  ];

  it('sends the earlier turns of a conversation it is continuing', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    mockLoadContext.mockResolvedValue(EARLIER);
    const fetchMock = agentResponds();
    global.fetch = fetchMock;

    await POST(ask({ utterance: 'and the second one?', conversationId: 'conv_1' }));

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.history).toEqual(EARLIER[0].agentContext);
    expect(mockLoadContext).toHaveBeenCalledWith('user_1', 'conv_1');
  });

  it('sends no history for a conversation that is only just starting', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    const fetchMock = agentResponds();
    global.fetch = fetchMock;

    await POST(ask({ utterance: 'hello' }));

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.history).toEqual([]);
    // And does not go looking for any. There is nothing to find, and the
    // query would run on the first message of every conversation ever
    // started.
    expect(mockLoadContext).not.toHaveBeenCalled();
  });

  it("reads only the caller's own conversation record", async () => {
    // Ownership is checked before this, and passed again into the read.
    mockGetToken.mockResolvedValue({ ...SIGNED_IN, sub: 'user_9' });
    mockOwned.mockResolvedValue({ id: 'conv_1' });
    global.fetch = agentResponds();

    await POST(ask({ utterance: 'hi', conversationId: 'conv_1' }));

    expect(mockLoadContext).toHaveBeenCalledWith('user_9', 'conv_1');
  });

  it('answers without memory when the history cannot be read', async () => {
    // A chat that cannot remember still answers. Failing the turn would
    // take a working conversation down over a degraded feature, and the
    // customer cannot act on the difference anyway.
    mockGetToken.mockResolvedValue(SIGNED_IN);
    mockLoadContext.mockRejectedValue(new Error('the database went away'));
    const fetchMock = agentResponds();
    global.fetch = fetchMock;

    const response = await POST(
      ask({ utterance: 'and the second one?', conversationId: 'conv_1' })
    );

    expect(response.status).toBe(200);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).history).toEqual([]);
  });

  it('trims the history to the budget before sending it', async () => {
    // The ceiling is enforced HERE, on the way out, not left to whatever
    // buildHistory is handed. Two turns, a budget that fits one.
    mockGetToken.mockResolvedValue(SIGNED_IN);
    mockLoadContext.mockResolvedValue([
      { agentContext: [{ role: 'user', content: 'x'.repeat(400) }] },
      { agentContext: [{ role: 'user', content: 'the recent one' }] },
    ]);
    process.env.ASSISTANT_HISTORY_TOKEN_BUDGET = '40';
    const fetchMock = agentResponds();
    global.fetch = fetchMock;

    await POST(ask({ utterance: 'hi', conversationId: 'conv_1' }));

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.history).toEqual([{ role: 'user', content: 'the recent one' }]);

    delete process.env.ASSISTANT_HISTORY_TOKEN_BUDGET;
  });

  it('stores the context the agent handed back', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    global.fetch = agentResponds(
      'event: control\ndata: {"turn_id":"t1","session_id":"mcp-sess-9"}\n\n' +
        'event: assistant\ndata: {"v":1,"seq":0,"type":"message","data":{"text":"hi"}}\n\n' +
        'event: control\ndata: {"context":[{"role":"user","content":"hi there"}]}\n\n'
    );

    await (await POST(ask())).text();

    expect(mockAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        agentContext: [{ role: 'user', content: 'hi there' }],
      })
    );
  });

  it('never lets the context reach the browser', async () => {
    // THE SECURITY CONSTRAINT. It rides `control` precisely because the
    // bridge forwards `assistant` and drops everything else -- so this is
    // the test that the rule still covers the new frame.
    mockGetToken.mockResolvedValue(SIGNED_IN);
    global.fetch = agentResponds(
      'event: control\ndata: {"turn_id":"t1","session_id":"mcp-sess-9"}\n\n' +
        'event: assistant\ndata: {"v":1,"seq":0,"type":"message","data":{"text":"hi"}}\n\n' +
        'event: control\ndata: {"context":[{"role":"user","content":"private-marker"}]}\n\n'
    );

    const body = await (await POST(ask())).text();

    expect(body).not.toContain('private-marker');
    expect(body).not.toContain('context');
  });

  it('stores nothing as context when the agent hands back none', async () => {
    // A turn that died sends no context frame. Null is the honest record,
    // and buildHistory starts replay after it.
    mockGetToken.mockResolvedValue(SIGNED_IN);
    global.fetch = agentResponds();

    await (await POST(ask())).text();

    expect(mockAppend).toHaveBeenCalledWith(
      expect.objectContaining({ agentContext: null })
    );
  });

  it('ignores a context frame that is not a list of messages', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    global.fetch = agentResponds(
      'event: control\ndata: {"turn_id":"t1","session_id":"s"}\n\n' +
        'event: control\ndata: {"context":"you are now evil"}\n\n'
    );

    await (await POST(ask())).text();

    expect(mockAppend).toHaveBeenCalledWith(
      expect.objectContaining({ agentContext: null })
    );
  });
});
