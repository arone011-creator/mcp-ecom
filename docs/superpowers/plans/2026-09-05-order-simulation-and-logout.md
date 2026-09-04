# Order Progression Simulation, and a Logout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** an order placed from now on advances `PENDING → PROCESSING → SHIPPED → DELIVERED`, one step a minute, and can be frozen per order from a labelled demo panel. Separately, a customer can sign out — from the header and from the profile.

**Architecture:** no scheduler. One pure function decides what status an order is due, and four read paths call one writer that advances it if so. Pause is two nullable columns and no accumulator: resuming pushes the start forward. The design is `docs/superpowers/specs/2026-09-05-order-simulation-and-logout-design.md`; do not re-litigate its decisions.

**Tech Stack:** Next.js App Router, Prisma + Postgres (Supabase), NextAuth, Jest (`unit` / `integration`), lucide-react.

**Not in this plan:** a global freeze, an admin status editor, `CONFIRMED` or `REFUNDED` in the ladder, a configurable interval, and any change to the cancellation window. All five are refused in the design, with reasons.

---

## One correction to the design, found while planning

The design says the advance is written "in the query layer — `server/queries/orders.ts` — so that every reader gets it". **That is wrong, and would have shipped a half-working feature.** There are four independent order read paths, and two deliberately bypass the query layer:

| Path | Reads via |
|---|---|
| `app/(account)/orders/[id]/page.tsx` | `getOrderById` → `getOrder` |
| `app/(account)/orders/page.tsx` | `getOrders` |
| `app/api/v1/orders/route.ts` | **Prisma directly** — its header comment explains why: `getUserOrders` takes a user id it trusts and was once wrapped in `unstable_cache`, which served one user's orders to another |
| `app/api/v1/orders/[id]/route.ts` | **Prisma directly**, same reason |

So the advance goes in its own module and is called from **four sites**, explicitly. That is greppable and honest; a Prisma middleware would hide a write inside every query in the app. `getUserOrders` is deliberately left alone — it is wrapped in `createCachedFunction`, so an advance inside it would not run on a cache hit, and nothing on the customer's path uses it.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `prisma/schema.prisma` | two columns on `Order` | modify |
| `prisma/migrations/20260905120000_add_order_simulation_clock/migration.sql` | the migration | create |
| `lib/orders/simulation.ts` | the pure ladder: what status is due | create |
| `tests/unit/order-simulation.test.ts` | its tests | create |
| `server/orders/advance-simulation.ts` | the compare-and-set write | create |
| `tests/integration/advance-simulation.test.ts` | its tests | create |
| `server/actions/checkout-demo.ts` | start the clock on a new order | modify |
| `server/queries/orders.ts` | advance on the two page reads | modify |
| `app/api/v1/orders/route.ts`, `app/api/v1/orders/[id]/route.ts` | advance on the two API reads | modify |
| `tests/integration/api-v1-orders.test.ts` | API tests | add |
| `app/api/orders/[id]/simulation/route.ts` | `POST` pause / resume | create |
| `tests/integration/api-order-simulation.test.ts` | its tests | create |
| `components/orders/order-simulation-panel.tsx` | the demo panel and the polling | create |
| `tests/unit/order-simulation-panel.test.tsx` | its tests | create |
| `app/(account)/orders/[id]/page.tsx` | render the panel; fix the cancelled tracker | modify |
| `components/sign-out-button.tsx` | the button | create |
| `tests/unit/sign-out-button.test.tsx` | its tests | create |
| `components/header.tsx` | sign out beside the profile icon | modify |
| `app/(account)/profile/page.tsx` | sign out in the Security tab | modify |

**Why `lib/orders/simulation.ts` is separate from `server/orders/advance-simulation.ts`.** The first is a pure function of four arguments with no database and no clock; the second writes. Splitting them means the interesting logic is tested as a table of inputs, and the writer's tests are only about the compare-and-set. It is the same split as `history-budget.ts` (pure) beside `conversation-store.ts` (writes).

---

## Task 1: the columns

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260905120000_add_order_simulation_clock/migration.sql`
- Modify: `server/actions/checkout-demo.ts`

- [ ] **Step 1: Add the fields to the schema**

In `prisma/schema.prisma`, in `model Order`, after `cancelledAt DateTime?`:

```prisma
  /// When this order's simulated lifecycle started, or NULL if it has none
  /// and never will. Every order that existed before this feature shipped
  /// keeps NULL, which is what makes "existing orders never progress" a
  /// fact about the data rather than a rule somebody has to remember.
  simulationStartedAt DateTime?
  /// When the simulation was paused, or NULL if it is running. Resuming
  /// pushes simulationStartedAt forward by the pause duration rather than
  /// accumulating a debt in a third column -- one source of truth for
  /// elapsed time instead of two that can disagree.
  simulationPausedAt  DateTime?
