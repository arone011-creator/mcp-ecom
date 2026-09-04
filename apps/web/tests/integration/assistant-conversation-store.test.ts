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
    findMany: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
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
  deleteConversation,
  listConversations,
  loadAgentContext,
  loadConversation,
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
  mockPrisma.conversation.findMany.mockReset();
  mockPrisma.conversation.deleteMany.mockReset();
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

describe('listConversations', () => {
  it('returns the customers chats, newest activity first', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([
      {
        id: 'conv_2',
        title: 'Cancelling an order',
        lastTurnAt: new Date('2026-09-04T11:00:00.000Z'),
        turns: [{ utterance: 'cancel ORD-9 please' }],
      },
      {
        id: 'conv_1',
        title: null,
        lastTurnAt: new Date('2026-09-03T09:00:00.000Z'),
        turns: [{ utterance: 'what did I order recently?' }],
      },
    ]);

    const listed = await listConversations('user_a');

    expect(listed.map((c) => c.id)).toEqual(['conv_2', 'conv_1']);

    const query = mockPrisma.conversation.findMany.mock.calls[0]![0];
    expect(query.where).toEqual({ userId: 'user_a' });
    expect(query.orderBy).toEqual({ lastTurnAt: 'desc' });
  });

  it('names an untitled chat by what the customer first said', async () => {
    // Phase 4 fills `title`. Until then the list must still read as a
    // list of chats rather than a column of identical placeholders.
    mockPrisma.conversation.findMany.mockResolvedValue([
      {
        id: 'conv_1',
        title: null,
        lastTurnAt: new Date(),
        turns: [{ utterance: 'what did I order recently?' }],
      },
    ]);

    expect((await listConversations('user_a'))[0]!.name).toBe(
      'what did I order recently?'
    );
  });

  it('prefers a real title over the fallback once there is one', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([
      {
        id: 'conv_1',
        title: 'Recent orders',
        lastTurnAt: new Date(),
        turns: [{ utterance: 'what did I order recently?' }],
      },
    ]);

    expect((await listConversations('user_a'))[0]!.name).toBe('Recent orders');
  });

  it('shortens a very long first message rather than letting it run', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([
      {
        id: 'conv_1',
        title: null,
        lastTurnAt: new Date(),
        turns: [{ utterance: 'x'.repeat(200) }],
      },
    ]);

    const name = (await listConversations('user_a'))[0]!.name;
    expect(name.length).toBeLessThanOrEqual(60);
    expect(name.endsWith('...')).toBe(true);
  });

  it('asks for only the FIRST turn of each chat', async () => {
    // The list needs one utterance per chat. Fetching every turn of every
    // conversation to render a sidebar would grow with the history.
    mockPrisma.conversation.findMany.mockResolvedValue([]);

    await listConversations('user_a');

    const turns = mockPrisma.conversation.findMany.mock.calls[0]![0].select.turns;
    expect(turns.take).toBe(1);
    expect(turns.orderBy).toEqual({ seq: 'asc' });
  });

  it('survives a chat with no turns at all', async () => {
    // Should not happen -- rows are created on the first message -- but a
    // list that throws is worse than one that shows a placeholder.
    mockPrisma.conversation.findMany.mockResolvedValue([
      { id: 'conv_1', title: null, lastTurnAt: new Date(), turns: [] },
    ]);

    expect((await listConversations('user_a'))[0]!.name).toBe('New chat');
  });
});

describe('loadConversation', () => {
  it('returns one the customer owns, turns in order', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValue({
      id: 'conv_1',
      title: null,
      turns: [
        {
          utterance: 'what did I order?',
          events: [{ v: 1, seq: 0, type: 'message', data: { text: 'ORD-1' } }],
        },
      ],
    });

    const loaded = await loadConversation('user_a', 'conv_1');

    expect(loaded).toEqual({
      id: 'conv_1',
      title: null,
      turns: [
        {
          utterance: 'what did I order?',
          events: [{ v: 1, seq: 0, type: 'message', data: { text: 'ORD-1' } }],
        },
      ],
    });

    const query = mockPrisma.conversation.findFirst.mock.calls[0]![0];
    expect(query.where).toEqual({ id: 'conv_1', userId: 'user_a' });
    expect(query.select.turns.orderBy).toEqual({ seq: 'asc' });
  });

  it('answers null for somebody elses chat', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValue(null);

    expect(await loadConversation('user_b', 'conv_1')).toBeNull();
  });
});

describe('deleteConversation', () => {
  it('deletes only a chat this customer owns', async () => {
    // deleteMany, not delete: delete throws when nothing matches, and a
    // thrown error is a different answer from "not yours" -- which is
    // exactly the distinction an enumeration attack is looking for.
    mockPrisma.conversation.deleteMany.mockResolvedValue({ count: 1 });

    expect(await deleteConversation('user_a', 'conv_1')).toBe(true);
    expect(mockPrisma.conversation.deleteMany).toHaveBeenCalledWith({
      where: { id: 'conv_1', userId: 'user_a' },
    });
  });

  it('reports nothing deleted for somebody elses chat', async () => {
    mockPrisma.conversation.deleteMany.mockResolvedValue({ count: 0 });

    expect(await deleteConversation('user_b', 'conv_1')).toBe(false);
  });
});

describe('loadAgentContext', () => {
  it('reads every turn of a chat the customer owns, oldest first', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValue({
      turns: [
        { agentContext: [{ role: 'user', content: 'one' }] },
        { agentContext: [{ role: 'user', content: 'two' }] },
      ],
    });

    const context = await loadAgentContext('user_a', 'conv_1');

    expect(context).toEqual([
      { agentContext: [{ role: 'user', content: 'one' }] },
      { agentContext: [{ role: 'user', content: 'two' }] },
    ]);
    expect(mockPrisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conv_1', userId: 'user_a' },
      })
    );
  });

  it('orders the turns by seq, not by whatever the database returns', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValue({ turns: [] });

    await loadAgentContext('user_a', 'conv_1');

    const [args] = mockPrisma.conversation.findFirst.mock.calls[0];
    expect(args.select.turns.orderBy).toEqual({ seq: 'asc' });
  });

  it('reads nothing but the agent context', async () => {
    // The customer's utterances and the display events are already loaded
    // elsewhere, for the panel. Selecting them here would pull a whole
    // chat into memory on every single turn.
    mockPrisma.conversation.findFirst.mockResolvedValue({ turns: [] });

    await loadAgentContext('user_a', 'conv_1');

    const [args] = mockPrisma.conversation.findFirst.mock.calls[0];
    expect(args.select.turns.select).toEqual({ agentContext: true });
  });

  it('finds nothing for another customer, rather than refusing loudly', async () => {
    // Ownership is inside the query, like every other function here. A
    // stranger's id simply finds nothing.
    mockPrisma.conversation.findFirst.mockResolvedValue(null);

    expect(await loadAgentContext('user_b', 'conv_1')).toEqual([]);
  });

  it('reads an empty record for a chat with no turns yet', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValue({ turns: [] });

    expect(await loadAgentContext('user_a', 'conv_1')).toEqual([]);
  });
});
