// lib/assistant/history-budget.ts
//
// The ceiling on what one conversation may cost to remember.
//
// Phase 5 of the chat-persistence roadmap. The agent is stateless, so
// every turn carries its own history, and a chat that ran all afternoon
// would otherwise send an afternoon's worth of tokens on every message.
//
// THIS HAS TO HOLD ON ITS OWN. Phase 6 layers model summarisation on top
// of it, and the whole reason the budget was chosen over summarisation
// alone is that a summariser can fail. When it does, the ceiling is still
// this function dropping the oldest turns.
//
// NO DATABASE IN HERE. It is arithmetic over rows somebody else fetched,
// which is what lets it be tested exhaustively with no Prisma mock.

/** The only roles a turn of the agent can produce. */
const REPLAYABLE_ROLES = new Set(['user', 'assistant', 'tool']);

/** How many characters of JSON are treated as one token. */
const CHARS_PER_TOKEN = 4;

/** One stored turn, as the store hands it over. */
export interface StoredContext {
  agentContext: unknown;
}

/**
 * Roughly how many tokens these messages cost.
 *
 * AN ESTIMATE, AND DELIBERATELY SO. A real tokeniser would be a new
 * dependency in the storefront to make a number more precise that only
 * needs to be SAFE, and the budget it is compared against is set far
 * below anything the model would refuse. Four characters per token is the
 * usual English rule of thumb; JSON punctuation makes it pessimistic,
 * which is the direction to be wrong in.
 */
export function estimateTokens(messages: unknown[]): number {
  if (messages.length === 0) return 0;

  // Ceil, so a message can never cost nothing -- a zero-cost message
  // would be a way to replay an unbounded number of them inside any
  // budget at all.
  return Math.ceil(JSON.stringify(messages).length / CHARS_PER_TOKEN);
}

/**
 * The messages of one stored turn, or null if it cannot be replayed.
 *
 * Null covers a turn from before Phase 5 (its context is `null`), a row
 * that is not a message list, and a row carrying a role a turn cannot
 * produce. The caller treats all three the same way, because all three
 * mean the same thing: replay cannot continue past here.
 */
function replayableTurn(context: unknown): unknown[] | null {
  if (!Array.isArray(context) || context.length === 0) return null;

  for (const message of context) {
    if (typeof message !== 'object' || message === null) return null;

    const role = (message as { role?: unknown }).role;
    // An allowlist, not a ban on `system`: the API already has
    // `developer` with the same authority, and a denylist written today
    // is wrong the moment a third such role appears.
    if (typeof role !== 'string' || !REPLAYABLE_ROLES.has(role)) return null;
  }

  return context;
}

/**
 * The earlier turns to replay, oldest first, inside the budget.
 *
 * Turns arrive oldest-first (the order the store reads them) and are
 * SELECTED newest-first, because the recent exchange is what a follow-up
 * question refers to.
 *
 * ONE STOPPING RULE: the walk stops at the first turn that cannot be
 * replayed, whether because it does not fit or because it is not a
 * well-formed message list. It never skips one and carries on.
 *
 *   - A gap in the middle is worse than a shorter history. The model
 *     cannot tell that something was removed, and will read the turns it
 *     can see as consecutive.
 *   - A turn is the smallest safe unit. Each stored context opens with
 *     the customer's message, answers every tool call it makes and ends
 *     with prose, so any run of CONSECUTIVE ones is a valid request --
 *     and half of one is a tool call nothing answers, which the API
 *     refuses outright.
 *   - It is also what makes the pre-Phase-5 rows harmless. They hold
 *     null, so replay simply starts after the newest of them.
 */
export function buildHistory(turns: StoredContext[], budget: number): unknown[] {
  const kept: unknown[][] = [];
  let spent = 0;

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const messages = replayableTurn(turns[index].agentContext);
    if (messages === null) break;

    const cost = estimateTokens(messages);
    if (spent + cost > budget) break;

    spent += cost;
    kept.unshift(messages);
  }

  return kept.flat();
}
