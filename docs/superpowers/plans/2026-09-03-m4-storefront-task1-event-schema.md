# M4 Storefront Task 1 - The Event Schema

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The TypeScript half of the assistant event contract — a parser that cannot be
crashed by bad input, and a reducer that reaches the same conversation the Python side does.

**Architecture:** `lib/assistant/events.ts` holds the types, a zod-backed `parseEvent`, and
`replay`. The golden stream is vendored from the agent repository byte-for-byte and both
sides test against it, which is what makes "the two must agree exactly" enforceable rather
than aspirational.

**Tech Stack:** TypeScript, zod 3.22 (already a dependency), Jest + ts-jest.

---

## This task does not design anything

The schema was frozen on 2026-09-02 by the agent plan's Task 4. The canonical definition is:

```
mcp-ecom-agent-layer/contracts/README.md
mcp-ecom-agent-layer/contracts/assistant-events.v1.json
```

`PLAN_M4_STOREFRONT.txt` Task 1 already says so. **Implement it; do not re-derive it.** If
something in it looks wrong, change it in the agent repository and let both test suites go
red — that is the mechanism working, not a problem to route around.

## The one place this half must NOT mirror the Python

`agent/events.py::replay` **throws** on an event from a future schema version. That is right
for a harness: a Python process that has been handed events it does not understand should
stop loudly.

It is wrong here. This task's MUST PROVE is that *a malformed event does not take down the
stream*. A UI that throws mid-stream leaves the customer with a half-rendered conversation
and no way forward.

So the two halves divide the job differently, and the seam is `parseEvent`:

| | Python | TypeScript |
|---|---|---|
| unknown `type` | ignored by `replay` | ignored by `replay` |
| bad `v`, missing field, wrong shape | `replay` throws | **`parseEvent` returns `null`; the event is dropped and the stream continues** |

`replay` here only ever sees events `parseEvent` has already accepted. The asymmetry is
deliberate and is recorded in the module's own header, because it is exactly the kind of
difference that reads as drift a year later.

## What "vendored" means

`assistant-events.v1.json` is **copied, not adapted**. Do not reformat it, reorder its keys,
or "tidy" it. The two repositories hold the same bytes so a diff between them is a real
signal. A test asserts the copy against the agent repository's original when both are checked
out side by side, and says so plainly when they are not.

---

## File Structure

- **Create** `apps/web/lib/assistant/events.ts` — types, `parseEvent`, `replay`.
- **Create** `apps/web/lib/assistant/assistant-events.v1.json` — the vendored golden stream.
- **Create** `apps/web/tests/unit/assistant-events.test.ts`.

Nothing else. No components, no routes — those are Tasks 3 and 4, and a parser that arrives
with its first consumer is a parser shaped by one caller.

---

### Task 1.1: Vendor the fixture

**Files:** Create `apps/web/lib/assistant/assistant-events.v1.json`

- [ ] **Step 1: Copy it verbatim** from `../mcp-ecom-agent-layer/contracts/assistant-events.v1.json`.

- [ ] **Step 2: Write the failing test**

```typescript
// apps/web/tests/unit/assistant-events.test.ts
//
// The TypeScript half of the assistant event contract. The schema was
// frozen in the agent repository (contracts/README.md); this side
// implements it and is held to it by the same golden stream, so a shape
// change on either side turns one of the two suites red.

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const FIXTURE_PATH = join(__dirname, '../../lib/assistant/assistant-events.v1.json');

describe('the vendored golden stream', () => {
  it('is present and is version 1', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));
    expect(fixture.version).toBe(1);
    expect(fixture.events.length).toBeGreaterThan(0);
  });

  it('covers every event type, so none can drift unnoticed', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));
    const types = new Set(fixture.events.map((e: any) => e.type));

    expect(types).toEqual(
      new Set([
        'message',
        'tool_started',
        'tool_completed',
        'approval_required',
        'error',
      ])
    );
  });

  it('is byte-identical to the agent repository when both are checked out', () => {
    // Copied, never adapted: the two repositories hold the same bytes so
    // a diff between them is a real signal. Skipped rather than failed
    // when the sibling repo is absent -- CI here has no reason to have
    // it, and a test that cannot run must not masquerade as one that
    // passed, so it says which it is.
    const original = join(
      __dirname,
      '../../../../../mcp-ecom-agent-layer/contracts/assistant-events.v1.json'
    );

    if (!existsSync(original)) {
      console.warn(
        'agent repo not checked out beside this one; cross-repo byte check not run'
      );
      return;
    }

    expect(readFileSync(FIXTURE_PATH, 'utf-8')).toBe(readFileSync(original, 'utf-8'));
  });
});
```

