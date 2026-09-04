// tests/integration/api-assistant-title.test.ts
//
// POST /api/assistant/conversations/{id}/title
//
// THE REQUEST CARRIES NO BODY. The obvious design has the browser send
// the exchange it just watched; that would make this endpoint a way to
// put attacker-chosen text in front of the model on this project's
// account, and a way to write a near-arbitrary string into a row that is
// rendered on every future page load. The route reads turn zero out of
// the database instead.

jest.mock('next-auth/jwt', () => ({
  ...jest.requireActual('next-auth/jwt'),
  getToken: jest.fn(),
}));

jest.mock('@/lib/assistant/conversation-store', () => ({
  firstExchange: jest.fn(),
  nameConversation: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import { POST } from '@/app/api/assistant/conversations/[id]/title/route';
import {
  firstExchange,
  nameConversation,
} from '@/lib/assistant/conversation-store';

const mockGetToken = getToken as unknown as jest.Mock;
const mockFirst = firstExchange as unknown as jest.Mock;
const mockName = nameConversation as unknown as jest.Mock;
const SIGNED_IN = { sub: 'user_1', email: 'c@example.com', role: 'USER' };

const EXCHANGE = {
  title: null,
  utterance: 'what did I order recently?',
  events: [
    { v: 1, seq: 0, type: 'message', data: { text: 'You have two orders.' } },
  ],
};

function ask(id = 'conv_1') {
  return {
    req: new NextRequest(
      `https://example.com/api/assistant/conversations/${id}/title`,
      { method: 'POST' }
    ),
    ctx: { params: Promise.resolve({ id }) },
  };
}

function agentSays(title: unknown, status = 200) {
  return jest.fn().mockResolvedValue(
    new Response(JSON.stringify({ title }), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  );
}

const originalFetch = global.fetch;

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = 'test-secret-value-for-the-title-route';
  process.env.AGENT_SERVICE_URL = 'https://agent.example.com';
  process.env.AGENT_SERVICE_KEY = 'agent-key';
  mockGetToken.mockReset().mockResolvedValue(SIGNED_IN);
  mockFirst.mockReset().mockResolvedValue(EXCHANGE);
  mockName.mockReset().mockResolvedValue(true);
  global.fetch = agentSays('Recent order history');
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('POST /api/assistant/conversations/{id}/title', () => {
  it('refuses an unauthenticated caller and spends nothing', async () => {
    mockGetToken.mockResolvedValue(null);
    const { req, ctx } = ask();

    expect((await POST(req, ctx)).status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('names the conversation from what the agent answered', async () => {
    const { req, ctx } = ask();
    const response = await POST(req, ctx);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { title: 'Recent order history' },
    });
    expect(mockName).toHaveBeenCalledWith(
      'user_1',
      'conv_1',
      'Recent order history'
    );
  });

  it('sends the agent the stored exchange, not anything the caller sent', async () => {
    const { req, ctx } = ask();
    await POST(req, ctx);

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    const sent = JSON.parse(init.body);

    expect(String(url)).toBe('https://agent.example.com/title');
    expect(sent.utterance).toBe('what did I order recently?');
    expect(sent.answer).toContain('You have two orders.');
  });

  it('answers 404 for a conversation that is not this customer’s', async () => {
    // The same answer as one that does not exist, like every other route
    // here: a distinguishable refusal confirms a stranger's id is real.
    mockFirst.mockResolvedValue(null);
    const { req, ctx } = ask();

    expect((await POST(req, ctx)).status).toBe(404);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does nothing at all for a chat that is already named', async () => {
    // Idempotent, and cheaply so: the model call never happens.
    mockFirst.mockResolvedValue({ ...EXCHANGE, title: 'Recent order history' });
    const { req, ctx } = ask();

    const response = await POST(req, ctx);

    expect(response.status).toBe(200);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockName).not.toHaveBeenCalled();
  });

  it('keeps the fallback when the agent is unreachable', async () => {
    // THE MUST PROVE. Every failure path leaves the row untouched, and
    // none of them is an error the browser has to handle -- the chat
    // already has a usable name.
    global.fetch = jest.fn().mockRejectedValue(new Error('agent is down'));
    const { req, ctx } = ask();

    const response = await POST(req, ctx);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { title: null } });
    expect(mockName).not.toHaveBeenCalled();
  });

  it('keeps the fallback when the agent answers an error', async () => {
    global.fetch = agentSays(null, 502);
    const { req, ctx } = ask();

    expect((await POST(req, ctx)).status).toBe(200);
    expect(mockName).not.toHaveBeenCalled();
  });

  it('keeps the fallback when the agent has no name to offer', async () => {
    global.fetch = agentSays(null);
    const { req, ctx } = ask();

    expect((await POST(req, ctx)).status).toBe(200);
    expect(mockName).not.toHaveBeenCalled();
  });

  it('refuses a title that is not a string', async () => {
    // The agent cleans its own output. This is the layer that does not
    // depend on that one being right.
    global.fetch = agentSays({ nested: 'nonsense' });
    const { req, ctx } = ask();

    expect((await POST(req, ctx)).status).toBe(200);
    expect(mockName).not.toHaveBeenCalled();
  });

  it('caps a title the agent did not cap', async () => {
    global.fetch = agentSays('x'.repeat(500));
    const { req, ctx } = ask();

    await POST(req, ctx);

    expect(mockName.mock.calls[0][2].length).toBeLessThanOrEqual(60);
  });

  it('never lets the service key reach the browser', async () => {
    const { req, ctx } = ask();
    const body = await (await POST(req, ctx)).text();

    expect(body).not.toContain('agent-key');
  });
});
