// lib/assistant/conversation-store.ts
//
// Every database access for an assistant conversation, in one place.
//
// WHY ONE MODULE. Ownership is part of every query here, and ownership
// scattered across route handlers is how one customer ends up reading
// another's data -- a mistake this codebase already made once, in M1,
// with a cached order read. Filtering by userId inside the query rather
// than checking after it means a stranger's id simply finds nothing,
// with no path that can forget the check.
//
// Nothing in here interprets `agentContext`. It is the agent's own
// message format, stored opaquely and handed back untouched in Phase 5.

import prisma from '@/lib/prisma';

export interface StoredTurn {
  utterance: string;
  events: unknown[];
}

export interface StoredConversation {
  id: string;
  title: string | null;
  turns: StoredTurn[];
}

/** Begin a conversation. Called on the customer's FIRST message, never before. */
export async function startConversation(userId: string): Promise<string> {
  const conversation = await prisma.conversation.create({
    data: { userId },
    select: { id: true },
  });

  return conversation.id;
}

/**
 * The conversation, if this customer owns it. Null otherwise.
 *
 * Null covers both "does not exist" and "belongs to someone else", and the
 * callers answer 404 for both: a distinguishable refusal confirms that a
 * stranger's id is real, which is all an enumeration attack needs.
 */
export async function ownedConversation(userId: string, id: string) {
  return prisma.conversation.findFirst({
    where: { id, userId },
    select: { id: true },
  });
}

/**
 * Record one exchange.
 *
 * `seq` comes from the highest already stored. Two turns racing in one
 * conversation would collide on the (conversationId, seq) unique index --
 * a loud failure rather than silent reordering. The provider serialises
 * sends anyway, so the race needs two tabs to happen at all.
 */
export async function appendTurn(turn: {
  conversationId: string;
  utterance: string;
  events: unknown[];
  agentContext?: unknown;
}): Promise<void> {
  const highest = await prisma.conversationTurn.aggregate({
    where: { conversationId: turn.conversationId },
    _max: { seq: true },
  });

  const seq = highest._max.seq === null ? 0 : highest._max.seq + 1;

  await prisma.conversationTurn.create({
    data: {
      conversationId: turn.conversationId,
      seq,
      utterance: turn.utterance,
      events: turn.events as never,
      agentContext: (turn.agentContext ?? null) as never,
    },
  });

  // The history list orders by this. Without it a conversation you replied
  // to today sorts beneath one you abandoned last week.
  await prisma.conversation.update({
    where: { id: turn.conversationId },
    data: { lastTurnAt: new Date() },
  });
}

/** The conversation to resume, or null if this customer has never chatted. */
export async function loadLatestConversation(
  userId: string
): Promise<StoredConversation | null> {
  const conversation = await prisma.conversation.findFirst({
    where: { userId },
    orderBy: { lastTurnAt: 'desc' },
    // `select`, not `include`: the same allowlisting discipline publicOrder
    // uses. A column added later must not start appearing in an API
    // response by accident.
    select: {
      id: true,
      title: true,
      turns: {
        orderBy: { seq: 'asc' },
        select: { utterance: true, events: true },
      },
    },
  });

  if (!conversation) return null;

  return {
    id: conversation.id,
    title: conversation.title,
    turns: conversation.turns.map((turn) => ({
      utterance: turn.utterance,
      events: (turn.events ?? []) as unknown[],
    })),
  };
}

/** The longest a fallback name may be before it is cut short. */
const NAME_LIMIT = 60;

export interface ListedConversation {
  id: string;
  /** What to show in the list: the title, or what the customer first said. */
  name: string;
  lastTurnAt: Date;
}

/**
 * Turn a first utterance into something that fits a narrow list.
 *
 * Phase 4 replaces this with a model-generated title, and this stays as
 * the fallback for a title call that failed -- so a chat is never nameless
 * and a failed title never blocks anything.
 */
function fallbackName(utterance: string | undefined): string {
  const trimmed = (utterance ?? '').trim();
  if (!trimmed) return 'New chat';
  if (trimmed.length <= NAME_LIMIT) return trimmed;

  return `${trimmed.slice(0, NAME_LIMIT - 3)}...`;
}

/** Every chat this customer has, most recently active first. */
export async function listConversations(
  userId: string
): Promise<ListedConversation[]> {
  const rows = await prisma.conversation.findMany({
    where: { userId },
    orderBy: { lastTurnAt: 'desc' },
    select: {
      id: true,
      title: true,
      lastTurnAt: true,
      // ONE turn each. Fetching every turn of every conversation to render
      // a sidebar would grow with the customer's history.
      turns: { orderBy: { seq: 'asc' }, take: 1, select: { utterance: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.title ?? fallbackName(row.turns[0]?.utterance),
    lastTurnAt: row.lastTurnAt,
  }));
}

/** One chat in full, if this customer owns it. Null otherwise. */
export async function loadConversation(
  userId: string,
  id: string
): Promise<StoredConversation | null> {
  const conversation = await prisma.conversation.findFirst({
    where: { id, userId },
    select: {
      id: true,
      title: true,
      turns: {
        orderBy: { seq: 'asc' },
        select: { utterance: true, events: true },
      },
    },
  });

  if (!conversation) return null;

  return {
    id: conversation.id,
    title: conversation.title,
    turns: conversation.turns.map((turn) => ({
      utterance: turn.utterance,
      events: (turn.events ?? []) as unknown[],
    })),
  };
}

/**
 * Remove a chat. True if one was removed, false if there was nothing of
 * this customer's to remove.
 *
 * deleteMany rather than delete: delete THROWS when nothing matches, and a
 * thrown error is a different observable answer from "not yours" -- which
 * is exactly the distinction an enumeration attack is looking for. The
 * turns go with it through the schema's onDelete: Cascade.
 */
export async function deleteConversation(
  userId: string,
  id: string
): Promise<boolean> {
  const { count } = await prisma.conversation.deleteMany({
    where: { id, userId },
  });

  return count > 0;
}