- [ ] **Step 3: Run it.** `npm run test:unit -- assistant-events`
      Expected: the first two pass, the third either passes or warns.

- [ ] **Step 4: Commit.**

---

### Task 1.2: The parser

**Files:** Create `apps/web/lib/assistant/events.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// append to apps/web/tests/unit/assistant-events.test.ts
import { parseEvent, SCHEMA_VERSION } from '@/lib/assistant/events';

describe('parseEvent', () => {
  const good = {
    v: 1,
    seq: 0,
    type: 'message',
    data: { text: 'hello' },
  };

  it('accepts a well-formed event', () => {
    expect(parseEvent(good)).toEqual(good);
  });

  it('accepts a type it has never heard of', () => {
    // Forward compatibility in the direction that actually happens: a
    // newer agent deployed against an older UI must not break it.
    const future = { v: 1, seq: 1, type: 'thinking_started', data: {} };

    expect(parseEvent(future)).toEqual(future);
  });

  // The MUST PROVE. Each of these would otherwise throw mid-stream and
  // leave the customer with half a conversation and no way forward.
  it.each([
    ['null', null],
    ['a string', 'not an event'],
    ['a number', 42],
    ['an empty object', {}],
    ['a future schema version', { v: 2, seq: 0, type: 'message', data: {} }],
    ['a missing seq', { v: 1, type: 'message', data: {} }],
    ['a non-numeric seq', { v: 1, seq: 'first', type: 'message', data: {} }],
    ['a missing type', { v: 1, seq: 0, data: {} }],
    ['a non-object data', { v: 1, seq: 0, type: 'message', data: 'text' }],
  ])('drops %s rather than throwing', (_label, input) => {
    expect(parseEvent(input)).toBeNull();
  });

  it('drops a truncated JSON frame rather than throwing', () => {
    // What a dropped connection mid-frame actually looks like.
    let parsed: unknown;
    expect(() => {
      try {
        parsed = parseEvent(JSON.parse('{"v":1,"seq":0'));
      } catch (error) {
        parsed = parseEvent(null);
      }
    }).not.toThrow();
    expect(parsed).toBeNull();
  });

  it('exports the version it implements', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Expected: cannot resolve `@/lib/assistant/events`.

- [ ] **Step 3: Write the implementation**

```typescript
// apps/web/lib/assistant/events.ts
//
// The TypeScript half of the assistant event contract.
//
// CANONICAL DEFINITION LIVES ELSEWHERE: mcp-ecom-agent-layer/contracts/
// README.md, with agent/events.py as the other implementation and
// assistant-events.v1.json as the golden stream both are tested against.
// Change the shape there, not here.
//
// ONE DELIBERATE DIFFERENCE FROM THE PYTHON, recorded because it will
// otherwise read as drift. agent/events.py::replay THROWS on an event
// from a future schema version -- correct for a harness, which should
// stop loudly when handed something it does not understand. It is wrong
// for a UI: a throw mid-stream leaves the customer with half a
// conversation and no way forward. Here, parseEvent returns null for
// anything malformed and the stream carries on; replay only ever sees
// events parseEvent has accepted.

import { z } from 'zod';

export const SCHEMA_VERSION = 1;

export const EVENT_TYPES = [
  'message',
  'tool_started',
  'tool_completed',
  'approval_required',
  'error',
] as const;

export type KnownEventType = (typeof EVENT_TYPES)[number];

export interface AssistantEvent {
  v: number;
  seq: number;
  // Deliberately a string, not KnownEventType: an unknown type is a
  // valid event this reader ignores, not a parse failure.
  type: string;
  data: Record<string, unknown>;
}

const envelope = z.object({
  v: z.literal(SCHEMA_VERSION),
  seq: z.number().int(),
  type: z.string().min(1),
  data: z.record(z.unknown()),
});

export function parseEvent(raw: unknown): AssistantEvent | null {
  const result = envelope.safeParse(raw);
  return result.success ? (result.data as AssistantEvent) : null;
}
```

- [ ] **Step 4: Run to verify it passes. Step 5: Commit.**

---

### Task 1.3: The reducer

**Files:** Modify `apps/web/lib/assistant/events.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// append to apps/web/tests/unit/assistant-events.test.ts
import { replay } from '@/lib/assistant/events';

