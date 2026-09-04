// tests/integration/assistant-conversation-store.test.ts
//
// Every database access for a chat lives in one module, and every query in
// it filters by userId. Ownership scattered across route handlers is how
// one customer reads another's data -- a mistake this codebase already made
// once, in M1, with a cached order read.

const mockPrisma = {
  conversation: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  conversationTurn: {
    create: jest.fn(),
    aggregate: jest.fn(),
  },
  $transaction: jest.fn(),
};
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: mockPrisma }));

import {
  appendTurn,
  loadLatestConversation,
  ownedConversation,
  startConversation,
} from '@/lib/assistant/conversation-store';

beforeEach(() => {
  mockPrisma.conversation.create.mockReset();
  mockPrisma.conversation.findFirst.mockReset();
  mockPrisma.conversation.update.mockReset();
  mockPrisma.conversationTurn.create.mockReset();
  mockPrisma.conversationTurn.aggregate.mockReset();
});

describe('startConversation', () => {
  it('creates one owned by the customer who started it', async () => {
    mockPrisma.conversation.create.mockResolvedValue({ id: 'conv_1' });

    expect(await startConversation('user_a')).toBe('conv_1');
    expect(mockPrisma.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'user_a' }),
      })
    );
  });
});

describe('ownedConversation', () => {
  it('finds a conversation the customer owns', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValue({ id: 'conv_1' });

    expect(await ownedConversation('user_a', 'conv_1')).toEqual({ id: 'conv_1' });
  });

  it('filters by user in the QUERY, not after it', async () => {
    // Fetch-then-check leaks through any path that forgets the check.
    // Filtering in the query means a stranger's id simply finds nothing.
    mockPrisma.conversation.findFirst.mockResolvedValue(null);

    await ownedConversation('user_a', 'conv_1');

    expect(mockPrisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'conv_1', userId: 'user_a' } })
    );
  });

  it('answers null for somebody elses conversation', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValue(null);

    expect(await ownedConversation('user_b', 'conv_1')).toBeNull();
  });
});

describe('appendTurn', () => {
  it('numbers the first turn 0', async () => {
    mockPrisma.conversationTurn.aggregate.mockResolvedValue({ _max: { seq: null } });
    mockPrisma.conversationTurn.create.mockResolvedValue({});
    mockPrisma.conversation.update.mockResolvedValue({});

    await appendTurn({
      conversationId: 'conv_1',
      utterance: 'hello',
      events: [{ v: 1, seq: 0, type: 'message', data: { text: 'hi' } }],
    });

    expect(mockPrisma.conversationTurn.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ seq: 0, utterance: 'hello' }),
      })
    );
  });

  it('numbers the next turn after the highest already stored', async () => {
    mockPrisma.conversationTurn.aggregate.mockResolvedValue({ _max: { seq: 4 } });
    mockPrisma.conversationTurn.create.mockResolvedValue({});
    mockPrisma.conversation.update.mockResolvedValue({});

    await appendTurn({ conversationId: 'conv_1', utterance: 'again', events: [] });

    expect(mockPrisma.conversationTurn.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ seq: 5 }) })
    );
  });

  it('moves the conversation to the top of the list', async () => {
    // lastTurnAt is what the history list orders by. Without this a
    // conversation you replied to today sorts under one you abandoned
    // last week.
    mockPrisma.conversationTurn.aggregate.mockResolvedValue({ _max: { seq: null } });
    mockPrisma.conversationTurn.create.mockResolvedValue({});
    mockPrisma.conversation.update.mockResolvedValue({});

    await appendTurn({ conversationId: 'conv_1', utterance: 'hello', events: [] });

    expect(mockPrisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conv_1' },
        data: expect.objectContaining({ lastTurnAt: expect.any(Date) }),
      })
    );
  });
});

describe('loadLatestConversation', () => {
  it('returns the customers most recent conversation with its turns in order', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValue({
      id: 'conv_1',
      title: 'Recent orders',
      turns: [
        {
          utterance: 'what did I order?',
          events: [{ v: 1, seq: 0, type: 'message', data: { text: 'ORD-1' } }],
        },
      ],
    });

    const loaded = await loadLatestConversation('user_a');

    expect(loaded).toEqual({
      id: 'conv_1',
      title: 'Recent orders',
      turns: [
        {
          utterance: 'what did I order?',
          events: [{ v: 1, seq: 0, type: 'message', data: { text: 'ORD-1' } }],
        },
      ],
    });

    const query = mockPrisma.conversation.findFirst.mock.calls[0]![0];
    expect(query.where).toEqual({ userId: 'user_a' });
    expect(query.orderBy).toEqual({ lastTurnAt: 'desc' });
    expect(query.select.turns.orderBy).toEqual({ seq: 'asc' });
  });

  it('answers null when the customer has never chatted', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValue(null);

    expect(await loadLatestConversation('user_a')).toBeNull();
  });
});
