# Chat Phase 2: Storage and Resume — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a conversation survives closing the panel, logging out and restarting the browser. Reopening the assistant shows the chat you were last having.

**Architecture:** two tables — `conversations` and `conversation_turns` — owned by the storefront. The bridge route already sees every event on its way to the browser, so it accumulates them and writes one row per turn when the stream ends. The browser learns which conversation it is in from an `x-conversation-id` response header. On mount the provider asks for the most recent conversation and hydrates `turns` from it, which is exactly the shape Phase 1 already put them in.

**Tech Stack:** Next.js App Router, Prisma + Postgres (Supabase), Jest (`unit` / `integration` projects).

**Not in this phase:** the history list and `+` button (Phase 3), titles (Phase 4), agent memory (Phase 5), summarisation (Phase 6). `title`, `summary`, `summarisedThrough` and `agentContext` are created by this migration but stay unused — see the migration note below for why that is deliberate rather than speculative.

---

## ⚠️ Read before Task 1: how the migration reaches production

**This is the one thing in this plan I cannot do, and it is not a detail.**

`prisma migrate deploy` **never runs automatically today.** The `web` service has no pre-deploy command and no custom start command; its build is `prisma generate && next build`. The `db:migrate:deploy` script exists and the deploy-config test asserts it exists, but nothing invokes it. So the production schema is presumably where it is because someone ran `db push` or a migration by hand.

That means shipping this phase requires a decision from you, and there are three ways:

| Option | What it means | My view |
|---|---|---|
| **A. Add a Railway pre-deploy command** `npm run db:migrate:deploy` on the `web` service | Every future deploy applies pending migrations before the new container takes traffic | **Recommended.** It is the standard answer, it makes the existing `db:migrate:deploy` script real, and it fixes a latent gap rather than working around it. A failed migration blocks the deploy, which is the correct failure. |
| **B. You run `npx prisma migrate deploy` once, locally, against the production `DIRECT_URL`** | One-off, nothing changes about deploys | Fine for this migration, leaves the gap open for the next one. I cannot do this for you — it needs production database credentials, which I will not ask for or handle. |
| **C. Apply the SQL through some other tool** | e.g. the Supabase dashboard | **Avoid.** Prisma's `_prisma_migrations` table would not learn about it, so the next `migrate deploy` sees drift and can refuse or, worse, try to reapply. |

**Tasks 1–5 are all safe to build and merge without this decision** — nothing reads the new tables until Task 3, and the code is behind the same deploy. But the phase is not *done*, and must not be deployed, until the migration is applied. Task 6 is that gate.

**Why one migration creates columns this phase does not use.** `title`, `summary`, `summarisedThrough` and `agentContext` belong to Phases 4–6. Adding them now costs four nullable columns; adding them later costs three more migrations against a live database. Schema changes against production are the highest-risk operation in this whole roadmap, and the data model was settled in full during brainstorming precisely so we could do exactly one. That is the trade being made — it is not "we might need it later".

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `prisma/schema.prisma` | data model | add `Conversation`, `ConversationTurn`, relation on `User` |
| `prisma/migrations/20260903190000_add_assistant_conversations/migration.sql` | the migration | create |
| `lib/assistant/conversation-store.ts` | every database access for chats | create |
| `tests/integration/assistant-conversation-store.test.ts` | store tests | create |
| `app/api/assistant/route.ts` | the bridge | persist the turn; `x-conversation-id` |
| `tests/integration/api-assistant-bridge.test.ts` | bridge tests | add persistence tests |
| `app/api/assistant/conversations/latest/route.ts` | resume | create |
| `tests/integration/api-assistant-conversations.test.ts` | route tests | create |
| `components/assistant/assistant-provider.tsx` | conversation state | hydrate on mount; carry `conversationId` |
| `tests/unit/assistant-provider.test.tsx` | provider tests | add hydration tests |

**Why a store module rather than Prisma calls inside routes.** Three callers touch these tables in this phase and five more do in Phases 3–6. Ownership is part of every one of those queries, and ownership scattered across route handlers is how one user reads another's data — a mistake this codebase has already made once, in M1, with a cached order read. One module, and every query in it filters by `userId`.

---

## Task 1: the schema and the migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260903190000_add_assistant_conversations/migration.sql`

All commands run from `mcp-ecom-web-app/apps/web/`.