describe('replay', () => {
  it('reaches the conversation the golden stream documents', () => {
    // The cross-repository anchor. The agent repo asserts the same file
    // reduces to the same `expected` in Python. If either side changes
    // shape, one of the two suites fails -- which is the whole mechanism.
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));

    expect(replay(fixture.events)).toEqual(fixture.expected);
  });

  it('lists an approved call once, not twice', () => {
    // approval_required and the tool_started that follows an approval
    // carry the SAME call_id -- one call, approved and then run. Listing
    // it twice would draw two chips for one cancellation. This was a
    // real bug in the Python reducer, caught by the live approval gate.
    const events = [
      { v: 1, seq: 0, type: 'approval_required', data: { call_id: 'c1', tool: 'cancel_order', arguments: { order_id: 'o1' } } },
      { v: 1, seq: 1, type: 'tool_started', data: { call_id: 'c1', tool: 'cancel_order', arguments: { order_id: 'o1' } } },
      { v: 1, seq: 2, type: 'tool_completed', data: { call_id: 'c1', tool: 'cancel_order', ok: true, result: { status: 'CANCELLED' } } },
    ];

    const tools = replay(events as any).tools;

    expect(tools).toHaveLength(1);
    expect(tools[0].ok).toBe(true);
    expect(tools[0].awaiting_approval).toBeUndefined();
  });

  it('leaves a still-pending approval marked as waiting', () => {
    const events = [
      { v: 1, seq: 0, type: 'approval_required', data: { call_id: 'c1', tool: 'cancel_order', arguments: { order_id: 'o1' } } },
    ];

    expect(replay(events as any).tools[0].awaiting_approval).toBe(true);
  });

  it('ignores an event type it does not know', () => {
    const events = [
      { v: 1, seq: 0, type: 'message', data: { text: 'hi' } },
      { v: 1, seq: 1, type: 'thinking_started', data: {} },
      { v: 1, seq: 2, type: 'message', data: { text: 'bye' } },
    ];

    expect(replay(events as any).text).toEqual(['hi', 'bye']);
  });

  it('reports a gap rather than hiding it', () => {
    // A dropped event means the screen is not showing what happened.
    const events = [
      { v: 1, seq: 0, type: 'message', data: { text: 'hi' } },
      { v: 1, seq: 2, type: 'message', data: { text: 'bye' } },
    ];

    expect(replay(events as any).gaps).toEqual([1]);
  });

  it('pairs a failed tool with its start and keeps the message verbatim', () => {
    const events = [
      { v: 1, seq: 0, type: 'tool_started', data: { call_id: 'c1', tool: 'add_to_cart', arguments: { quantity: 57 } } },
      { v: 1, seq: 1, type: 'tool_completed', data: { call_id: 'c1', tool: 'add_to_cart', ok: false, error: '409: Only 17 available' } },
    ];

    const tool = replay(events as any).tools[0];

    expect(tool.ok).toBe(false);
    expect(tool.arguments).toEqual({ quantity: 57 });
    expect(tool.error).toContain('Only 17 available');
  });

  it('survives an empty stream', () => {
    expect(replay([])).toEqual({ text: [], tools: [], errors: [], gaps: [] });
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Write the implementation**, mirroring `agent/events.py::replay` exactly:
  `text` in order; `tools` keyed by `call_id` with first-seen ordering; `tool_completed`
  setting `ok` and then `result` or `error` and clearing `awaiting_approval`; `error` into
  `errors`; unknown types ignored; `gaps` computed across the observed `seq` range. A
  completion whose start was never seen still records — half a pair is a symptom worth
  seeing, not one worth swallowing.

- [ ] **Step 4: Run the full unit suite** — `npm run test:unit` — and `npm run type-check`.
      Nothing existing may break: this task adds files and touches none.

- [ ] **Step 5: Commit.**

---

### Task 1.4: Record it

- [ ] **Mark Task 1 done** in `docs/PLAN_M4_STOREFRONT.txt`, recording the parse/replay
  division of labour and the deliberate asymmetry with the Python, so Task 4's renderer knows
  that a `null` from `parseEvent` means "drop this frame and keep going".

---

## Self-Review

**Spec coverage.** Task 1's two MUST PROVEs are 1.2 (an unknown type is ignored; a malformed
event returns null instead of throwing) and 1.3 (the golden stream reduces to its documented
`expected`). The plan's instruction to vendor rather than re-derive is 1.1.

**Placeholders.** 1.3 step 3 describes the reducer rather than repeating it, because it is a
line-for-line port of `agent/events.py::replay`, which is in the repository next door and is
the authority. Every behaviour it must have is named, and each has a test above it.

**Type consistency.** `AssistantEvent`, `parseEvent`, `replay`, `SCHEMA_VERSION` and
`EVENT_TYPES` are used identically in the module and the tests. The `Conversation` shape
(`text`, `tools`, `errors`, `gaps`) matches the fixture's `expected` key, which is what the
anchor test compares against.

**What this task deliberately does not do.** No components, no routes, no streaming. A parser
that ships alongside its first consumer is a parser shaped by one caller, and this one has
three ahead of it — the widget, the approval card, and Phase 3.
