# Chat Phase 3: History UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the panel gets a `+` and a history button in its header. The history view lists past chats with a name and a relative time, opens any of them, and deletes one behind a second deliberate click.

**Architecture:** Phase 2 already stores every conversation and every turn, and the provider already hydrates one on mount. This phase adds three store functions, two routes, and a second view inside the existing panel. No schema change — `title` stays null until Phase 4, and the list falls back to the first thing the customer said.

**Tech Stack:** Next.js App Router, Prisma + Postgres (Supabase), Jest (`unit` / `integration` projects), lucide-react (already the project's icon set).

**Not in this phase:** model-generated titles (Phase 4), agent memory (Phase 5), summarisation (Phase 6). Renaming a chat by hand is not in the roadmap at all and is not being added.

---

## Decisions this plan is built on

Taken during brainstorming on 2026-09-03 and recorded in `2026-09-03-chat-persistence-roadmap.md`. Do not re-litigate them; if one turns out to be wrong, say so and stop.

| Decision | Consequence here |
|---|---|
| Empty chats are never stored | `+` clears local state and makes **no request**. The row appears when the first message is sent, exactly as in Phase 2. |
| Ownership answers 404, never 403 | Both new routes answer 404 for a stranger's id. |
| Retention is indefinite, delete is per-chat with an inline confirm | No bulk delete, no "clear all", no undo. |
| Titles are model-generated in Phase 4, falling back to the truncated first message | The list already renders that fallback, so Phase 4 changes one field and no UI. |

### Three things this phase must prove

From the roadmap, restated as the tests that carry them:

1. **An empty chat is never stored.** Pressing `+` issues no request at all (Task 4).
2. **Switching chats mid-stream is impossible.** Both header buttons are disabled while streaming, *and* the provider refuses regardless of what the UI allows (Task 4). Two guards, because the first is a rendering detail and the second is the actual invariant.
3. **Delete requires a second, deliberate click.** The first click arms; only the second sends (Task 5).

### One decision this plan makes that the roadmap did not cover

**Deleting the chat you are currently reading also clears the panel.** The roadmap says delete is per-chat and says nothing about the open chat. Leaving the transcript on screen after its rows are gone would show a conversation that no longer exists, and the customer's next message would be posted against a deleted `conversationId` — a 404 from the bridge, on a chat they are looking at. So `deleteConversation` clears `turns` and `conversationId` when the deleted id is the open one, and leaves them alone otherwise. There is a test for each branch.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `lib/assistant/conversation-store.ts` | every chat database access | add `listConversations`, `loadConversation`, `deleteConversation` |
| `tests/integration/assistant-conversation-store.test.ts` | store tests | add |
| `lib/assistant/relative-time.ts` | "5m ago" | create |
| `tests/unit/relative-time.test.ts` | its tests | create |
| `app/api/assistant/conversations/route.ts` | `GET` the list | create |
| `app/api/assistant/conversations/[id]/route.ts` | `GET` one, `DELETE` one | create |
| `tests/integration/api-assistant-conversations.test.ts` | route tests | add |
| `components/assistant/conversation-list.tsx` | the history view | create |
| `tests/unit/assistant-conversation-list.test.tsx` | its tests | create |
| `components/assistant/assistant-provider.tsx` | list state, new/open/delete | modify |
| `tests/unit/assistant-provider.test.tsx` | provider tests | add |
| `components/assistant/assistant-widget.tsx` | header icons, view switch | modify |
| `tests/unit/assistant-widget.test.tsx` | widget tests | add |

**Why `relative-time.ts` is its own module.** It is a pure function of two arguments and it is the only thing in this phase that can be tested exhaustively without a DOM or a database. Inlining it in the component would mean rendering a list to check that 90 minutes reads as "1h ago".

**Why the store keeps growing rather than splitting.** It is at four functions and goes to seven. Every one of them filters by `userId` inside the query, and that consistency is the entire reason the module exists. Splitting it by route would put ownership back in the callers, which is the M1 mistake.

---

## Task 1: relative time

**Files:**
- Create: `lib/assistant/relative-time.ts`
- Test: `tests/unit/relative-time.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/relative-time.test.ts`:

```typescript
// tests/unit/relative-time.test.ts
//
// `now` is a parameter, not Date.now(). A function that reads the clock
// itself can only be tested by mocking the clock, and then the test is
// about the mock.

import { relativeTime } from '@/lib/assistant/relative-time';

const NOW = new Date('2026-09-04T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('relativeTime', () => {
  it('calls anything under a minute "just now"', () => {
    expect(relativeTime(ago(0), NOW)).toBe('just now');
    expect(relativeTime(ago(59 * SECOND), NOW)).toBe('just now');
  });

  it('counts whole minutes up to an hour', () => {
    expect(relativeTime(ago(MINUTE), NOW)).toBe('1m ago');
    expect(relativeTime(ago(59 * MINUTE), NOW)).toBe('59m ago');
  });

  it('counts whole hours up to a day', () => {
    expect(relativeTime(ago(HOUR), NOW)).toBe('1h ago');
    expect(relativeTime(ago(23 * HOUR), NOW)).toBe('23h ago');
  });

  it('counts whole days up to a week', () => {
    expect(relativeTime(ago(DAY), NOW)).toBe('1d ago');
    expect(relativeTime(ago(6 * DAY), NOW)).toBe('6d ago');
  });

  it('gives a date once it is a week old', () => {
    // Past a week "37d ago" stops being useful and a date starts being
    // useful. Locale-independent so this does not fail on another machine.
    expect(relativeTime(new Date('2026-08-14T09:00:00.000Z'), NOW)).toBe(
      '14 Aug'
    );
  });

  it('includes the year once it is not this year', () => {
    expect(relativeTime(new Date('2025-12-30T09:00:00.000Z'), NOW)).toBe(
      '30 Dec 2025'
    );
  });

  it('never renders a future timestamp as a negative age', () => {
    // Clock skew between the server that wrote the row and the browser
    // reading it is normal. "-1m ago" is not.
    expect(relativeTime(new Date(NOW.getTime() + 5 * MINUTE), NOW)).toBe(
      'just now'
    );
  });

  it('answers an empty string for something that is not a date', () => {
    // The value arrives as JSON from a route. A malformed one must not
    // put "Invalid Date" into the list.
    expect(relativeTime(new Date('nonsense'), NOW)).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest --selectProjects unit --testPathPattern "relative-time"`

Expected: FAIL — `Cannot find module '@/lib/assistant/relative-time'`.

- [ ] **Step 3: Write it**

Create `lib/assistant/relative-time.ts`:

```typescript
// lib/assistant/relative-time.ts
//
// How old a chat is, in the fewest characters that still mean something.
//
// `now` is a parameter rather than Date.now() so this is a pure function
// of its inputs. A function that reads the clock can only be tested by
// mocking the clock, and then the test is about the mock.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function relativeTime(when: Date, now: Date = new Date()): string {
  // The value came from JSON. A malformed one must not reach the list as
  // "Invalid Date".
  if (Number.isNaN(when.getTime())) return '';

  // Clamped at zero: clock skew between the server that wrote the row and
  // the browser reading it is normal, and "-1m ago" is not.
  const age = Math.max(0, now.getTime() - when.getTime());

  if (age < MINUTE) return 'just now';
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m ago`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h ago`;
  if (age < WEEK) return `${Math.floor(age / DAY)}d ago`;

  // Past a week, "37d ago" stops being useful and a date starts being
  // useful. Built by hand rather than through toLocaleDateString so the
  // output does not depend on the machine's locale -- including the
  // machine CI runs on.
  const day = when.getUTCDate();
  const month = MONTHS[when.getUTCMonth()];
  const year = when.getUTCFullYear();

  return year === now.getUTCFullYear()
    ? `${day} ${month}`
    : `${day} ${month} ${year}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest --selectProjects unit --testPathPattern "relative-time"`

Expected: PASS, 8 tests.

- [ ] **Step 5: Mutation-check**

Apply each, confirm FAIL, revert:

1. `Math.max(0, ...)` → `now.getTime() - when.getTime()` → `never renders a future timestamp` fails.
2. `if (age < MINUTE) return 'just now'` deleted → `calls anything under a minute` fails.
3. `year === now.getUTCFullYear()` → `true` → `includes the year once it is not this year` fails.
4. The `Number.isNaN` guard deleted → `answers an empty string for something that is not a date` fails.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/assistant/relative-time.ts apps/web/tests/unit/relative-time.test.ts
git commit -m "feat: how old a chat is, in the fewest useful characters

now is a parameter rather than Date.now(), so this is a pure function of
its inputs and the tests are about the function instead of about a mocked
clock.

Clamped at zero because clock skew between the server that wrote the row
and the browser reading it is ordinary, and dates are built by hand rather
than through toLocaleDateString so CI does not disagree with a laptop.

Mutation-tested: 4 mutations, all caught.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: the store learns to list, load and delete

**Files:**
- Modify: `lib/assistant/conversation-store.ts`
- Test: `tests/integration/assistant-conversation-store.test.ts`

- [ ] **Step 1: Extend the Prisma mock**

In `tests/integration/assistant-conversation-store.test.ts`, the mock currently declares `create`, `findFirst` and `update` on `conversation`. Replace that object with:

```typescript
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
```

and add the two new resets to the existing `beforeEach`, beside the others:

```typescript
  mockPrisma.conversation.findMany.mockReset();
  mockPrisma.conversation.deleteMany.mockReset();
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/integration/assistant-conversation-store.test.ts`:

```typescript
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

    const turns = mockPrisma.conversation.findMany.mock.calls[0]![0].select
      .turns;
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
```

Add the three names to the existing import at the top of the file:

```typescript
import {
  appendTurn,
  deleteConversation,
  listConversations,
  loadConversation,
  loadLatestConversation,
  ownedConversation,
  startConversation,
} from '@/lib/assistant/conversation-store';
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx jest --selectProjects integration --testPathPattern "assistant-conversation-store"`

Expected: FAIL — `listConversations is not a function`.

- [ ] **Step 4: Write the store functions**

Append to `lib/assistant/conversation-store.ts`:

```typescript
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
```

**Note the duplication with `loadLatestConversation`.** The two differ only in their `where` and `orderBy`. Leave it. Collapsing them into one function taking a where-clause would put query construction in the callers, which is the thing this module exists to prevent, and the shared part is nine lines of a `select`.

- [ ] **Step 5: Run to verify it passes**

Run: `npx jest --selectProjects integration --testPathPattern "assistant-conversation-store"` then `npx tsc --noEmit`

Expected: PASS, 19 tests. Typecheck clean.

- [ ] **Step 6: Mutation-check**

Apply each, confirm FAIL, revert:

1. `where: { id, userId }` → `where: { id }` in `deleteConversation` → `deletes only a chat this customer owns` fails.
2. `count > 0` → `true` → `reports nothing deleted for somebody elses chat` fails.
3. `take: 1` → `take: 50` in `listConversations` → `asks for only the FIRST turn of each chat` fails.
4. `row.title ?? fallbackName(...)` → `fallbackName(...)` → `prefers a real title over the fallback` fails.
5. `orderBy: { lastTurnAt: 'desc' }` → `'asc'` → `returns the customers chats, newest activity first` fails.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/assistant/conversation-store.ts apps/web/tests/integration/assistant-conversation-store.test.ts
git commit -m "feat: list, load and delete a chat

Three more queries in the one module that owns them, each filtering by
userId inside the query like the four before them.

The list fetches ONE turn per chat, not all of them -- a sidebar that
loads every turn of every conversation grows with the customer's history.
Untitled chats fall back to what the customer first said, truncated, which
is the same fallback Phase 4 keeps for a title call that failed.

Delete uses deleteMany rather than delete: delete throws when nothing
matches, and a thrown error is observably different from 'not yours',
which is the distinction an enumeration attack is looking for.

Mutation-tested: 5 mutations, all caught.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: the two routes

**Files:**
- Create: `app/api/assistant/conversations/route.ts`
- Create: `app/api/assistant/conversations/[id]/route.ts`
- Test: `tests/integration/api-assistant-conversations.test.ts`

- [ ] **Step 1: Extend the store mock in the test file**

`tests/integration/api-assistant-conversations.test.ts` currently mocks only `loadLatestConversation`. Replace that mock with:

```typescript
jest.mock('@/lib/assistant/conversation-store', () => ({
  loadLatestConversation: jest.fn(),
  listConversations: jest.fn(),
  loadConversation: jest.fn(),
  deleteConversation: jest.fn(),
}));
```

and extend the imports and handles:

```typescript
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

const mockList = listConversations as unknown as jest.Mock;
const mockLoadOne = loadConversation as unknown as jest.Mock;
const mockDelete = deleteConversation as unknown as jest.Mock;
```

The existing tests reference `GET`. Rename those call sites to `GET_LATEST` — there are four, all inside `describe('GET the conversation to resume')`.

Add to the existing `beforeEach`:

```typescript
  mockList.mockReset();
  mockLoadOne.mockReset();
  mockDelete.mockReset();
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/integration/api-assistant-conversations.test.ts`:

```typescript
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
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx jest --selectProjects integration --testPathPattern "api-assistant-conversations"`

Expected: FAIL — module not found for both new routes.

- [ ] **Step 4: Write the list route**

Create `app/api/assistant/conversations/route.ts`:

```typescript
// app/api/assistant/conversations/route.ts
//
// GET /api/assistant/conversations -- every chat this customer has had.
//
// Takes no parameters, like the resume route. The only chats it can
// return are the signed-in customer's, so there is nothing here for a
// caller to tamper with.
//
// Cookie only, like every other route in this folder.

import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import { fail, ok } from '../../v1/_lib/respond';
import { listConversations } from '@/lib/assistant/conversation-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const secret = process.env.NEXTAUTH_SECRET;
  const session = secret ? await getToken({ req, secret }) : null;
  if (!session?.sub) return fail(401, 'Authentication required');

  try {
    // An empty list is a normal answer. Everybody has a first visit.
    const conversations = await listConversations(session.sub as string);
    return ok({ conversations });
  } catch (error) {
    console.error('GET /api/assistant/conversations failed:', error);
    return fail(500, 'Failed to load your chats');
  }
}
```

- [ ] **Step 5: Write the single-chat route**

Create `app/api/assistant/conversations/[id]/route.ts`:

```typescript
// app/api/assistant/conversations/[id]/route.ts
//
//   GET     one chat in full, to open it
//   DELETE  remove it
//
// BOTH ANSWER 404 FOR A CHAT THAT IS NOT THIS CUSTOMER'S, and the same
// 404 for one that does not exist. A distinguishable refusal -- a 403, or
// a different message -- confirms that a stranger's id is real, which is
// all an enumeration attack needs. The store enforces this by filtering
// on userId inside the query, so there is no path here that can forget.
//
// Cookie only, like the bridge and the approve route.