- [ ] **Step 1: Add the models**

Append to `prisma/schema.prisma`:

```prisma
/// One assistant conversation, owned by the customer who had it.
///
/// `summary` and `summarisedThrough` are written by Phase 6 and `title` by
/// Phase 4; they exist now so this migration is the only one this roadmap
/// runs against a live database.
model Conversation {
  id                String   @id @default(cuid())
  userId            String
  title             String?
  summary           String?
  summarisedThrough Int      @default(0)
  /// When the last turn landed. The history list orders by this, not by
  /// createdAt -- a conversation you replied to today belongs at the top.
  lastTurnAt        DateTime @default(now())
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  user  User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  turns ConversationTurn[]

  @@index([userId, lastTurnAt])
  @@map("conversations")
}

/// One exchange: what the customer said, and everything the assistant did
/// about it.
///
/// `events` is the v1 event stream the panel renders. `agentContext` is the
/// opaque model-message blob Phase 5 replays; the storefront never parses it.
/// They deliberately overlap -- the event contract is frozen and display-only,
/// and deriving one from the other would be a third implementation of a
/// mapping that already has two.
model ConversationTurn {
  id             String   @id @default(cuid())
  conversationId String
  seq            Int
  utterance      String
  events         Json
  agentContext   Json?
  createdAt      DateTime @default(now())

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@unique([conversationId, seq])
  @@map("conversation_turns")
}
```

And add to the `User` model's relations, beside `reviews`:

```prisma
  conversations Conversation[]
```

- [ ] **Step 2: Write the migration by hand**