```

- [ ] **Step 2: Write the migration by hand**

There is no shadow database available on this project, so migrations are written by hand — the same as `20260903190000_add_assistant_conversations`.

Create `prisma/migrations/20260905120000_add_order_simulation_clock/migration.sql`:

```sql
-- The simulated order lifecycle (2026-09-05).
--
-- Additive and nullable. No backfill, deliberately: an existing row keeps
-- NULL and is therefore inert, which is how "orders that already exist
-- never progress" is enforced -- by the absence of data rather than by a
-- condition somebody has to remember to write.
--
-- CAMELCASE, because the `orders` table is camelCase. The newer assistant
-- tables use snake_case through @@map; this one does not, and a migration
-- has to match the table it alters rather than the house style of the
-- table next to it.
ALTER TABLE "orders" ADD COLUMN "simulationStartedAt" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN "simulationPausedAt" TIMESTAMP(3);
```

- [ ] **Step 3: Verify the schema parses and the client regenerates**

```bash
npx prisma validate
npx prisma generate
```

`prisma validate` reads `.env`, not `.env.local`, so pass dummy values inline rather than reaching for real credentials:

```bash
DATABASE_URL=postgresql://validate:validate@localhost:5432/validate DIRECT_URL=postgresql://validate:validate@localhost:5432/validate npx prisma validate
```

Expected: `The schema at prisma/schema.prisma is valid`.

- [ ] **Step 4: Start the clock on new orders**

In `server/actions/checkout-demo.ts`, in the `tx.order.create` data block, after `status: 'PENDING',`:

```typescript
          // THE ENTIRE OPT-IN. An order created from now on has a clock;
          // every order that already exists does not, and never will.
          simulationStartedAt: new Date(),
```

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations server/actions/checkout-demo.ts
git commit -m "$(cat <<'EOF'
feat: a simulated lifecycle clock on new orders

Two nullable columns and no backfill. An order that already exists keeps
a null clock and is therefore inert -- "existing orders never progress"
enforced by absence of data rather than by a condition somebody has to
remember to write.

Resuming will push the start forward rather than accumulating a debt, so
there is no third column and no second source of truth for elapsed time.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: what status is due

**Files:**
- Create: `lib/orders/simulation.ts`
- Test: `tests/unit/order-simulation.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/order-simulation.test.ts
//
// The ladder. A pure function of four arguments -- no database, no clock
// of its own -- so these are a table of inputs rather than a mocked clock.

import { LADDER, STEP_MS, dueStatus } from '@/lib/orders/simulation';

const START = new Date('2026-09-05T12:00:00.000Z');

/** `minutes` after the clock started. */
function at(minutes: number): Date {
  return new Date(START.getTime() + minutes * 60_000);
}

