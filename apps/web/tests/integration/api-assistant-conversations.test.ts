// tests/integration/api-assistant-conversations.test.ts
//
// What the panel asks for when it loads: the conversation to resume.

jest.mock('@/lib/assistant/conversation-store', () => ({
  loadLatestConversation: jest.fn(),
}));

jest.mock('next-auth/jwt', () => ({
  ...jest.requireActual('next-auth/jwt'),
  getToken: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import { GET } from '@/app/api/assistant/conversations/latest/route';
import { loadLatestConversation } from '@/lib/assistant/conversation-store';

const mockGetToken = getToken as unknown as jest.Mock;
const mockLoad = loadLatestConversation as unknown as jest.Mock;
const SIGNED_IN = { sub: 'user_a', email: 'a@x.com', role: 'USER' };

const req = () =>
  new NextRequest('https://x.test/api/assistant/conversations/latest');

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = 'test-secret-for-the-resume-route';
  mockGetToken.mockReset();
  mockLoad.mockReset();
});

describe('GET the conversation to resume', () => {
  it('returns the customers latest conversation and its turns', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    mockLoad.mockResolvedValue({
      id: 'conv_1',
      title: null,
      turns: [
        {
          utterance: 'what did I order?',
          events: [{ v: 1, seq: 0, type: 'message', data: { text: 'ORD-1' } }],
        },
      ],
    });

    const { data } = await (await GET(req())).json();

    expect(mockLoad).toHaveBeenCalledWith('user_a');
    expect(data.conversation.id).toBe('conv_1');
    expect(data.conversation.turns[0].utterance).toBe('what did I order?');
  });

  it('answers with null rather than 404 for a customer who has never chatted', async () => {
    // "You have no conversations" is a normal state, not an error. A 404
    // would put the panel into its failure branch on a first visit.
    mockGetToken.mockResolvedValue(SIGNED_IN);
    mockLoad.mockResolvedValue(null);

    const response = await GET(req());
    const { data } = await response.json();

    expect(response.status).toBe(200);
    expect(data.conversation).toBeNull();
  });

  it('refuses an unauthenticated caller', async () => {
    mockGetToken.mockResolvedValue(null);

    expect((await GET(req())).status).toBe(401);
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('asks only for the signed-in customers conversation', async () => {
    // The route never takes a user id from the caller. There is nothing
    // to tamper with.
    mockGetToken.mockResolvedValue({ ...SIGNED_IN, sub: 'user_b' });
    mockLoad.mockResolvedValue(null);

    await GET(req());

    expect(mockLoad).toHaveBeenCalledWith('user_b');
  });
});