import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import { fail, ok } from '../../../v1/_lib/respond';
import {
  deleteConversation,
  loadConversation,
} from '@/lib/assistant/conversation-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const secret = process.env.NEXTAUTH_SECRET;
  const session = secret ? await getToken({ req, secret }) : null;
  if (!session?.sub) return fail(401, 'Authentication required');

  const { id } = await params;

  try {
    const conversation = await loadConversation(session.sub as string, id);
    if (!conversation) return fail(404, 'No such conversation');
    return ok({ conversation });
  } catch (error) {
    console.error('GET /api/assistant/conversations/[id] failed:', error);
    return fail(500, 'Failed to load that chat');
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const secret = process.env.NEXTAUTH_SECRET;
  const session = secret ? await getToken({ req, secret }) : null;
  if (!session?.sub) return fail(401, 'Authentication required');

  const { id } = await params;

  try {
    const deleted = await deleteConversation(session.sub as string, id);
    // Same 404 as GET. "Nothing of yours to delete" and "does not exist"
    // are the same answer on purpose.
    if (!deleted) return fail(404, 'No such conversation');
    return ok({ deleted: true });
  } catch (error) {
    console.error('DELETE /api/assistant/conversations/[id] failed:', error);
    return fail(500, 'Failed to delete that chat');
  }
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx jest --selectProjects integration` then `npx tsc --noEmit`

Expected: all pass, typecheck clean.

- [ ] **Step 7: Mutation-check**

Apply each, confirm FAIL, revert:

1. `if (!conversation) return fail(404, ...)` deleted from `GET` → `answers 404 for somebody elses chat` fails.
2. `if (!deleted) return fail(404, ...)` deleted from `DELETE` → `answers 404 when there was nothing` fails.
3. `session.sub` → `'user_a'` in the list route → `takes no user id from the caller` fails.
4. Move the auth check below the `deleteConversation` call → `refuses an unauthenticated caller without deleting anything` fails.

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/api/assistant/conversations apps/web/tests/integration/api-assistant-conversations.test.ts
git commit -m "feat: list, open and delete a chat over HTTP

The list route takes no parameters at all, like the resume route: the only
chats it can return are the signed-in customer's.

Both handlers on [id] answer the SAME 404 for a chat that is not yours and
one that does not exist. A distinguishable refusal confirms a stranger's
id is real, which is the whole of an enumeration attack.

Mutation-tested: 4 mutations, all caught.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: the provider learns new, open, delete and the list

**Files:**
- Modify: `components/assistant/assistant-provider.tsx`
- Test: `tests/unit/assistant-provider.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/assistant-provider.test.tsx`:

```typescript
describe('managing several chats', () => {
  const LIST = {
    data: {
      conversations: [
        { id: 'conv_2', name: 'Cancelling an order', lastTurnAt: '2026-09-04T11:00:00.000Z' },
        { id: 'conv_1', name: 'what did I order?', lastTurnAt: '2026-09-03T09:00:00.000Z' },
      ],
    },
  };

  const OPENED = {
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

  const RESUMED = {
    data: {
      conversation: {
        id: 'conv_2',
        title: null,
        turns: [
          {
            utterance: 'cancel ORD-9 please',
            events: [{ v: 1, seq: 0, type: 'message', data: { text: 'Cancelled.' } }],
          },
        ],
      },
    },
  };

  function json(body: unknown, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }

  /** Routes each url to its own answer, so nothing depends on call order. */
  function api(overrides: Record<string, Response> = {}) {
    return jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const path = String(url);
      if (overrides[`${init?.method ?? 'GET'} ${path}`]) {
        return overrides[`${init?.method ?? 'GET'} ${path}`]!;
      }
      if (path.includes('/conversations/latest')) return json(RESUMED);
      if (path.endsWith('/api/assistant/conversations')) return json(LIST);
      if (path.includes('/api/assistant/conversations/')) {
        if (init?.method === 'DELETE') return json({ data: { deleted: true } });
        return json(OPENED);
      }
      return streamOf(
        'event: assistant\ndata: {"v":1,"seq":0,"type":"message","data":{"text":"a reply"}}\n\n'
      );
    });
  }

  function ChatsProbe() {
    const {
      conversationId,
      conversations,
      transcript,
      status,
      send,
      newChat,
      openConversation,
      deleteConversation: remove,
    } = useAssistant();

    return (
      <div>
        <button onClick={() => send('a question')}>ask</button>
        <button onClick={() => newChat()}>new</button>
        <button onClick={() => openConversation('conv_1')}>open-1</button>
        <button onClick={() => remove('conv_1')}>delete-1</button>
        <button onClick={() => remove('conv_2')}>delete-2</button>
        <span data-testid="status">{status}</span>
        <span data-testid="conversation">{conversationId ?? 'none'}</span>
        <span data-testid="names">
          {conversations.map((c) => c.name).join(' | ')}
        </span>
        <span data-testid="utterances">
          {transcript.map((entry) => entry.utterance).join(' | ')}
        </span>
      </div>
    );
  }

  function renderChats() {
    return render(
      <AssistantProvider>
        <ChatsProbe />
      </AssistantProvider>
    );
  }

  it('loads the list of chats on mount', async () => {
    global.fetch = api();

    renderChats();

    await waitFor(() =>
      expect(screen.getByTestId('names')).toHaveTextContent(
        'Cancelling an order | what did I order?'
      )
    );
  });

  it('starts a new chat WITHOUT storing anything', async () => {
    // THE MUST PROVE. A row created when you press + would leave a phantom
    // empty chat in the list every time somebody changed their mind.
    global.fetch = api();

    renderChats();
    await waitFor(() =>
      expect(screen.getByTestId('conversation')).toHaveTextContent('conv_2')
    );

    const before = (global.fetch as jest.Mock).mock.calls.length;

    await act(async () => {
      screen.getByText('new').click();
    });

    expect(screen.getByTestId('conversation')).toHaveTextContent('none');
    expect(screen.getByTestId('utterances')).toHaveTextContent('');
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(before);
  });

  it('opens a chat from the list and shows its turns', async () => {
    global.fetch = api();

    renderChats();
    await waitFor(() =>
      expect(screen.getByTestId('conversation')).toHaveTextContent('conv_2')
    );

    await act(async () => {
      screen.getByText('open-1').click();
    });

    await waitFor(() =>
      expect(screen.getByTestId('conversation')).toHaveTextContent('conv_1')
    );
    expect(screen.getByTestId('utterances')).toHaveTextContent(
      'what did I order?'
    );
  });

  it('refuses to switch chats while a turn is streaming', async () => {
    // THE MUST PROVE. The stream in flight belongs to the chat that is
    // open; switching under it would file the answer against the wrong
    // conversation. The header buttons are disabled too, but that is a
    // rendering detail and this is the invariant.
    const slow = {
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: { getReader: () => ({ read: () => new Promise(() => {}) }) },
    } as unknown as Response;

    global.fetch = api({ 'POST /api/assistant': slow });

    renderChats();
    await waitFor(() =>
      expect(screen.getByTestId('conversation')).toHaveTextContent('conv_2')
    );

    await act(async () => {
      screen.getByText('ask').click();
    });
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('streaming')
    );

    await act(async () => {
      screen.getByText('open-1').click();
      screen.getByText('new').click();
    });

    // Still the chat the stream belongs to.
    expect(screen.getByTestId('conversation')).toHaveTextContent('conv_2');
  });

  it('deletes a chat and drops it from the list', async () => {
    global.fetch = api();

    renderChats();
    await waitFor(() =>
      expect(screen.getByTestId('names')).toHaveTextContent('what did I order?')
    );

    await act(async () => {
      screen.getByText('delete-1').click();
    });

    await waitFor(() =>
      expect(screen.getByTestId('names')).not.toHaveTextContent(
        'what did I order?'
      )
    );
    expect(screen.getByTestId('names')).toHaveTextContent('Cancelling an order');
  });

  it('clears the panel when the chat being deleted is the open one', async () => {
    // Otherwise the transcript stays on screen after its rows are gone,
    // and the next message is posted against a deleted conversation --
    // a 404 on a chat the customer is looking at.
    global.fetch = api();

    renderChats();
    await waitFor(() =>
      expect(screen.getByTestId('conversation')).toHaveTextContent('conv_2')
    );

    await act(async () => {
      screen.getByText('delete-2').click();
    });

    await waitFor(() =>
      expect(screen.getByTestId('conversation')).toHaveTextContent('none')
    );
    expect(screen.getByTestId('utterances')).toHaveTextContent('');
  });

  it('leaves the open chat alone when a DIFFERENT one is deleted', async () => {
    global.fetch = api();

    renderChats();
    await waitFor(() =>
      expect(screen.getByTestId('conversation')).toHaveTextContent('conv_2')
    );

    await act(async () => {
      screen.getByText('delete-1').click();
    });

    await waitFor(() =>
      expect(screen.getByTestId('names')).not.toHaveTextContent(
        'what did I order?'
      )
    );
    expect(screen.getByTestId('conversation')).toHaveTextContent('conv_2');
    expect(screen.getByTestId('utterances')).toHaveTextContent(
      'cancel ORD-9 please'
    );
  });

  it('refreshes the list after a message, so a new chat appears in it', async () => {
    global.fetch = api();

    renderChats();
    await waitFor(() =>
      expect(screen.getByTestId('conversation')).toHaveTextContent('conv_2')
    );

    const listCallsBefore = (global.fetch as jest.Mock).mock.calls.filter(
      ([url]) => String(url).endsWith('/api/assistant/conversations')
    ).length;

    await act(async () => {
      screen.getByText('ask').click();
    });
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('idle')
    );

    const listCallsAfter = (global.fetch as jest.Mock).mock.calls.filter(
      ([url]) => String(url).endsWith('/api/assistant/conversations')
    ).length;

    expect(listCallsAfter).toBeGreaterThan(listCallsBefore);
  });

  it('stays usable when the list cannot be loaded', async () => {
    global.fetch = api({ 'GET /api/assistant/conversations': json({}, 500) });

    renderChats();

    await act(async () => {
      screen.getByText('ask').click();
    });

    await waitFor(() =>
      expect(screen.getByTestId('utterances')).toHaveTextContent('a question')
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest --selectProjects unit --testPathPattern "assistant-provider"`

Expected: FAIL — `conversations`, `newChat`, `openConversation` and `deleteConversation` are not on the context.

- [ ] **Step 3: Change the provider**

Add the listed-conversation type near the top, beside `Turn`:

```typescript
/** One row of the history list. Shaped by the list route, not by Prisma. */
export interface ListedChat {
  id: string;
  name: string;
  lastTurnAt: string;
}
```

Add to `AssistantContextValue`:

```typescript
  /** Every chat this customer has had, most recently active first. */
  conversations: ListedChat[];
  /** Clear the panel for a fresh chat. Stores nothing. */
  newChat: () => void;
  /** Replace the panel with a stored chat. */
  openConversation: (id: string) => Promise<void>;
  /** Remove a chat. Clears the panel if it was the open one. */
  deleteConversation: (id: string) => Promise<void>;
```

Add the state, immediately after the existing `useState` calls:

```typescript
  const [conversations, setConversations] = useState<ListedChat[]>([]);
```

Add a reusable loader above the mount effect, so the list is fetched the same way everywhere:

```typescript
  // Quiet on failure, like the resume. A customer who cannot see the list
  // of old chats can still have a new one, and an error banner over a
  // sidebar is worse than an empty sidebar.
  const refreshChats = useCallback(async () => {
    try {
      const response = await fetch('/api/assistant/conversations', {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) return;
      const body = await response.json();
      setConversations(body?.data?.conversations ?? []);
    } catch {
      // Nothing to show. The panel still works.
    }
  }, []);
```

Call it from the existing mount effect, beside the resume fetch — add this line just inside the effect, before the resume `fetch`:

```typescript
    void refreshChats();
```

and add `refreshChats` to that effect's dependency array, which becomes `[refreshChats]`.

In `send()`, refresh the list once the turn is over so a brand-new chat appears in it. Add immediately before the existing `setStatus(received === 0 ? 'error' : 'idle');`:

```typescript
      // The chat may have just been created by this very message, and its
      // name comes from this utterance. Refreshed after the stream rather
      // than before, because the row does not exist until the turn lands.
      void refreshChats();
```

and add `refreshChats` to `send`'s dependency array, which becomes `[conversationId, refreshChats]`.

Add the three actions after `approve`:

```typescript
  /**
   * Clear the panel for a fresh chat.
   *
   * STORES NOTHING. The row is created by the bridge on the first message,
   * exactly as in Phase 2 -- a row created here would leave a phantom
   * empty chat in the list every time somebody pressed + and changed
   * their mind.
   */
  const newChat = useCallback(() => {
    // The stream in flight belongs to the chat that is open. Switching
    // out from under it would file its answer against the wrong
    // conversation. The header disables the button too; this is the
    // guard that does not depend on rendering.
    if (inFlight.current) return;

    setTurns([]);
    setConversationId(null);
    setAnswered({});
    setStatus('idle');
  }, []);

  /** Replace the panel with a stored chat. */
  const openConversation = useCallback(async (id: string) => {
    if (inFlight.current) return;

    try {
      const response = await fetch(
        `/api/assistant/conversations/${encodeURIComponent(id)}`,
        { headers: { accept: 'application/json' } }
      );
      if (!response.ok) return;

      const body = await response.json();
      const stored = body?.data?.conversation;
      if (!stored) return;

      setConversationId(stored.id);
      setAnswered({});
      setStatus('idle');
      setTurns(
        (stored.turns ?? []).map(
          (turn: { utterance: string; events: unknown[] }) => ({
            utterance: turn.utterance,
            // The same door as the live stream and the resume: these rows
            // were written by the agent.
            events: (turn.events ?? [])
              .map(parseEvent)
              .filter((event): event is AssistantEvent => event !== null),
          })
        )
      );
    } catch {
      // The chat stays as it was. Failing to open an old conversation
      // must not close the one being had.
    }
  }, []);

  /**
   * Remove a chat.
   *
   * Clears the panel when the deleted chat is the open one. Leaving the
   * transcript up after its rows are gone would show a conversation that
   * no longer exists, and the next message would be posted against a
   * deleted id -- a 404 on a chat the customer is reading.
   */
  const deleteConversation = useCallback(
    async (id: string) => {
      try {
        const response = await fetch(
          `/api/assistant/conversations/${encodeURIComponent(id)}`,
          { method: 'DELETE' }
        );
        if (!response.ok) return;

        setConversations((previous) =>
          previous.filter((chat) => chat.id !== id)
        );
        setConversationId((previous) => {
          if (previous !== id) return previous;
          setTurns([]);
          setAnswered({});
          return null;
        });
      } catch {
        // Nothing removed, nothing changed on screen.
      }
    },
    []
  );
```

Add all four to the context value and its dependency array:

```typescript
  const value = useMemo(
    () => ({
      conversationId,
      conversations,
      events,
      conversation,
      transcript,
      turns,
      status,
      send,
      approve,
      answered,
      newChat,
      openConversation,
      deleteConversation,
    }),
    [
      conversationId,
      conversations,
      events,
      conversation,
      transcript,
      turns,
      status,
      send,
      approve,
      answered,
      newChat,
      openConversation,
      deleteConversation,
    ]
  );
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest --selectProjects unit` then `npx tsc --noEmit`

Expected: all pass, typecheck clean.

**If existing provider or widget tests now fail on an unexpected `fetch` call**, the cause is the new list request on mount, and the fix is the one already used twice in this file: route the mock by url rather than by call order. Do not "fix" it by removing the assertion.

- [ ] **Step 5: Mutation-check**

Apply each, confirm FAIL, revert:

1. Make `newChat` call `fetch('/api/assistant/conversations', { method: 'POST' })` before clearing → `starts a new chat WITHOUT storing anything` fails.
2. Delete `if (inFlight.current) return;` from both `newChat` and `openConversation` → `refuses to switch chats while a turn is streaming` fails.
3. In `deleteConversation`, always `return null` from the `setConversationId` updater → `leaves the open chat alone when a DIFFERENT one is deleted` fails.
4. In `deleteConversation`, never clear: `setConversationId((previous) => previous)` → `clears the panel when the chat being deleted is the open one` fails.
5. Remove the `void refreshChats()` from `send` → `refreshes the list after a message` fails.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/assistant/assistant-provider.tsx apps/web/tests/unit/assistant-provider.test.tsx
git commit -m "feat: the provider manages several chats

newChat clears local state and STORES NOTHING -- the row is created by the
bridge on the first message, as in Phase 2, so pressing + and changing
your mind leaves no phantom chat in the list.

newChat and openConversation both refuse while a turn is in flight. The
header disables the buttons as well, but that is a rendering detail; this
is the invariant, and it is guarded where it cannot be styled away.

Deleting the chat you are reading clears the panel. Leaving the transcript
up after its rows are gone would show a conversation that no longer exists
and post the next message against a deleted id.

Mutation-tested: 5 mutations, all caught.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: the history view

**Files:**
- Create: `components/assistant/conversation-list.tsx`
- Test: `tests/unit/assistant-conversation-list.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/assistant-conversation-list.test.tsx`:

```tsx
// tests/unit/assistant-conversation-list.test.tsx
//
// The history view. A presentational component: it is handed the chats
// and three callbacks, and owns exactly one piece of state -- which row
// is armed for deletion.

import { render, screen } from '@testing-library/react';

import { ConversationList } from '@/components/assistant/conversation-list';

const CHATS = [
  {
    id: 'conv_2',
    name: 'Cancelling an order',
    lastTurnAt: '2026-09-04T11:00:00.000Z',
  },
  {
    id: 'conv_1',
    name: 'what did I order?',
    lastTurnAt: '2026-09-03T09:00:00.000Z',
  },
];

const NOW = new Date('2026-09-04T12:00:00.000Z');

function renderList(overrides: Partial<React.ComponentProps<typeof ConversationList>> = {}) {
  const onOpen = jest.fn();
  const onDelete = jest.fn();

  render(
    <ConversationList
      conversations={CHATS}
      openId="conv_2"
      onOpen={onOpen}
      onDelete={onDelete}
      now={NOW}
      {...overrides}
    />
  );

  return { onOpen, onDelete };
}

describe('ConversationList', () => {
  it('lists every chat by name', () => {
    renderList();

    expect(screen.getByText('Cancelling an order')).toBeInTheDocument();
    expect(screen.getByText('what did I order?')).toBeInTheDocument();
  });

  it('says how long ago each one was', () => {
    renderList();

    expect(screen.getByText('1h ago')).toBeInTheDocument();
    expect(screen.getByText('1d ago')).toBeInTheDocument();
  });

  it('opens a chat when its row is clicked', () => {
    const { onOpen } = renderList();

    screen.getByText('what did I order?').click();

    expect(onOpen).toHaveBeenCalledWith('conv_1');
  });

  it('tells the customer which chat they are in', () => {
    renderList();

    expect(
      screen.getByRole('button', { name: /Cancelling an order/ })
    ).toHaveAttribute('aria-current', 'true');
    expect(
      screen.getByRole('button', { name: /what did I order\?/ })
    ).not.toHaveAttribute('aria-current', 'true');
  });

  it('says so plainly when there are no chats yet', () => {
    renderList({ conversations: [] });

    expect(screen.getByText(/No chats yet/i)).toBeInTheDocument();
  });

  it('does NOT delete on the first click', () => {
    // THE MUST PROVE. One stray click must not destroy a conversation.
    const { onDelete } = renderList();

    screen.getByRole('button', { name: 'Delete what did I order?' }).click();

    expect(onDelete).not.toHaveBeenCalled();
  });

  it('asks for confirmation, then deletes on the second click', () => {
    const { onDelete } = renderList();

    screen.getByRole('button', { name: 'Delete what did I order?' }).click();

    const confirm = screen.getByRole('button', {
      name: 'Confirm deleting what did I order?',
    });
    expect(confirm).toBeInTheDocument();

    confirm.click();

    expect(onDelete).toHaveBeenCalledWith('conv_1');
  });

  it('lets the customer back out of a delete', () => {
    const { onDelete } = renderList();

    screen.getByRole('button', { name: 'Delete what did I order?' }).click();
    screen.getByRole('button', { name: 'Keep what did I order?' }).click();

    expect(onDelete).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', {
        name: 'Confirm deleting what did I order?',
      })
    ).not.toBeInTheDocument();
  });

  it('arms only one row at a time', () => {
    // Arming a second row while the first is armed would leave two live
    // confirm buttons on screen, either of which destroys something.
    renderList();

    screen.getByRole('button', { name: 'Delete what did I order?' }).click();
    screen.getByRole('button', { name: 'Delete Cancelling an order' }).click();

    expect(
      screen.queryByRole('button', {
        name: 'Confirm deleting what did I order?',
      })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Confirm deleting Cancelling an order',
      })
    ).toBeInTheDocument();
  });

  it('does not open a chat when its delete button is clicked', () => {
    // The delete button sits inside the row. Without stopping the event
    // it would arm the delete AND switch chats in one click.
    const { onOpen } = renderList();

    screen.getByRole('button', { name: 'Delete what did I order?' }).click();

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('renders a name as text, never as markup', () => {
    // A name is the customer's own first message today, and a
    // model-written title from Phase 4 tomorrow. Neither is markup.
    renderList({
      conversations: [
        {
          id: 'conv_x',
          name: '<img src=x onerror=alert(1)>',
          lastTurnAt: NOW.toISOString(),
        },
      ],
    });

    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest --selectProjects unit --testPathPattern "assistant-conversation-list"`

Expected: FAIL — `Cannot find module '@/components/assistant/conversation-list'`.

- [ ] **Step 3: Write the component**

Create `components/assistant/conversation-list.tsx`:

```tsx
'use client';

// components/assistant/conversation-list.tsx
//
// The history view: every chat this customer has had, newest first.
//
// PRESENTATIONAL. It is handed the chats and three callbacks and owns
// exactly one piece of state -- which row is armed for deletion -- because
// that state is about this rendering and nothing outside it needs to know.
//
// `now` is a prop so the relative times are testable without mocking the
// clock, and defaults so callers do not have to care.

import { useState } from 'react';
import { Trash2 } from 'lucide-react';

import type { ListedChat } from './assistant-provider';
import { relativeTime } from '@/lib/assistant/relative-time';

interface ConversationListProps {
  conversations: ListedChat[];
  /** The chat currently in the panel, if any. */
  openId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  now?: Date;
}

export function ConversationList({
  conversations,
  openId,
  onOpen,
  onDelete,
  now = new Date(),
}: ConversationListProps) {
  // ONE row at a time. Two armed rows would leave two live confirm
  // buttons on screen, either of which destroys something.
  const [arming, setArming] = useState<string | null>(null);

  if (conversations.length === 0) {
    return (
      <p className="px-3 py-3 text-sm text-slate-500">
        No chats yet. Ask something and it will appear here.
      </p>
    );
  }

  return (
    <ul className="divide-y">
      {conversations.map((chat) => (
        <li key={chat.id} className="flex items-center gap-1 px-1">
          <button
            type="button"
            onClick={() => onOpen(chat.id)}
            // aria-current rather than colour alone: which chat you are in
            // has to be available to a screen reader too.
            aria-current={chat.id === openId ? 'true' : undefined}
            className={`flex-1 truncate px-2 py-2 text-left text-sm hover:bg-slate-50 ${
              chat.id === openId ? 'font-medium text-slate-900' : 'text-slate-700'
            }`}
          >
            {/* Rendered as text. A name is the customer's own words today
                and a model-written title tomorrow; neither is markup. */}
            <span className="block truncate">{chat.name}</span>
            <span className="block text-xs text-slate-400">
              {relativeTime(new Date(chat.lastTurnAt), now)}
            </span>
          </button>

          {arming === chat.id ? (
            <span className="flex shrink-0 items-center gap-1 pr-1">
              <button
                type="button"
                aria-label={`Confirm deleting ${chat.name}`}
                onClick={() => {
                  setArming(null);
                  onDelete(chat.id);
                }}
                className="rounded px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
              >
                Delete
              </button>
              <button
                type="button"
                aria-label={`Keep ${chat.name}`}
                onClick={() => setArming(null)}
                className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              aria-label={`Delete ${chat.name}`}
              // The first click ARMS. Deleting a conversation on one stray
              // click is not recoverable -- there is no undo, by decision.
              onClick={() => setArming(chat.id)}
              className="shrink-0 rounded p-2 text-slate-400 hover:bg-slate-100 hover:text-rose-700"
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
```

Note: the delete button is a **sibling** of the row button, not a child of it. Nesting it inside would make one click both arm the delete and open the chat, and would also be invalid HTML — a button inside a button. That is what `does not open a chat when its delete button is clicked` pins down.

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest --selectProjects unit --testPathPattern "assistant-conversation-list"`

Expected: PASS, 12 tests.

- [ ] **Step 5: Mutation-check**

Apply each, confirm FAIL, revert:

1. Make the trash button call `onDelete(chat.id)` directly instead of `setArming` → `does NOT delete on the first click` fails.
2. Change `arming === chat.id` to `arming !== null` → `arms only one row at a time` fails.
3. Remove `setArming(null)` from the confirm handler → `lets the customer back out of a delete` still passes but `arms only one row` is unaffected; instead remove `setArming(null)` from the **Cancel** button → `lets the customer back out of a delete` fails.
4. Remove the `aria-current` attribute → `tells the customer which chat they are in` fails.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/assistant/conversation-list.tsx apps/web/tests/unit/assistant-conversation-list.test.tsx
git commit -m "feat: the history view

Presentational: handed the chats and three callbacks, owning exactly one
piece of state -- which row is armed for deletion.

Deleting takes two deliberate clicks, and only one row can be armed at a
time. There is no undo by decision, so one stray click must not be enough.

The delete button is a sibling of the row button rather than a child: a
button inside a button is invalid, and one click would both arm the delete
and switch chats.

Mutation-tested: 4 mutations, all caught.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: the panel header

**Files:**
- Modify: `components/assistant/assistant-widget.tsx`
- Test: `tests/unit/assistant-widget.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/assistant-widget.test.tsx`:

```tsx
describe('the panel header', () => {
  it('offers a new chat and a history button', async () => {
    renderWidget();
    await open();

    expect(
      screen.getByRole('button', { name: 'Start a new chat' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Show chat history' })
    ).toBeInTheDocument();
  });

  it('shows the history when the history button is clicked', async () => {
    renderWidget();
    await open();

    await act(async () => {
      screen.getByRole('button', { name: 'Show chat history' }).click();
    });

    // The empty-state wording of ConversationList, which is what renders
    // when the provider has no chats.
    expect(screen.getByText(/No chats yet/i)).toBeInTheDocument();
  });

  it('goes back to the conversation from the history', async () => {
    renderWidget();
    await open();

    await act(async () => {
      screen.getByRole('button', { name: 'Show chat history' }).click();
    });
    await act(async () => {
      screen.getByRole('button', { name: 'Back to the conversation' }).click();
    });

    expect(screen.getByPlaceholderText('Ask something')).toBeInTheDocument();
  });

  it('hides the message box while the history is showing', async () => {
    // Typing into a box that would post to whichever chat happens to be
    // open is a way to send a message to the wrong conversation.
    renderWidget();
    await open();

    await act(async () => {
      screen.getByRole('button', { name: 'Show chat history' }).click();
    });

    expect(screen.queryByPlaceholderText('Ask something')).toBeNull();
  });

  it('disables both header buttons while a turn is streaming', async () => {
    // THE MUST PROVE, on the rendering side. The provider refuses anyway,
    // but a button that looks live and does nothing is its own bug.
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/api/assistant/conversations')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { conversations: [], conversation: null } }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: { getReader: () => ({ read: () => new Promise(() => {}) }) },
      } as unknown as Response;
    });

    renderWidget();
    await open();
    await ask('what did I order?');

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Start a new chat' })
      ).toBeDisabled()
    );
    expect(
      screen.getByRole('button', { name: 'Show chat history' })
    ).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest --selectProjects unit --testPathPattern "assistant-widget"`

Expected: FAIL — no button named `Start a new chat`.

- [ ] **Step 3: Change the widget**

Replace the imports at the top of `components/assistant/assistant-widget.tsx`:

```tsx
import { useState } from 'react';
import { History, Plus } from 'lucide-react';

import { AssistantText } from './assistant-text';
import { ConversationList } from './conversation-list';
import { useAssistant } from './assistant-provider';
import { ToolActivityChip } from './tool-activity';
```

Replace the destructuring and add the view state:

```tsx
export function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [showingHistory, setShowingHistory] = useState(false);
  const [draft, setDraft] = useState('');
  const {
    transcript,
    status,
    send,
    conversations,
    conversationId,
    newChat,
    openConversation,
    deleteConversation,
  } = useAssistant();

  const busy = status === 'streaming';
```

Replace the header block:

```tsx
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-medium">Assistant</span>

        <div className="flex items-center gap-1">
          {/*
            BOTH DISABLED WHILE STREAMING. The stream in flight belongs to
            the chat that is open; switching under it would file the answer
            against the wrong conversation. The provider refuses regardless
            -- this is so the buttons do not look live while it does.
          */}
          <button
            type="button"
            aria-label="Start a new chat"
            disabled={busy}
            onClick={() => {
              newChat();
              setShowingHistory(false);
            }}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
          </button>

          <button
            type="button"
            aria-label={
              showingHistory ? 'Back to the conversation' : 'Show chat history'
            }
            disabled={busy}
            onClick={() => setShowingHistory((previous) => !previous)}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
          >
            <History aria-hidden="true" className="h-4 w-4" />
          </button>

          <button
            type="button"
            aria-label="Close the shopping assistant"
            onClick={() => setOpen(false)}
            className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
          >
            Close
          </button>
        </div>
      </div>
```

Wrap the transcript body and the form so the history replaces both. Everything from `<div className="flex-1 space-y-3 overflow-y-auto ...">` down to the closing `</form>` becomes:

```tsx
      {showingHistory ? (
        <div className="flex-1 overflow-y-auto">
          <ConversationList
            conversations={conversations}
            openId={conversationId}
            onOpen={(id) => {
              void openConversation(id);
              setShowingHistory(false);
            }}
            onDelete={(id) => void deleteConversation(id)}
          />
        </div>
      ) : (
        <>
          {/* the existing transcript div, unchanged */}
          {/* the existing form, unchanged */}
        </>
      )}
```

Keep the transcript `<div>` and the `<form>` exactly as they are; only their placement inside the new conditional changes. The message box is deliberately not rendered while the history shows: a box that posts to whichever chat happens to be open is a way to send a message to the wrong conversation.

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest` then `npx tsc --noEmit` then `npx next build`

Expected: all suites pass, typecheck clean, `✓ Compiled successfully`.

- [ ] **Step 5: Mutation-check**

Apply each, confirm FAIL, revert:

1. Remove `disabled={busy}` from both header buttons → `disables both header buttons while a turn is streaming` fails.
2. Render the form outside the conditional so it always shows → `hides the message box while the history is showing` fails.
3. Make the history button's `aria-label` the constant `'Show chat history'` → `goes back to the conversation from the history` fails.
4. Replace the `<ConversationList .../>` render with `null` → `shows the history when the history button is clicked` fails.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/assistant/assistant-widget.tsx apps/web/tests/unit/assistant-widget.test.tsx
git commit -m "feat: a new-chat and a history button in the panel header

Both disabled while a turn is streaming, matching the provider's own
refusal -- a button that looks live and quietly does nothing is its own
bug, so the guard exists in both places.

The history replaces the transcript AND the message box. A box that posts
to whichever chat happens to be open is a way to send a message to the
wrong conversation.

Icons are lucide-react's Plus and History, already this project's icon set
and the pair in the reference design.

Mutation-tested: 4 mutations, all caught.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: deploy and verify

No migration in this phase, so nothing gates the deploy. The pre-deploy command added in Phase 2 will run `prisma migrate deploy`, find nothing pending, and continue.

- [ ] **Step 1: Push**

```bash
git push
```

- [ ] **Step 2: Confirm the deploy is the build you think it is**

Check the `web` service's latest deployment reads SUCCESS **for the commit you just pushed**. A 200 proves *a* container is up, not that it is *this* one — a mistake already made twice on this project.

- [ ] **Step 3: Verify live**

Signed in, after a hard refresh:

1. Open the assistant. Click the history button. Your existing chat is listed, with a name taken from your first message and a relative time.
2. Click `+`. The panel clears. **Open the history again — no new empty chat has appeared.** This is the one most likely to be quietly wrong.
3. Ask something. Open the history. The new chat is now listed, named after what you just asked.
4. Open the older chat from the list. Its turns appear. Ask a follow-up; it joins that chat, not the new one.
5. Delete a chat: first click shows Delete/Cancel, second click removes it. Press Cancel on another and confirm nothing happens.
6. Delete the chat you are currently reading. The panel should clear rather than leave a transcript with no rows behind it.
7. While an answer is streaming, both header buttons must be greyed out.

- [ ] **Step 4: Record the outcome**

Append a dated entry to `docs/PLAN_M4_STOREFRONT.txt` naming what was verified and what was not. State only what was actually checked.

- [ ] **Step 5: Commit the record**

```bash
git add apps/web/../docs/PLAN_M4_STOREFRONT.txt
git commit -m "docs: record the chat history UI, verified live

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage.** Covers Phase 3 of `2026-09-03-chat-persistence-roadmap.md`: `+` and history icons in the header (Task 6), history list with name and relative time (Tasks 1, 5), open (Tasks 3, 4, 5), per-row delete with inline confirm (Tasks 2, 3, 4, 5), both icons disabled while streaming (Tasks 4, 6). The three MUST PROVEs map to `starts a new chat WITHOUT storing anything` (Task 4), `refuses to switch chats while a turn is streaming` (Task 4) plus `disables both header buttons while a turn is streaming` (Task 6), and `does NOT delete on the first click` (Task 5).
- **Type consistency.** `ListedConversation { id, name, lastTurnAt }` in the store matches `ListedChat { id, name, lastTurnAt }` in the provider — the store's `lastTurnAt` is a `Date` that `respond.ts` normalises to an ISO string on the way out, which is why the provider's is a `string`. `ConversationList` takes `ListedChat[]`. `loadConversation` returns the same `StoredConversation` that `loadLatestConversation` does, so the provider's hydration code is the same shape in both paths.
- **Not done here, on purpose.** No renaming a chat by hand — it is not in the roadmap. No bulk delete, no undo, no pagination of the list. Pagination is worth revisiting when a customer has enough chats for it to matter; the query is already ordered and indexed on `(userId, lastTurnAt)`, so adding `take`/`cursor` later is additive.
- **Known gap, accepted.** The list refreshes on mount, after each turn, and after a delete — but not while the panel sits open in another tab. Two tabs will disagree until one of them acts. Polling or a socket for a sidebar nobody is looking at is not worth it.
- **A note on Task 6's mutations.** Three of the four kill a specific behaviour; the fourth is a render-removal check, which is weaker but is the honest test for "the history view is actually mounted". Do not pad the list to match the other tasks' counts.