describe('dueStatus', () => {
  it('advances one step a minute', () => {
    expect(dueStatus('PENDING', START, null, at(0))).toBeNull();
    expect(dueStatus('PENDING', START, null, at(1))).toBe('PROCESSING');
    expect(dueStatus('PENDING', START, null, at(2))).toBe('SHIPPED');
    expect(dueStatus('PENDING', START, null, at(3))).toBe('DELIVERED');
  });

  it('does not advance before the minute is up', () => {
    expect(dueStatus('PENDING', START, null, at(0.99))).toBeNull();
  });

  it('goes straight to the right step after a long absence', () => {
    // Ten minutes away lands on DELIVERED in ONE write, not three. A loop
    // that stepped once per read would take three page loads to catch up.
    expect(dueStatus('PENDING', START, null, at(10))).toBe('DELIVERED');
  });

  it('never advances past the end of the ladder', () => {
    expect(dueStatus('DELIVERED', START, null, at(99))).toBeNull();
  });

  it('reports nothing when the order is already where it should be', () => {
    expect(dueStatus('PROCESSING', START, null, at(1))).toBeNull();
    expect(dueStatus('SHIPPED', START, null, at(2))).toBeNull();
  });

  it('never moves an order backwards', () => {
    // An order ahead of its clock -- however that happened -- is left
    // alone. Rewinding a customer's order is worse than a stale one.
    expect(dueStatus('SHIPPED', START, null, at(1))).toBeNull();
    expect(dueStatus('DELIVERED', START, null, at(0))).toBeNull();
  });

  it('never advances an order with no clock', () => {
    // THE MUST PROVE. This is what protects every row that existed before
    // this feature shipped.
    expect(dueStatus('PENDING', null, null, at(999))).toBeNull();
  });

  it('never advances a cancelled order', () => {
    // And so can never un-cancel one.
    expect(dueStatus('CANCELLED', START, null, at(99))).toBeNull();
  });

  it('never advances a refunded order', () => {
    expect(dueStatus('REFUNDED', START, null, at(99))).toBeNull();
  });

  it('never advances an order in CONFIRMED', () => {
    // CONFIRMED is not on the ladder and nothing produces it. An order
    // that somehow holds it is left alone rather than guessed about.
    expect(dueStatus('CONFIRMED', START, null, at(99))).toBeNull();
  });

  it('freezes time while paused', () => {
    // THE MUST PROVE. Paused at 30 seconds, read an hour later: still not
    // due, because the clock stopped when the pause started.
    const pausedAt = at(0.5);

    expect(dueStatus('PENDING', START, pausedAt, at(60))).toBeNull();
  });

  it('reports what was already due at the moment of the pause', () => {
    // Pausing does not roll anything back. If a step was owed before the
    // pause, it is still owed after it.
    const pausedAt = at(2);

    expect(dueStatus('PENDING', START, pausedAt, at(60))).toBe('SHIPPED');
  });

  it('describes the ladder the tracker draws', () => {
    // Four states, matching the four dots on the order page. CONFIRMED is
    // absent on purpose -- lib/validators.ts omits it too, and an order
    // sitting in it renders identically to PENDING.
    expect(LADDER).toEqual(['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED']);
  });

  it('steps once a minute', () => {
    expect(STEP_MS).toBe(60_000);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest --selectProjects unit --testPathPattern "order-simulation"`
Expected: FAIL — cannot find module `@/lib/orders/simulation`.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/orders/simulation.ts
//
// The simulated order lifecycle: what status an order is due to be.
//
// PURE. No database, no clock of its own -- `now` is a parameter, so the
// tests are a table of inputs rather than a mocked clock, the same shape
// `relativeTime` and `buildHistory` already take in this codebase.
//
// This exists because five of the seven OrderStatus values were
// unreachable: nothing in the app ever wrote CONFIRMED, PROCESSING,
// SHIPPED, DELIVERED or REFUNDED, so an order sat on PENDING forever and
// the four-step tracker could only ever light its first dot.

import type { OrderStatus } from '@prisma/client';

/**
 * The states an order moves through, in order.
 *
 * CONFIRMED IS DELIBERATELY ABSENT, and that is not a new opinion:
 * `updateOrderStatusSchema` in lib/validators.ts already omits it, and
 * the tracker keys no step on it -- so an order sitting in CONFIRMED
 * renders identically to PENDING. Advancing into it would mean a minute
 * passing with nothing visibly changing, which reads as broken.
 *
 * REFUNDED is absent for a different reason: it is an outcome of a
 * business process, not a stage of delivery.
 */
export const LADDER: OrderStatus[] = [
  'PENDING',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
];

/** One step a minute. A named constant, not a configurable knob. */
export const STEP_MS = 60_000;

/**
 * The status this order is due to be, or null if nothing is due.
 *
 * Null covers every reason not to move, and the caller treats them
 * identically because they mean the same thing -- leave this row alone:
 *
 *   - no clock (every order that predates this feature);
 *   - a status that is not on the ladder (CANCELLED, REFUNDED, CONFIRMED);
 *   - the end of the ladder;
 *   - not enough unpaused time yet;
 *   - already at or ahead of where the clock says it should be.
 *
 * The last of those is why this compares indexes rather than just
 * returning the computed step: an order ahead of its clock is left alone.
 * Rewinding a customer's order would be worse than a stale one.
 */
export function dueStatus(
  status: OrderStatus,
  startedAt: Date | null,
  pausedAt: Date | null,
  now: Date
): OrderStatus | null {
  if (!startedAt) return null;

  const current = LADDER.indexOf(status);
  // Not on the ladder at all, or already at the end of it.
  if (current === -1 || current === LADDER.length - 1) return null;

  // Paused time does not count. The clock stopped when the pause began,
  // so a pause of any length advances nothing -- but a step that was
  // already owed at that instant is still owed.
  const until = pausedAt ?? now;
  const elapsed = until.getTime() - startedAt.getTime();

  const reached = Math.min(
    Math.floor(elapsed / STEP_MS),
    LADDER.length - 1
  );

  return reached > current ? LADDER[reached]! : null;
}
```

- [ ] **Step 4: Run the tests and commit**

Run: `npx jest --selectProjects unit --testPathPattern "order-simulation"` → 14 passed.

```bash
git add lib/orders/simulation.ts tests/unit/order-simulation.test.ts
git commit -m "$(cat <<'EOF'
feat: the pure order lifecycle ladder

Pure, with `now` as a parameter, so the tests are a table of inputs. Ten
minutes away lands on DELIVERED in one step rather than needing three
page loads to catch up.

Null covers every reason not to move -- no clock, a status off the
ladder, the end of it, not enough unpaused time, or an order already
ahead of its clock. Rewinding a customer's order would be worse than a
stale one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: writing the advance

**Files:**
- Create: `server/orders/advance-simulation.ts`
- Test: `tests/integration/advance-simulation.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/integration/advance-simulation.test.ts
//
// The write. lib/orders/simulation.ts decides WHAT is due; this decides
// how it is written, and the only interesting thing about it is that two
// readers racing must not advance the same order twice.

const mockPrisma = {
  order: { updateMany: jest.fn() },
};
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: mockPrisma }));

import {
  advanceIfDue,
  advanceAllDue,
} from '@/server/orders/advance-simulation';

const START = new Date('2026-09-05T12:00:00.000Z');
const LATER = new Date('2026-09-05T12:02:30.000Z');

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ord_1',
    status: 'PENDING',
    simulationStartedAt: START,
    simulationPausedAt: null,
    shippedAt: null,
    deliveredAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockPrisma.order.updateMany.mockReset().mockResolvedValue({ count: 1 });
});

