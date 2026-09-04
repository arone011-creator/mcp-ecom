// tests/integration/api-assistant-conversations.test.ts
//
// What the panel asks for when it loads: the conversation to resume.

jest.mock('@/lib/assistant/conversation-store', () => ({
  loadLatestConversation: jest.fn(),
  listConversations: jest.fn(),
  loadConversation: jest.fn(),
  deleteConversation: jest.fn(),
}));

jest.mock('next-auth/jwt', () => ({
  ...jest.requireActual('next-auth/jwt'),
  getToken: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import { GET as GET_LATEST } from '@/app/api/assistant/conversations/latest/route';
import { GET as GET_LIST } from '@/app/api/assistant/conversations/route';
import {
  GET as GET_ONE,
  DELETE as DELETE_ONE,
} from '@/app/api/assistant/conversations/[id]/route';
import {
  deleteConversation,
  listConversations,
  loadConversation,
  loadLatestConversation,
} from '@/lib/assistant/conversation-store';

const mockGetToken = getToken as unknown as jest.Mock;
const mockLoad = loadLatestConversation as unknown as jest.Mock;
const mockList = listConversations as unknown as jest.Mock;
const mockLoadOne = loadConversation as unknown as jest.Mock;
const mockDelete = deleteConversation as unknown as jest.Mock;
const SIGNED_IN = { sub: 'user_a', email: 'a@x.com', role: 'USER' };

const req = () =>
  new NextRequest('https://x.test/api/assistant/conversations/latest');

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = 'test-secret-for-the-resume-route';
  mockGetToken.mockReset();
  mockLoad.mockReset();
  mockList.mockReset();
  mockLoadOne.mockReset();
  mockDelete.mockReset();
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

    const { data } = await (await GET_LATEST(req())).json();

    expect(mockLoad).toHaveBeenCalledWith('user_a');
    expect(data.conversation.id).toBe('conv_1');
    expect(data.conversation.turns[0].utterance).toBe('what did I order?');
  });

  it('answers with null rather than 404 for a customer who has never chatted', async () => {
    // "You have no conversations" is a normal state, not an error. A 404
    // would put the panel into its failure branch on a first visit.
    mockGetToken.mockResolvedValue(SIGNED_IN);
    mockLoad.mockResolvedValue(null);

    const response = await GET_LATEST(req());
    const { data } = await response.json();

    expect(response.status).toBe(200);
    expect(data.conversation).toBeNull();
  });

  it('refuses an unauthenticated caller', async () => {
    mockGetToken.mockResolvedValue(null);

    expect((await GET_LATEST(req())).status).toBe(401);
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('asks only for the signed-in customers conversation', async () => {
    // The route never takes a user id from the caller. There is nothing
    // to tamper with.
    mockGetToken.mockResolvedValue({ ...SIGNED_IN, sub: 'user_b' });
    mockLoad.mockResolvedValue(null);

    await GET_LATEST(req());

    expect(mockLoad).toHaveBeenCalledWith('user_b');
  });
});

const listReq = () =>
  new NextRequest('https://x.test/api/assistant/conversations');

const oneReq = () =>
  new NextRequest('https://x.test/api/assistant/conversations/conv_1');

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('GET the list of chats', () => {
  it('returns the signed-in customers chats', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    mockList.mockResolvedValue([
      { id: 'conv_2', name: 'Cancelling an order', lastTurnAt: new Date() },
      { id: 'conv_1', name: 'what did I order?', lastTurnAt: new Date() },
    ]);

    const { data } = await (await GET_LIST(listReq())).json();

    expect(mockList).toHaveBeenCalledWith('user_a');
    expect(data.conversations.map((c: { id: string }) => c.id)).toEqual([
      'conv_2',
      'conv_1',
    ]);
  });

  it('returns an empty list, not an error, for a customer with no chats', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    mockList.mockResolvedValue([]);

    const response = await GET_LIST(listReq());
    const { data } = await response.json();

    expect(response.status).toBe(200);
    expect(data.conversations).toEqual([]);
  });

  it('refuses an unauthenticated caller', async () => {
    mockGetToken.mockResolvedValue(null);

    expect((await GET_LIST(listReq())).status).toBe(401);
    expect(mockList).not.toHaveBeenCalled();
  });

  it('takes no user id from the caller', async () => {
    mockGetToken.mockResolvedValue({ ...SIGNED_IN, sub: 'user_b' });
    mockList.mockResolvedValue([]);

    await GET_LIST(listReq());

    expect(mockList).toHaveBeenCalledWith('user_b');
  });
});

describe('GET one chat', () => {
  it('returns it with its turns', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    mockLoadOne.mockResolvedValue({
      id: 'conv_1',
      title: null,
      turns: [
        {
          utterance: 'what did I order?',
          events: [{ v: 1, seq: 0, type: 'message', data: { text: 'ORD-1' } }],
        },
      ],
    });

    const { data } = await (await GET_ONE(oneReq(), params('conv_1'))).json();

    expect(mockLoadOne).toHaveBeenCalledWith('user_a', 'conv_1');
    expect(data.conversation.turns[0].utterance).toBe('what did I order?');
  });

  it('answers 404 for somebody elses chat, and for one that does not exist', async () => {
    // The SAME answer for both. A distinguishable refusal confirms that a
    // stranger's id is real, which is all an enumeration attack needs.
    mockGetToken.mockResolvedValue(SIGNED_IN);
    mockLoadOne.mockResolvedValue(null);

    expect((await GET_ONE(oneReq(), params('conv_1'))).status).toBe(404);
  });

  it('refuses an unauthenticated caller', async () => {
    mockGetToken.mockResolvedValue(null);

    expect((await GET_ONE(oneReq(), params('conv_1'))).status).toBe(401);
    expect(mockLoadOne).not.toHaveBeenCalled();
  });
});

describe('DELETE one chat', () => {
  it('deletes it and says so', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    mockDelete.mockResolvedValue(true);

    const response = await DELETE_ONE(oneReq(), params('conv_1'));
    const { data } = await response.json();

    expect(response.status).toBe(200);
    expect(data.deleted).toBe(true);
    expect(mockDelete).toHaveBeenCalledWith('user_a', 'conv_1');
  });

  it('answers 404 when there was nothing of this customers to delete', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    mockDelete.mockResolvedValue(false);

    expect((await DELETE_ONE(oneReq(), params('conv_1'))).status).toBe(404);
  });

  it('refuses an unauthenticated caller without deleting anything', async () => {
    mockGetToken.mockResolvedValue(null);

    expect((await DELETE_ONE(oneReq(), params('conv_1'))).status).toBe(401);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
