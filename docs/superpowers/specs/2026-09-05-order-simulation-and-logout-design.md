# Order Progression Simulation, and a Logout — Design

> Decisions taken in brainstorming on 2026-09-05. This is the design, not the
> implementation plan; the plan follows and should not re-litigate anything
> here.

**Goal:** an order placed today moves through its own lifecycle instead of
sitting on `PENDING` forever — one step a minute — and whoever is demonstrating
the shop can freeze a particular order to work on it. Separately: a customer
can sign out, which today they cannot do at all.

## The problem, stated precisely

`OrderStatus` declares seven values. Two are reachable:

| Status | Written by | Reachable |
|---|---|---|
| `PENDING` | `server/actions/checkout-demo.ts:74`, on every order placed | yes |
| `CANCELLED` | `server/orders/cancel-order.ts:71` | yes — customer, and the agent behind an approval |
| `CONFIRMED` `PROCESSING` `SHIPPED` `DELIVERED` `REFUNDED` | nothing | **no** |

`server/actions/admin.ts` exports an `updateOrderStatus` action, but no admin
page calls it. It is dead code.

So the four-step tracker on the order page can only ever show its first dot
lit, and five of the seven declared states are unreachable.

And there is no customer sign-out anywhere. Only `app/admin/layout.tsx:96`
links to `/api/auth/signout`, which is NextAuth's unstyled default page.

## Decisions

Taken during brainstorming. Do not redesign these; if one turns out to be
wrong, say so and stop.

| Decision | Chosen | Why not the alternative |
|---|---|---|
| Pause scope | **Per order** | Lets one order be frozen for a demo while another keeps moving. A global switch cannot show both at once. |
| Existing orders | **Never progress** | Their clock is null. Nothing lurches, and the feature is provably opt-in. Measuring from `createdAt` would send a two-day-old order straight to `DELIVERED` on the first read. |
| UI framing | **A labelled demo panel** | The tracker stays as it looks now; the controls sit below it in a visually distinct box that says the progression is simulated. Blending them in would imply the shop can really halt a shipment. |
| Advancing | **Lazily, on read** | No scheduler, no cron service, no background job, and directly testable. The same call the chat roadmap already made for compaction, in writing, for these reasons. A client-side timer would put progression under the browser's control. |
| Logout placement | **Header and profile** | The profile Security tab is where it was asked for; the header is where people actually look. One component, two placements. |

### `CONFIRMED` is not in the ladder, and that is not a new opinion

`updateOrderStatusSchema` in `lib/validators.ts:134` lists six statuses and
**omits `CONFIRMED`** — the only status-changing code in the project already
refuses to produce it. The tracker does not key a step on it either. An order
sitting in `CONFIRMED` would render identically to `PENDING`, so advancing into
it would mean a minute passing with nothing visibly changing.

The ladder is therefore:

```
PENDING  ->  PROCESSING  ->  SHIPPED  ->  DELIVERED
        1m            1m            1m
```

`CANCELLED`, `REFUNDED` and `DELIVERED` are terminal. `CONFIRMED` and
`REFUNDED` stay in the enum, produced by nothing, exactly as today.

---

## Data model

Two nullable columns on `Order`:

```prisma
  /// When this order's simulated lifecycle started. NULL means it has none
  /// and never will -- every order that existed before this shipped.
  simulationStartedAt DateTime?
  /// When it was paused, or NULL if it is running.
  simulationPausedAt  DateTime?
```

**Pause needs no third column.** On resume, `simulationStartedAt` is pushed
forward by however long the pause lasted and `simulationPausedAt` is cleared.
Elapsed time is then:

```
running:  now        - simulationStartedAt
paused:   pausedAt   - simulationStartedAt
```

An accumulator column would be a second source of truth for the same fact.

The migration is additive: two nullable columns, no backfill. Every existing
row keeps `simulationStartedAt = NULL` and is therefore inert — which is the
"existing orders never progress" decision, enforced by the absence of data
rather than by a rule someone has to remember.

`checkout-demo.ts` sets `simulationStartedAt: new Date()` when it creates an
order. That one line is the whole opt-in.

## The pure part

One function, no database and no clock of its own:

```ts
export function dueStatus(
  status: OrderStatus,
  startedAt: Date | null,
  pausedAt: Date | null,
  now: Date
): OrderStatus | null
```

Returns the status the order *should* be, or `null` when nothing is due.
`now` is a parameter, so its tests are a table of inputs rather than a mocked
clock — the same shape `relativeTime` and `buildHistory` already take in this
codebase.

Properties it must have:

- `null` startedAt → always `null`. Nothing advances an order with no clock.
- terminal status (`CANCELLED`, `REFUNDED`, `DELIVERED`) → always `null`.
- ten minutes elapsed → `DELIVERED` directly, in one step, not three.
- paused → elapsed is frozen at the pause instant, so a long pause advances
  nothing.
- an order already ahead of where the clock says → `null`, never backwards.

## Where the advance is written

In the query layer — `server/queries/orders.ts` — so that every reader gets it:
the order page, the orders list, the `/api/v1` order routes, and therefore the
agent's `get_orders` and `get_order`.

Writing during a read is unusual enough to justify:

- the alternative is a scheduler, which is a service to keep alive for a demo;
- nobody can observe a stale status without reading it, so advancing at read
  time is indistinguishable from advancing on a timer;
- it is bounded — only rows with a non-null clock, in a moving state, that are
  actually due.

The write is a **compare-and-set**: `updateMany` with the current status in the
`where` clause, so two concurrent readers cannot double-advance. It also stamps
`shippedAt` / `deliveredAt`, columns that already exist and are never currently
set.

## The routes

```
POST /api/orders/{id}/simulation/pause
POST /api/orders/{id}/simulation/resume
```

**Deliberately not under `/api/v1`.** That surface is documented as "the entire
surface the AI layer is allowed to use", and freezing a demo clock is not an AI
capability. Cookie-authenticated like the assistant routes — which means the
agent structurally cannot pause or resume anything, rather than being trusted
not to.

Ownership is filtered inside the query, and a stranger's order id gets a 404,
never a 403 — the same rule every other order route follows.

Both are idempotent: pausing a paused order and resuming a running one are
successes that change nothing.

## The UI

**The tracker stays as it is** for orders that are progressing.

**A cancelled order stops pretending.** Today `CANCELLED` and `REFUNDED` render
identically to `PENDING` — first dot green, three grey — because neither
appears in any `completed` list. That is misleading, it is on the component
this work is already changing, and it is a few lines: for a terminal
non-delivered status, show a single clear line instead of the ladder.

**The demo panel** sits below the tracker, visually distinct:

```
  Demo -- this order advances one step each minute.
  Next: Shipped, in about 40s.                    [ Pause ]

  Note: an order can only be cancelled while it is Placed or
  Processing. Pause it if you want to try cancelling.
```

That note is not decoration. `cancelOrderFor` permits only `PENDING` and
`PROCESSING`, so after roughly two minutes an order can no longer be cancelled
— which is simultaneously the first reliable way to demonstrate the agent's
tool-failure path, and a two-minute window on demonstrating its approval flow.
Better stated on screen than discovered.

**Watching it happen.** The order page is a server component, so a small client
component calls `router.refresh()` every 15 seconds — and that refresh is
itself the read that triggers the advance. It stops polling when the order is
terminal or paused, so a delivered order does not poll forever.

## Logout

One client component, `components/sign-out-button.tsx`, calling
`signOut({ callbackUrl: '/' })` from `next-auth/react`. Rendered in two places:

- **the header**, inside the existing `user ?` branch beside the profile icon.
  `components/header.tsx` is a server component, which is exactly why the
  button must be a client island rather than a link;
- **the profile Security tab**, below `PasswordChangeForm`, separated.

Not a link to `/api/auth/signout`: that is NextAuth's unstyled default page and
is not what a customer should land on.

The full navigation `callbackUrl` triggers remounts the assistant provider, so
the panel comes back empty and its mount request 401s. There is a test for
that, because "the previous customer's conversation is still on screen" is the
kind of thing nobody checks.

## What this must prove

1. **An order with a null clock never advances.** This is what protects every
   row that already exists.
2. **Pausing actually stops time.** Resuming after ten minutes of pause
   advances nothing; the ten minutes are not silently owed.
3. **The simulation never un-cancels an order,** and never moves one backwards.
4. **The agent cannot pause or resume.** The routes are outside `/api/v1` and
   require a session cookie.
5. **Signing out ends the session and empties the assistant panel.**

## Deliberately not in scope

- **No `CONFIRMED` and no `REFUNDED`** in the ladder. Both stay unreachable,
  as they are today.
- **No admin control.** `updateOrderStatus` in `server/actions/admin.ts` stays
  dead code; wiring an admin status editor is a separate piece of work with a
  different audience.
- **No configurable interval.** One minute, a named constant. An env var would
  be a knob nobody turns and a second thing to explain.
- **No global freeze.** Decided above.
- **No change to the cancellation window.** Making `SHIPPED` cancellable to
  suit the demo would change a real business rule to make a toy more
  convenient. The pause button exists for exactly this.