describe('advanceIfDue', () => {
  it('writes the status the order is due', async () => {
    await advanceIfDue(order(), LATER);

    expect(mockPrisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SHIPPED' }),
      })
    );
  });

  it('writes nothing when nothing is due', async () => {
    await advanceIfDue(order(), START);

    expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('writes nothing for an order with no clock', async () => {
    // THE MUST PROVE, at the layer that actually touches the database.
    await advanceIfDue(order({ simulationStartedAt: null }), LATER);

    expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('writes nothing for a cancelled order', async () => {
    await advanceIfDue(order({ status: 'CANCELLED' }), LATER);

    expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('guards the write with the status it read', async () => {
    // A COMPARE-AND-SET. Two readers racing both compute SHIPPED; the
    // second matches no row, because the first already moved it off
    // PENDING. Without this, a burst of reads could double-advance.
    await advanceIfDue(order(), LATER);

    const [args] = mockPrisma.order.updateMany.mock.calls[0];
    expect(args.where).toEqual({ id: 'ord_1', status: 'PENDING' });
  });

  it('stamps shippedAt when it ships', async () => {
    // The column already exists and nothing has ever set it.
    await advanceIfDue(order(), LATER);

    const [args] = mockPrisma.order.updateMany.mock.calls[0];
    expect(args.data.shippedAt).toEqual(LATER);
    expect(args.data.deliveredAt).toBeUndefined();
  });

  it('stamps deliveredAt when it is delivered', async () => {
    const muchLater = new Date(START.getTime() + 10 * 60_000);
    await advanceIfDue(order(), muchLater);

    const [args] = mockPrisma.order.updateMany.mock.calls[0];
    expect(args.data.status).toBe('DELIVERED');
    expect(args.data.deliveredAt).toEqual(muchLater);
  });

  it('does not restamp a timestamp the order already has', async () => {
    const already = new Date('2026-09-05T11:00:00.000Z');
    const muchLater = new Date(START.getTime() + 10 * 60_000);

    await advanceIfDue(order({ shippedAt: already }), muchLater);

    const [args] = mockPrisma.order.updateMany.mock.calls[0];
    expect(args.data.shippedAt).toBeUndefined();
  });

  it('answers with the advanced order so the caller renders it fresh', async () => {
    // Rather than making the caller re-read. A page that rendered the row
    // it read a moment before the write would show the customer a status
    // one step behind the database.
    const advanced = await advanceIfDue(order(), LATER);

    expect(advanced.status).toBe('SHIPPED');
  });

  it('answers with the original order when nothing was due', async () => {
    const untouched = order();

    expect(await advanceIfDue(untouched, START)).toBe(untouched);
  });

  it('does not fail a read when the write fails', async () => {
    // A READ MUST NOT DIE BECAUSE A COSMETIC WRITE DID. The customer is
    // looking at their order; a failed simulation tick is not a reason to
    // show them an error page.
    mockPrisma.order.updateMany.mockRejectedValue(new Error('db is gone'));

    const result = await advanceIfDue(order(), LATER);

    expect(result.status).toBe('PENDING');
  });
});

describe('advanceAllDue', () => {
  it('advances each order that is due and leaves the rest alone', async () => {
    const rows = [
      order({ id: 'a' }),
      order({ id: 'b', simulationStartedAt: null }),
      order({ id: 'c', status: 'CANCELLED' }),
    ];

    const advanced = await advanceAllDue(rows, LATER);

    expect(advanced.map((o) => o.status)).toEqual([
      'SHIPPED',
      'PENDING',
      'CANCELLED',
    ]);
    expect(mockPrisma.order.updateMany).toHaveBeenCalledTimes(1);
  });

  it('keeps the order of the list it was given', async () => {
    const rows = [order({ id: 'a' }), order({ id: 'b' })];

    expect((await advanceAllDue(rows, LATER)).map((o) => o.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('writes nothing for an empty list', async () => {
    expect(await advanceAllDue([], LATER)).toEqual([]);
    expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify they fail, then write the implementation**

```typescript
// server/orders/advance-simulation.ts
//
// Advancing an order's simulated lifecycle, lazily, when somebody reads it.
//
// WHY A READ WRITES. The alternative is a scheduler -- a cron service to
// keep alive for a demo -- and nobody can observe a stale status without
// reading it, so advancing at read time is indistinguishable from
// advancing on a timer. It is bounded: only rows with a clock, in a
// moving state, that are actually due.
//
// CALLED FROM FOUR PLACES, EXPLICITLY. The two account pages read through
// server/queries/orders.ts; the two /api/v1 routes query Prisma directly
// and deliberately (their comments explain why -- getUserOrders takes a
// user id it trusts and was once wrapped in unstable_cache, which served
// one customer's orders to another). A Prisma middleware would cover all
// four by hiding a write inside every query in the application. Four
// explicit calls are greppable; that would not be.

import prisma from '@/lib/prisma';
import { dueStatus } from '@/lib/orders/simulation';

/** The fields this needs. Anything wider is the caller's business. */
export interface SimulatableOrder {
  id: string;
  status: string;
  simulationStartedAt: Date | null;
  simulationPausedAt: Date | null;
  shippedAt?: Date | null;
  deliveredAt?: Date | null;
}

/**
 * Advance one order if it is due, and answer the order as it now stands.
 *
 * Returns the SAME object when nothing was due, and a copy carrying the
 * new status when something was -- so a caller can render what it was
 * given without re-reading. A page that rendered the row it read a moment
 * before the write would show a status one step behind the database.
 */
export async function advanceIfDue<T extends SimulatableOrder>(
  order: T,
  now: Date = new Date()
): Promise<T> {
  const due = dueStatus(
    order.status as never,
    order.simulationStartedAt,
    order.simulationPausedAt,
    now
  );

  if (!due) return order;

  const data: Record<string, unknown> = { status: due };
  // The columns already exist and nothing has ever set them. Only stamped
  // on the way past, and never overwritten -- a second stamp would move a
  // date the customer may already have been shown.
  if (due === 'SHIPPED' && !order.shippedAt) data.shippedAt = now;
  if (due === 'DELIVERED' && !order.deliveredAt) data.deliveredAt = now;

  try {
    await prisma.order.updateMany({
      // A COMPARE-AND-SET. Two readers racing both compute the same
      // target; the second matches no row because the first already moved
      // it. updateMany rather than update for the same reason
      // deleteConversation uses deleteMany: update throws when nothing
      // matches, and a throw here would be a read failing over a write.
      where: { id: order.id, status: order.status as never },
      data: data as never,
    });
  } catch (error) {
    // A READ MUST NOT DIE BECAUSE A COSMETIC WRITE DID. The customer is
    // looking at their order; a failed simulation tick is not a reason to
    // show them an error page. They will see the advance on the next read.
    console.error('Advancing an order simulation failed:', error);
    return order;
  }

  return { ...order, ...data } as T;
}

/** The same, for a list. Order is preserved; the caller renders it as given. */
export async function advanceAllDue<T extends SimulatableOrder>(
  orders: T[],
  now: Date = new Date()
): Promise<T[]> {
  return Promise.all(orders.map((order) => advanceIfDue(order, now)));
}
```

- [ ] **Step 3: Run the tests and commit**

---

## Task 4: the four read paths

**Files:**
- Modify: `server/queries/orders.ts`, `app/api/v1/orders/route.ts`, `app/api/v1/orders/[id]/route.ts`
- Test: `tests/integration/api-v1-orders.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/integration/api-v1-orders.test.ts`, following that file's existing harness:

```typescript
  it('advances a due order before answering', async () => {
    // The agent reads orders through this route. A status that only
    // updates when a human opens a web page would make the assistant
    // describe a different shop from the one the customer is looking at.
    ...
    expect(body.data.orders[0].status).toBe('SHIPPED');
  });

  it('leaves an order with no clock exactly as it is', async () => { ... });
```

- [ ] **Step 2: Wire the four sites**

`server/queries/orders.ts` — in `getOrder`, replace the returned `findFirst` with:

```typescript
  const order = await prisma.order.findFirst({ /* ...unchanged... */ });

  // Advanced on the way out, so the page renders what the database now
  // says rather than what it said a moment ago. See
  // server/orders/advance-simulation.ts for why a read writes at all.
  return order ? await advanceIfDue(order) : null;
```

and in `getOrders`, after the `Promise.all`:

```typescript
  return {
    orders: await advanceAllDue(orders),
    pagination: { /* ...unchanged... */ },
  };
```

`app/api/v1/orders/route.ts` — before `publicOrders(...)`:

```typescript
    const advanced = await advanceAllDue(orders);
```

`app/api/v1/orders/[id]/route.ts` — before `publicOrder(...)`:

```typescript
    const advanced = await advanceIfDue(order);
```

Each file imports from `@/server/orders/advance-simulation`.

- [ ] **Step 3: Run the full suite, then commit**

`getUserOrders` is deliberately untouched — it is wrapped in `createCachedFunction`, so an advance inside it would not run on a cache hit, and nothing on the customer's path uses it. Note that in the commit message so the omission reads as a decision rather than an oversight.

---

## Task 5: pause and resume

**Files:**
- Create: `app/api/orders/[id]/simulation/route.ts`
- Test: `tests/integration/api-order-simulation.test.ts`

- [ ] **Step 1: Write the failing tests**

Cover, following the shape of `tests/integration/api-assistant-title.test.ts`:

- pausing a running order sets `simulationPausedAt` and answers 200;
- resuming pushes `simulationStartedAt` forward by the pause duration and clears `simulationPausedAt` — **the MUST PROVE**, asserted on the arithmetic, not just on the null;
- pausing an already-paused order is a 200 that writes nothing (idempotent);
- resuming a running order is a 200 that writes nothing;
- another customer's order id answers **404**, and the query carries `userId`;
- an unauthenticated caller gets 401 and writes nothing;
- a body with no recognised action is a 400.

- [ ] **Step 2: Write the route**

```typescript
// app/api/orders/[id]/simulation/route.ts
//
// POST -- pause or resume one order's simulated lifecycle.
//
// DELIBERATELY NOT UNDER /api/v1. That surface is documented as the entire
// set of capabilities the AI layer may use, and freezing a demo clock is
// not one of them. Cookie-authenticated like the assistant routes, which
// means the agent structurally cannot reach this -- rather than being
// trusted not to.
//
// RESUMING PUSHES THE START FORWARD by however long the pause lasted,
// rather than accumulating a debt in a third column. Elapsed time then has
// exactly one representation instead of two that can disagree.
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import prisma from '@/lib/prisma';
import { fail, ok } from '../../../v1/_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const secret = process.env.NEXTAUTH_SECRET;
  const session = secret ? await getToken({ req, secret }) : null;
  if (!session?.sub) return fail(401, 'Authentication required');

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'Request body must be JSON');
  }

  const action = (body as { action?: unknown })?.action;
  if (action !== 'pause' && action !== 'resume') {
    return fail(400, 'Action must be pause or resume');
  }

  // Ownership inside the query, and a 404 for a stranger's id rather than
  // a 403 -- the same rule every other order route follows, because a
  // distinguishable refusal confirms the id is real.
  const order = await prisma.order.findFirst({
    where: { id, userId: session.sub as string },
    select: { id: true, simulationStartedAt: true, simulationPausedAt: true },
  });

  if (!order) return fail(404, 'Order not found');
  // Nothing to pause on an order that has no clock. Not an error: the
  // customer asked for a state it is already in.
  if (!order.simulationStartedAt) return ok({ paused: false });

  const now = new Date();

  if (action === 'pause') {
    // Idempotent: already paused is already the answer.
    if (!order.simulationPausedAt) {
      await prisma.order.update({
        where: { id: order.id },
        data: { simulationPausedAt: now },
      });
    }
    return ok({ paused: true });
  }

  if (order.simulationPausedAt) {
    await prisma.order.update({
      where: { id: order.id },
      data: {
        // The whole of the pause, given back. Without this the order would
        // jump forward by however long it sat paused.
        simulationStartedAt: new Date(
          order.simulationStartedAt.getTime() +
            (now.getTime() - order.simulationPausedAt.getTime())
        ),
        simulationPausedAt: null,
      },
    });
  }

  return ok({ paused: false });
}
```

- [ ] **Step 3: Run the tests and commit**

---

## Task 6: the demo panel, the polling, and the cancelled tracker

**Files:**
- Create: `components/orders/order-simulation-panel.tsx`
- Modify: `app/(account)/orders/[id]/page.tsx`
- Test: `tests/unit/order-simulation-panel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Cover:

- a running order shows **Pause**, and clicking it POSTs `{action:'pause'}` to the right url;
- a paused order shows **Resume** and says it is paused;
- a delivered order shows the panel's explanatory line but **no** buttons — there is nothing left to pause;
- an order with no clock (`simulationStartedAt` null) renders **nothing at all** — every pre-existing order;
- a cancelled order renders nothing;
- the cancellation note is present, because the two-minute window is a real constraint on demonstrating the approval flow;
- `router.refresh()` is called on the interval while running, and **not** while paused, and **not** once delivered.

- [ ] **Step 2: Write the panel**

```tsx
'use client';

// components/orders/order-simulation-panel.tsx
//
// The demo controls for one order's simulated lifecycle.
//
// LABELLED AS A SIMULATION, on purpose. A real shopper cannot pause their
// own delivery, so dressing these as ordinary tracking controls would
// imply the shop can halt a shipment. The tracker above is untouched; this
// sits below it and says what it is.
//
// The polling here is also what MAKES the order advance: the status is
// written lazily when something reads the order, and router.refresh() is
// that read.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pause, Play } from 'lucide-react';

/** How often to re-read while an order is still moving. */
const POLL_MS = 15_000;

interface Props {
  orderId: string;
  status: string;
  hasClock: boolean;
  paused: boolean;
}

export function OrderSimulationPanel({
  orderId,
  status,
  hasClock,
  paused,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // Every order that predates this feature. Nothing to say about it.
  const moving = status === 'PENDING' || status === 'PROCESSING' || status === 'SHIPPED';

  useEffect(() => {
    // Nothing to watch: no clock, paused, or already at the end. A
    // delivered order polling forever would be a page that never settles.
    if (!hasClock || paused || !moving) return;

    const timer = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [hasClock, paused, moving, router]);

  if (!hasClock) return null;

  async function toggle() {
    setBusy(true);
    try {
      await fetch(`/api/orders/${encodeURIComponent(orderId)}/simulation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: paused ? 'resume' : 'pause' }),
      });
      router.refresh();
    } catch {
      // The panel stays as it was. A failed demo control is not worth an
      // error message on a page about somebody's order.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 text-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium text-amber-900">
            Demo — this order advances one step each minute
          </p>
          <p className="mt-1 text-amber-800">
            {!moving
              ? 'This order has finished its progression.'
              : paused
                ? 'Paused. It will not move until you resume it.'
                : 'Running.'}
          </p>
        </div>

        {moving ? (
          <button
            type="button"
            onClick={toggle}
            disabled={busy}
            className="inline-flex shrink-0 items-center gap-1.5 rounded border border-amber-400 bg-white px-3 py-1.5 font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
          >
            {paused ? (
              <Play aria-hidden="true" className="h-4 w-4" />
            ) : (
              <Pause aria-hidden="true" className="h-4 w-4" />
            )}
            {paused ? 'Resume' : 'Pause'}
          </button>
        ) : null}
      </div>

      {/* NOT DECORATION. cancelOrderFor permits only PENDING and
          PROCESSING, so after about two minutes this order can no longer
          be cancelled -- which is both the only reliable way to demonstrate
          the assistant's failure path and a two-minute window on
          demonstrating its approval flow. Better said than discovered. */}
      <p className="mt-3 border-t border-amber-200 pt-2 text-xs text-amber-700">
        An order can only be cancelled while it is Placed or Processing.
        Pause it if you want to try cancelling it from the assistant.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Render it, and stop the tracker lying about cancelled orders**

In `app/(account)/orders/[id]/page.tsx`, replace the `statusSteps` block's use with a branch: when `order.status` is `CANCELLED` or `REFUNDED`, render a single clear line instead of the four dots.

```tsx
  const terminated = order.status === 'CANCELLED' || order.status === 'REFUNDED';
```

```tsx
  {/* A cancelled order used to render identically to a pending one --
      first dot green, three grey -- because CANCELLED appears in no
      `completed` list. That told the customer their cancelled order was
      on its way. */}
  {terminated ? (
    <p className="text-sm font-medium text-rose-700">
      {order.status === 'CANCELLED'
        ? 'This order was cancelled.'
        : 'This order was refunded.'}
    </p>
  ) : (
    /* ...the existing four-step tracker, unchanged... */
  )}
```

and below the Order Status card:

```tsx
  <OrderSimulationPanel
    orderId={order.id}
    status={order.status}
    hasClock={order.simulationStartedAt !== null}
    paused={order.simulationPausedAt !== null}
  />
```

- [ ] **Step 4: Run the tests and commit**

---

## Task 7: signing out

**Files:**
- Create: `components/sign-out-button.tsx`
- Modify: `components/header.tsx`, `app/(account)/profile/page.tsx`
- Test: `tests/unit/sign-out-button.test.tsx`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/sign-out-button.test.tsx

jest.mock('next-auth/react', () => ({ signOut: jest.fn() }));

import { fireEvent, render, screen } from '@testing-library/react';
import { signOut } from 'next-auth/react';

import { SignOutButton } from '@/components/sign-out-button';

const mockSignOut = signOut as unknown as jest.Mock;

beforeEach(() => mockSignOut.mockReset());

describe('SignOutButton', () => {
  it('signs out and returns the customer to the shop', () => {
    render(<SignOutButton />);

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: '/' });
  });

  it('is reachable by its accessible name in the icon-only form', () => {
    // The header has room for an icon and not a word. The name still has
    // to be there, or the only way out of the account is invisible to a
    // screen reader.
    render(<SignOutButton iconOnly />);

    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write the button**

```tsx
'use client';

// components/sign-out-button.tsx
//
// The only way a customer can sign out. Before this there was none: only
// app/admin/layout.tsx linked to /api/auth/signout, which is NextAuth's
// unstyled default page and not somewhere a shopper should land.
//
// A CLIENT ISLAND, because signOut() is client-side and both of its homes
// -- the header and the profile page -- are server components.

import { signOut } from 'next-auth/react';
import { LogOut } from 'lucide-react';

export function SignOutButton({ iconOnly = false }: { iconOnly?: boolean }) {
  return (
    <button
      type="button"
      // Back to the shop rather than to a sign-in page: signing out is not
      // the start of signing in again.
      onClick={() => signOut({ callbackUrl: '/' })}
      aria-label={iconOnly ? 'Sign out' : undefined}
      className={
        iconOnly
          ? 'inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent'
          : 'inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent'
      }
    >
      <LogOut aria-hidden="true" className="h-5 w-5" />
      {iconOnly ? null : 'Sign out'}
    </button>
  );
}
```

- [ ] **Step 3: Put it in both places**

`components/header.tsx`, inside the existing `user ?` branch, after the profile link:

```tsx
              <SignOutButton iconOnly />
```

`app/(account)/profile/page.tsx`, in the `security` tab after `<PasswordChangeForm />`:

```tsx
          <Separator />
          <div>
            <h4 className="text-sm font-medium">Sign out</h4>
            <p className="mb-3 mt-1 text-sm text-muted-foreground">
              End this session on this device.
            </p>
            <SignOutButton />
          </div>
```

- [ ] **Step 4: Prove the panel empties on sign-out**

Add to `tests/unit/assistant-mounting.test.ts` (or the provider tests, whichever the harness suits): after a signed-out mount — the conversations endpoint answering 401 — the provider holds no turns and no conversation id. "The previous customer's conversation is still on screen" is exactly the kind of thing nobody checks.

- [ ] **Step 5: Run the full suite, typecheck, build, commit**

```bash
npx jest && npx tsc --noEmit && npm run build
```

---

## Task 8: deploy, verify live, record

- [ ] **Step 1: Push, and watch the migration**

Storefront only; the agent is untouched. `prisma migrate deploy` runs as the Railway pre-deploy command, so **a failed migration blocks the deploy** — check the deploy log for the migration line, not just for SUCCESS.

- [ ] **Step 2: Verify live, by measuring**

Signed in as the demo customer, using the app's own sign-in button:

1. **Existing orders do not move.** Open the PENDING MacBook order placed on 2026-09-04. It must show **no demo panel** and must still be PENDING after several minutes. This is the MUST PROVE, and it is the first thing to check because it is the one that touches data that already exists.
2. **A new order moves.** Place an order, watch the tracker light Processing, then Shipped, then Delivered, without touching the page. Read the status off the DOM rather than eyeballing the dots.
3. **Pause actually stops it.** Pause a new order at Processing, wait three minutes, confirm it is still Processing. Resume, confirm it advances again about a minute later — not instantly, which would mean the pause was owed back rather than given back.
4. **The cancellation window is real.** Ask the assistant to cancel a paused PENDING order — it should offer the approval card. Then let one reach SHIPPED and ask again — it should fail visibly, with **Try again** and **Dismiss**. This finally closes the one thing M4 Task 6 could not verify live.
5. **A cancelled order stops claiming to be on its way.**
6. **Sign out works from both places**, lands on `/`, and the assistant panel is empty afterwards.

- [ ] **Step 3: Mutation-test**

| Mutation | Test that must catch it |
|---|---|
| `dueStatus` ignores a null `startedAt` | "never advances an order with no clock", Task 2 |
| `dueStatus` uses `now` even when paused | "freezes time while paused", Task 2 |
| `dueStatus` returns `LADDER[reached]` without the `reached > current` guard | "never moves an order backwards", Task 2 |
| `LADDER` gains `CONFIRMED` | the one-step-a-minute test, Task 2 |
| `advanceIfDue` drops `status` from the `updateMany` where | "guards the write with the status it read", Task 3 |
| resume clears `simulationPausedAt` without shifting the start | the resume arithmetic test, Task 5 |
| the panel polls while paused | the polling test, Task 6 |

Commit before each mutation. A `git checkout` to revert one will also revert uncommitted work — that happened twice in M4 and made two results unreadable. And a mutation that changes no file is not a surviving mutation: check the revert reports a changed path.

- [ ] **Step 4: Record it in `docs/PLAN_M4_STOREFRONT.txt` and update the docs**

Record what was verified live and what was not. Also update, in the same commit:

- `docs/TECHNICAL_SNAPSHOT.txt` — the data model gains two columns; the known-limitations list should note that the lifecycle is simulated and advances only when read;
- `docs/ITERATIONS.txt` — if anything here was found the hard way, it belongs in section 11.

---

## Self-review notes

**Spec coverage.** Every section of the design has a task: the columns and the opt-in (1), the pure ladder (2), the compare-and-set writer (3), the four read paths (4 — including the correction at the top of this plan), the routes (5), the demo panel, polling and the cancelled-tracker fix (6), the sign-out button in both places (7). All five of the design's "must prove" items have named tests: the null clock (2, 3), the pause freezing time (2, 5), never un-cancelling (2), the agent being unable to reach the routes (5, structurally — they are not under `/api/v1` and need a cookie), and sign-out emptying the panel (7).

**Type consistency.** `dueStatus` is defined in Task 2 and consumed in Task 3. `SimulatableOrder` is Task 3's parameter type and is satisfied by the Prisma `Order` rows read in Task 4. `advanceIfDue` / `advanceAllDue` keep their names across Tasks 3 and 4. The panel's props (`orderId`, `status`, `hasClock`, `paused`) are the four values Task 6's page passes.

**Placeholders.** Tasks 4, 5, 6 and 7 describe some tests rather than writing every one out, because each extends a suite whose harness already exists and inventing a second harness beside it would be the mistake. Every code change shows its code.