Create `prisma/migrations/20260903190000_add_assistant_conversations/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "summary" TEXT,
    "summarisedThrough" INTEGER NOT NULL DEFAULT 0,
    "lastTurnAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_turns" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "utterance" TEXT NOT NULL,
    "events" JSONB NOT NULL,
    "agentContext" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_turns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_userId_lastTurnAt_idx" ON "conversations"("userId", "lastTurnAt");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_turns_conversationId_seq_key" ON "conversation_turns"("conversationId", "seq");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Hand-written deliberately: `prisma migrate dev` needs a shadow database, and this project has no local Postgres configured. Two `CREATE TABLE`s are small enough to read, and being additive-only they cannot damage existing data — no column is dropped, no type changed, nothing backfilled.

- [ ] **Step 3: Verify the client generates and the schema is valid**

Run: `npx prisma validate && npx prisma generate`

Expected: `The schema at prisma/schema.prisma is valid` followed by `Generated Prisma Client`.

- [ ] **Step 4: Confirm the generated client knows the new models**

Run: `npx tsc --noEmit`

Expected: clean. (Nothing uses them yet; this proves the client regenerated rather than serving a stale copy.)

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: tables for assistant conversations

Two tables, one migration. The turn is the unit because it is already the
shape the provider holds -- utterance plus the events that answered it --
so persistence is append-only and hydration is one query.

The migration also creates four columns this phase does not use: title
(Phase 4), summary and summarisedThrough (Phase 6), agentContext (Phase 5).
That is deliberate. Schema changes against a live database are the
riskiest step in this roadmap, the data model was settled in full during
brainstorming, and four nullable columns now costs less than three more
migrations later.

Hand-written SQL: prisma migrate dev needs a shadow database this project
does not have. Additive only -- no column dropped, no type changed,
nothing backfilled.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: the conversation store

**Files:**
- Create: `lib/assistant/conversation-store.ts`
- Test: `tests/integration/assistant-conversation-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/assistant-conversation-store.test.ts`:

```typescript
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
      expect.objectContaining({ data: expect.objectContaining({ userId: 'user_a' }) })
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

  it('answers null for somebody else’s conversation', async () => {
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
  it('returns the customer’s most recent conversation with its turns in order', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValue({
      id: 'conv_1',
      title: 'Recent orders',
      turns: [
        { utterance: 'what did I order?', events: [{ v: 1, seq: 0, type: 'message', data: { text: 'ORD-1' } }] },
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
    expect(query.include.turns.orderBy).toEqual({ seq: 'asc' });
  });

  it('answers null when the customer has never chatted', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValue(null);

    expect(await loadLatestConversation('user_a')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest --selectProjects integration tests/integration/assistant-conversation-store.test.ts`

Expected: FAIL — `Cannot find module '@/lib/assistant/conversation-store'`.

- [ ] **Step 3: Write the store**

Create `lib/assistant/conversation-store.ts`:

```typescript
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
```

Note the test asserts `query.include.turns.orderBy` while this uses `select`. Change the test to `query.select.turns.orderBy` — `select` is right here, because it is the same allowlisting discipline `publicOrder` uses: a column added later must not start appearing in an API response by accident.

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest --selectProjects integration tests/integration/assistant-conversation-store.test.ts`

Expected: PASS, 8 tests.

- [ ] **Step 5: Mutation-check ownership**

Apply each, confirm FAIL, revert:

1. `where: { id, userId }` → `where: { id }` in `ownedConversation` → `filters by user in the QUERY, not after it` fails.
2. `where: { userId }` → `where: {}` in `loadLatestConversation` → the `where` assertion fails.
3. `highest._max.seq + 1` → `0` → `numbers the next turn after the highest already stored` fails.
4. Delete the `conversation.update` call → `moves the conversation to the top of the list` fails.

- [ ] **Step 6: Commit**

```bash
git add lib/assistant/conversation-store.ts tests/integration/assistant-conversation-store.test.ts
git commit -m "feat: one module for every chat database access

Ownership is part of every query rather than a check after it, so a
stranger's conversation id finds nothing instead of relying on a caller
to remember. That is the M1 cached-order-read mistake, and it is worth
being structural about.

Mutation-tested: 4 mutations, all caught.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: the bridge persists each turn

**Files:**
- Modify: `app/api/assistant/route.ts`
- Test: `tests/integration/api-assistant-bridge.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/integration/api-assistant-bridge.test.ts`. It already mocks `next-auth/jwt`; add a mock for the store at the top, beside the existing mocks:

```typescript
jest.mock('@/lib/assistant/conversation-store', () => ({
  startConversation: jest.fn(),
  ownedConversation: jest.fn(),
  appendTurn: jest.fn(),
}));
```

and import them:

```typescript
import {
  appendTurn,
  ownedConversation,
  startConversation,
} from '@/lib/assistant/conversation-store';

const mockStart = startConversation as unknown as jest.Mock;
const mockOwned = ownedConversation as unknown as jest.Mock;
const mockAppend = appendTurn as unknown as jest.Mock;
```

Reset them in the existing `beforeEach`:

```typescript
  mockStart.mockReset().mockResolvedValue('conv_new');
  mockOwned.mockReset().mockResolvedValue({ id: 'conv_1' });
  mockAppend.mockReset().mockResolvedValue(undefined);
```

Then the tests:

```typescript
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
      'event: control\ndata: {"turn_id":"t1","session_id":"s"}\n\n' +
        'event: assistant\ndata: {"v":1,"seq":0,"type":"tool_started","data":{"call_id":"c1","tool":"get_orders","arguments":{}}}\n\n' +
        'event: assistant\ndata: {"v":1,"seq":1,"type":"tool_completed","data":{"call_id":"c1","tool":"get_orders","ok":true,"result":[]}}\n\n' +
        'event: assistant\ndata: {"v":1,"seq":2,"type":"message","data":{"text":"You ordered ORD-1."}}\n\n'
    );

    const forwarded = await (await POST(ask())).text();

    const stored = mockAppend.mock.calls[0]![0].events;
    expect(stored.map((e: any) => e.type)).toEqual([
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
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest --selectProjects integration tests/integration/api-assistant-bridge.test.ts`

Expected: FAIL — no `x-conversation-id` header, `startConversation` never called, `appendTurn` never called.

- [ ] **Step 3: Change the bridge**

In `app/api/assistant/route.ts`, add the import:

```typescript
import {
  appendTurn,
  ownedConversation,
  startConversation,
} from '@/lib/assistant/conversation-store';
```

Read the conversation id alongside the utterance:

```typescript
  const utterance = String(
    (body as { utterance?: unknown })?.utterance ?? ''
  ).trim();
  if (!utterance) return fail(400, 'An utterance is required');

  const asked = (body as { conversationId?: unknown })?.conversationId;
  const continuing = typeof asked === 'string' && asked.length > 0 ? asked : null;
```

After the configuration check and **before** minting the bearer or calling the agent, resolve the conversation:

```typescript
  // Resolved before anything is spent. A conversation that is not this
  // customer's must not cost a model call to refuse.
  let conversationId: string;
  if (continuing) {
    const owned = await ownedConversation(session.sub as string, continuing);
    // The same answer as one that does not exist: a distinguishable
    // refusal confirms a stranger's id is real.
    if (!owned) return fail(404, 'No such conversation');
    conversationId = owned.id;
  } else {
    // LAZILY, on the first message. A row created when the panel opens
    // would leave an empty chat in the history list every time somebody
    // clicked and changed their mind.
    conversationId = await startConversation(session.sub as string);
  }
```

Accumulate the forwarded events beside the existing stream state:

```typescript
  // What the panel is being shown, kept so the same events can be written
  // down. Stored and forwarded must be one story about the turn, not two.
  const forwarded: unknown[] = [];
```

In the `assistant` branch, record before enqueueing:

```typescript
        if (item.event === 'assistant') {
          rememberIfApproval(item.data);
          try {
            forwarded.push(JSON.parse(item.data));
          } catch {
            // Unparseable frames are dropped from the record for the same
            // reason the browser drops them: neither can act on one.
          }
          controller.enqueue(encoder.encode(frame('assistant', item.data)));
        }
```

Replace the `done` branch so the turn is written before the stream closes:

```typescript
      if (done) {
        // The conversation is over; nothing may approve it now.
        endTurns();
        // Awaited here, where the response is still open, rather than
        // fired off afterwards -- work started after a handler returns is
        // work the runtime is free to discard.
        try {
          await appendTurn({ conversationId, utterance, events: forwarded });
        } catch (error) {
          // A turn that cannot be written is still a turn that happened.
          // The customer has read it; failing the stream now would take it
          // off their screen to report a problem they cannot act on.
          console.error('Storing an assistant turn failed:', error);
        }
        controller.close();
        return;
      }
```

And add the header to the response:

```typescript
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      // How the browser learns which conversation it is in. Not a secret --
      // it names the customer's own chat, and every route re-checks
      // ownership -- but not guessable into somebody else's either.
      'x-conversation-id': conversationId,
      'x-accel-buffering': 'no',
    },
  });
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest --selectProjects integration` then `npx tsc --noEmit`

Expected: all pass, typecheck clean.

- [ ] **Step 5: Mutation-check**

Apply each, confirm FAIL, revert:

1. Delete the `if (!owned) return fail(404, ...)` line → `refuses a conversation belonging to somebody else` fails.
2. Move `startConversation` so it runs even when `continuing` is set → `continues an existing conversation instead of starting another` fails.
3. Push `item.data` into `forwarded` for control frames too (move the push above the `if (item.event === 'assistant')`) → `never stores a control frame` fails.
4. Store `body.utterance` unmodified instead of the trimmed `utterance` → `stores the utterance the customer actually typed` fails.

- [ ] **Step 6: Commit**

```bash
git add app/api/assistant/route.ts tests/integration/api-assistant-bridge.test.ts
git commit -m "feat: the bridge writes down every turn

It already watched every event go past on the way to the browser, so it
accumulates them and writes one row when the stream ends -- awaited while
the response is still open, because work started after a handler returns
is work the runtime may discard.

Stored and forwarded are asserted to be the same events. A record that
disagrees with what was on screen is a second story about what happened.

The conversation is resolved BEFORE the bearer is minted or the agent is
called: someone else's conversation id must not cost a model call to
refuse. And it is created lazily on the first message, so clicking the
panel open and changing your mind leaves nothing behind.

A turn that cannot be written is logged, not raised. The customer has
already read it; failing the stream would take it off their screen to
report a problem they cannot act on.

Mutation-tested: 4 mutations, all caught.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: the resume route

**Files:**
- Create: `app/api/assistant/conversations/latest/route.ts`
- Test: `tests/integration/api-assistant-conversations.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/api-assistant-conversations.test.ts`:

```typescript
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

const req = () => new NextRequest('https://x.test/api/assistant/conversations/latest');

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = 'test-secret-for-the-resume-route';
  mockGetToken.mockReset();
  mockLoad.mockReset();
});

describe('GET the conversation to resume', () => {
  it('returns the customer’s latest conversation and its turns', async () => {
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

  it('asks only for the signed-in customer’s conversation', async () => {
    // The route never takes a user id from the caller. There is nothing
    // to tamper with.
    mockGetToken.mockResolvedValue({ ...SIGNED_IN, sub: 'user_b' });
    mockLoad.mockResolvedValue(null);

    await GET(req());

    expect(mockLoad).toHaveBeenCalledWith('user_b');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest --selectProjects integration tests/integration/api-assistant-conversations.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Write the route**

Create `app/api/assistant/conversations/latest/route.ts`:

```typescript
// app/api/assistant/conversations/latest/route.ts
//
// GET /api/assistant/conversations/latest -- the conversation to resume.
//
// The panel asks for this once, on mount. It takes no parameters at all:
// the only conversation it can return is the signed-in customer's most
// recent one, so there is nothing here for a caller to tamper with.
//
// Cookie only, like the bridge and the approve route.

import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import { fail, ok } from '../../../v1/_lib/respond';
import { loadLatestConversation } from '@/lib/assistant/conversation-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const secret = process.env.NEXTAUTH_SECRET;
  const session = secret ? await getToken({ req, secret }) : null;
  if (!session?.sub) return fail(401, 'Authentication required');

  try {
    // null is a normal answer, not an error: everybody has a first visit,
    // and a 404 would put the panel into its failure branch on one.
    const conversation = await loadLatestConversation(session.sub as string);
    return ok({ conversation });
  } catch (error) {
    console.error('GET /api/assistant/conversations/latest failed:', error);
    return fail(500, 'Failed to load your conversation');
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest --selectProjects integration` then `npx tsc --noEmit`

Expected: all pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add app/api/assistant/conversations tests/integration/api-assistant-conversations.test.ts
git commit -m "feat: the conversation to resume

Takes no parameters: the only conversation it returns is the signed-in
customer's most recent, so there is nothing for a caller to tamper with.

null is a normal answer rather than a 404 -- everybody has a first visit,
and a 404 would drop the panel into its failure branch on one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: the panel resumes

**Files:**
- Modify: `components/assistant/assistant-provider.tsx`
- Test: `tests/unit/assistant-provider.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/assistant-provider.test.tsx`:

```typescript
describe('resuming a stored conversation', () => {
  function ResumeProbe() {
    const { transcript, conversationId, send } = useAssistant();

    return (
      <div>
        <button onClick={() => send('a follow-up')}>ask</button>
        <span data-testid="conversation">{conversationId ?? 'none'}</span>
        <span data-testid="shape">
          {transcript
            .map(
              (entry) =>
                `${entry.utterance}=>${entry.conversation.timeline
                  .map((item) => (item.kind === 'text' ? item.text : `[${item.kind}]`))
                  .join(',')}`
            )
            .join(' | ')}
        </span>
      </div>
    );
  }

  const STORED = {
    data: {
      conversation: {
        id: 'conv_1',
        title: null,
        turns: [
          {
            utterance: 'what did I order?',
            events: [{ v: 1, seq: 0, type: 'message', data: { text: 'You ordered ORD-1.' } }],
          },
        ],
      },
    },
  };

  function resumeWith(body: unknown) {
    return jest.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/conversations/latest')) {
        return { ok: true, status: 200, json: async () => body } as unknown as Response;
      }
      return streamOf(
        'event: assistant\ndata: {"v":1,"seq":0,"type":"message","data":{"text":"answer two"}}\n\n'
      );
    });
  }

  function renderResume() {
    return render(
      <AssistantProvider>
        <ResumeProbe />
      </AssistantProvider>
    );
  }

  it('shows the conversation the customer was last having', async () => {
    global.fetch = resumeWith(STORED);

    renderResume();

    await waitFor(() =>
      expect(screen.getByTestId('shape')).toHaveTextContent(
        'what did I order?=>You ordered ORD-1.'
      )
    );
    expect(screen.getByTestId('conversation')).toHaveTextContent('conv_1');
  });

  it('continues that conversation rather than starting another', async () => {
    // Without sending the id back, every reload would strand the old chat
    // and begin a new one -- the history list would fill with orphans.
    global.fetch = resumeWith(STORED);

    renderResume();
    await waitFor(() =>
      expect(screen.getByTestId('conversation')).toHaveTextContent('conv_1')
    );

    await act(async () => {
      screen.getByText('ask').click();
    });

    const send = (global.fetch as jest.Mock).mock.calls.find(
      ([url]) => url === '/api/assistant'
    )!;
    expect(JSON.parse(send[1].body)).toEqual({
      utterance: 'a follow-up',
      conversationId: 'conv_1',
    });
  });

  it('starts empty for a customer who has never chatted', async () => {
    global.fetch = resumeWith({ data: { conversation: null } });

    renderResume();

    await waitFor(() =>
      expect(screen.getByTestId('conversation')).toHaveTextContent('none')
    );
    expect(screen.getByTestId('shape')).toHaveTextContent('');
  });

  it('stays usable when the stored conversation cannot be loaded', async () => {
    // A resume that fails must not take the assistant down with it. A
    // customer who cannot see yesterday's chat can still have a new one.
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/conversations/latest')) {
        return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
      }
      return streamOf(
        'event: assistant\ndata: {"v":1,"seq":0,"type":"message","data":{"text":"answer"}}\n\n'
      );
    });

    renderResume();

    await act(async () => {
      screen.getByText('ask').click();
    });

    await waitFor(() =>
      expect(screen.getByTestId('shape')).toHaveTextContent('a follow-up=>answer')
    );
  });

  it('drops a stored event it cannot trust', async () => {
    // Stored events go through the SAME door as live ones. They were
    // written by the agent, and a row that has been tampered with or
    // written by an older schema must not take down the panel.
    global.fetch = resumeWith({
      data: {
        conversation: {
          id: 'conv_1',
          title: null,
          turns: [
            {
              utterance: 'hello',
              events: [
                { v: 99, seq: 0, type: 'message', data: { text: 'from the future' } },
                { v: 1, seq: 1, type: 'message', data: { text: 'readable' } },
              ],
            },
          ],
        },
      },
    });

    renderResume();

    await waitFor(() =>
      expect(screen.getByTestId('shape')).toHaveTextContent('hello=>readable')
    );
    expect(screen.getByTestId('shape')).not.toHaveTextContent('from the future');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest --selectProjects unit tests/unit/assistant-provider.test.tsx`

Expected: FAIL — `conversationId` is not on the context.

- [ ] **Step 3: Change the provider**

Add `useEffect` to the React import. Add to `AssistantContextValue`:

```typescript
  /** The conversation being had, or null before the first message. */
  conversationId: string | null;
```

Add the state and the hydration effect, immediately after the existing `useState` calls:

```typescript
  const [conversationId, setConversationId] = useState<string | null>(null);

  // RESUME ON MOUNT. Mounted once in the root layout, so this runs once
  // per page load rather than once per navigation.
  //
  // A failure here is deliberately quiet. Not being able to show
  // yesterday's chat is a disappointment; refusing to let the customer
  // start a new one over it would be a fault.
  useEffect(() => {
    let live = true;

    fetch('/api/assistant/conversations/latest', {
      headers: { accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then((body) => {
        const stored = body?.data?.conversation;
        if (!live || !stored) return;

        setConversationId(stored.id);
        setTurns(
          (stored.turns ?? []).map((turn: { utterance: string; events: unknown[] }) => ({
            utterance: turn.utterance,
            // THE SAME DOOR AS THE LIVE STREAM. These rows were written by
            // the agent; a tampered or older-schema event must be dropped,
            // not rendered, and certainly not allowed to throw.
            events: (turn.events ?? [])
              .map(parseEvent)
              .filter((event): event is AssistantEvent => event !== null),
          }))
        );
      })
      .catch(() => {
        // Nothing to resume, or it could not be read. Either way the
        // panel opens empty and works.
      });

    return () => {
      live = false;
    };
  }, []);
```

In `send()`, include the conversation id and adopt whatever comes back:

```typescript
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          conversationId ? { utterance: asked, conversationId } : { utterance: asked }
        ),
      });

      // The bridge creates the conversation on the first message and names
      // it here. Without adopting it, every message would start a new one.
      const named = response.headers.get('x-conversation-id');
      if (named) setConversationId(named);
```

`send` is a `useCallback` with `[]` — add `conversationId` to its dependency array, or the first message after a resume would be sent with a stale `null`.

Add `conversationId` to the context value and its dependency array.

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest` then `npx tsc --noEmit` then `npx next build`

Expected: all suites pass, typecheck clean, `✓ Compiled successfully`.

- [ ] **Step 5: Mutation-check**

Apply each, confirm FAIL, revert:

1. Drop `conversationId` from the `send` body → `continues that conversation rather than starting another` fails.
2. Remove the `parseEvent` filter and cast stored events straight through → `drops a stored event it cannot trust` fails.
3. Remove `conversationId` from the `send` useCallback dependencies → `continues that conversation` fails (it sends `null` after a resume).
4. Change the `.catch()` to `setStatus('error')` → `stays usable when the stored conversation cannot be loaded` fails.

- [ ] **Step 6: Commit**

```bash
git add components/assistant/assistant-provider.tsx tests/unit/assistant-provider.test.tsx
git commit -m "feat: the panel resumes the conversation you were having

Asks for the latest conversation on mount and hydrates turns from it --
the same {utterance, events} shape Phase 1 already grouped them into, so
replay() stays the only reducer and nothing about rendering changes.

Stored events go through parseEvent, the same door as live ones. They
were written by the agent, and a tampered row or one from an older schema
must be dropped rather than rendered, and must certainly not throw.

A failed resume is quiet on purpose. Not showing yesterday's chat is a
disappointment; refusing to let someone start a new one over it would be
a fault.

Mutation-tested: 4 mutations, all caught.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: apply the migration, deploy, verify

**This task needs a decision from the human partner. Do not guess at it.**

- [ ] **Step 1: Confirm how the migration will be applied**

Present options A, B and C from the note at the top of this plan and get an explicit answer. Recommended: **A**, a Railway pre-deploy command `npm run db:migrate:deploy` on the `web` service.

Do not run `prisma migrate deploy` against production from this session, and do not ask for the production database URL.

- [ ] **Step 2: Push, and confirm the migration ran**

```bash
git push
```

If option A: watch the deploy logs for `prisma migrate deploy` and the line naming `20260903190000_add_assistant_conversations`. A deploy that reports SUCCESS without that line has not migrated, and every chat request will fail on a missing table.

- [ ] **Step 3: Confirm the deploy is the build you think it is**

Check the `web` service's latest deployment reads SUCCESS for the commit you just pushed. A 200 proves *a* container is up, not that it is *this* one — a mistake already made twice on this project.

- [ ] **Step 4: Verify live**

Signed in, after a hard refresh:

1. Ask a question. Wait for the answer.
2. **Refresh the page.** Open the assistant. The conversation must still be there.
3. Ask a follow-up. It must join the same conversation, not start a new one.
4. **Sign out and back in.** The conversation must still be there.
5. Close the browser entirely, reopen, sign in. Still there.

Step 2 is the one that has never worked before. Step 3 is the one most likely to be subtly wrong, because it depends on the header being adopted.

- [ ] **Step 5: Record the outcome**

Append a dated entry to `docs/PLAN_M4_STOREFRONT.txt` naming what was verified and how the migration was applied — the next migration will want to know.

- [ ] **Step 6: Commit the record**

```bash
git add docs/PLAN_M4_STOREFRONT.txt
git commit -m "docs: record chat storage and resume, verified live

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage.** Covers Phase 2 of `2026-09-03-chat-persistence-roadmap.md`: tables, per-turn persistence, `x-conversation-id`, hydration. The roadmap's Phase 2 MUST PROVEs are Task 3 step 1 (`stores exactly the events it forwarded`), Task 2 step 1 and Task 3 step 1 (`user B cannot read user A's`), and the migration's `onDelete: Cascade` (deleting a user removes their conversations — enforced by the foreign key rather than by a test, because it is a database constraint and a test would only be checking Postgres).
- **Type consistency.** `StoredTurn { utterance, events }` matches the provider's `Turn { utterance, events }` and `ConversationTurn`'s columns. `loadLatestConversation` returns `{ id, title, turns }`; the route wraps it as `{ conversation }`; the provider reads `body.data.conversation`. `startConversation`, `ownedConversation`, `appendTurn`, `loadLatestConversation` are named identically in Tasks 2, 3 and 4.
- **Known gap, accepted.** A browser that disconnects mid-turn hits the stream's `cancel()`, not `done`, so that turn is not stored. Persisting there cannot be awaited and would be best-effort at the exact moment the runtime is tearing the handler down. The customer closed the tab; the agent's turn was cancelled with it. Phase 3 can revisit if it proves annoying in practice.
- **Deliberately not done here.** No history list, no `+` button, no titles, no memory. `agentContext` is written as `null` on every turn — Phase 5 fills it, and the column exists now only so this is the single migration.
