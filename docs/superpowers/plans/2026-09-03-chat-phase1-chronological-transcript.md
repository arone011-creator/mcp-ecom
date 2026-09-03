# Chat Phase 1: Chronological Transcript — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the assistant panel reads chronologically — customer message on the right, then that message's reply and tool activity on the left, then the next customer message — instead of grouping all questions, then all tool chips, then all answers.

**Architecture:** `replay()` currently returns three parallel lists (`text`, `tools`, `errors`) and therefore discards the order events arrived in. This adds a fourth, ordered `timeline` to the reducer in both languages, re-vendors the golden fixture, and changes the provider to keep events grouped **by turn** rather than in one flat array. Grouping by turn is also the shape Phase 2 persists, so this is not throwaway work. `replay()` stays the only reducer.

**Tech Stack:** Python 3.11 + pytest (`mcp-ecom-agent-layer`); Next.js App Router + TypeScript + Jest (`mcp-ecom-web-app/apps/web`).

**Prerequisite reading:** `mcp-ecom-agent-layer/contracts/README.md` — this changes a frozen, cross-repository contract, and the procedure is the one `message_delta` already followed: additive, mirrored in both languages, golden fixture re-vendored, both suites red until both sides are done.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `mcp-ecom-agent-layer/agent/events.py` | canonical reducer | add `timeline` to `replay()` |
| `mcp-ecom-agent-layer/tests/test_agent_events.py` | reducer tests | add ordering tests |
| `mcp-ecom-agent-layer/contracts/assistant-events.v1.json` | golden stream | add `timeline` to `expected` |
| `mcp-ecom-agent-layer/contracts/README.md` | contract prose | document `timeline` |
| `mcp-ecom-web-app/apps/web/lib/assistant/events.ts` | TS reducer | mirror `timeline` |
| `mcp-ecom-web-app/apps/web/lib/assistant/assistant-events.v1.json` | vendored fixture | copy from agent repo |
| `mcp-ecom-web-app/apps/web/tests/unit/assistant-events.test.ts` | TS reducer tests | add ordering tests |
| `mcp-ecom-web-app/apps/web/components/assistant/assistant-provider.tsx` | conversation state | group events by turn; expose `transcript` |
| `mcp-ecom-web-app/apps/web/components/assistant/tool-activity.tsx` | tool chips | export a single-chip renderer |
| `mcp-ecom-web-app/apps/web/components/assistant/assistant-widget.tsx` | the panel | render the transcript chronologically |
| `mcp-ecom-web-app/apps/web/tests/unit/assistant-widget.test.tsx` | panel tests | assert DOM order across two turns |

### The timeline shape

Three item kinds. A tool is referenced **by `call_id`, never embedded**, because a tool's state changes after it appears — an embedded snapshot would show "working" forever.

```json
{"kind": "text",  "text": "Your most recent order is ORD-1042."}
{"kind": "tool",  "call_id": "call_1"}
{"kind": "error", "message": "The assistant could not reach the shop.", "retryable": true}
```

Reduction rules:

- `message_delta` — if the last item is an **open** text item, append to it; otherwise push a new open one.
- `message` — if a text item is open, **replace its text in place** and close it; otherwise push a closed one. In place matters: the answer keeps its position in the conversation.
- `tool_started` / `approval_required` / `tool_completed` — close any open text item, then push a tool item **if that `call_id` is not already on the timeline**.
- `error` — close any open text item, then push an error item.
- At the end, an open text item stays as it is. Those words were on screen.

`text`, `tools`, `errors` and `gaps` keep their exact current meanings. `timeline` is additive.

---

## Task 1: `timeline` in the canonical Python reducer

**Files:**
- Modify: `mcp-ecom-agent-layer/agent/events.py` — the `replay()` function
- Test: `mcp-ecom-agent-layer/tests/test_agent_events.py`

All commands run from `mcp-ecom-agent-layer/`. The interpreter is `.venv/Scripts/python.exe` on Windows, `.venv/bin/python` elsewhere.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_agent_events.py`, immediately before the `# --- emission from the turn loop` banner:

```python
# --- ordering -------------------------------------------------------------
#
# replay() returned three parallel lists and so discarded the order events
# arrived in. The chat panel rendered every question, then every tool chip,
# then every answer -- which looks correct for a single exchange and is
# obviously wrong for two. `timeline` is the ordered view.


def test_the_timeline_keeps_prose_and_tools_in_the_order_they_happened():
    events = [
        message(0, "Let me look."),
        tool_started(1, "call_1", "get_orders", {"limit": 3}),
        tool_completed(2, "call_1", "get_orders", result=[]),
        message(3, "You ordered ORD-1."),
    ]

    assert replay(events)["timeline"] == [
        {"kind": "text", "text": "Let me look."},
        {"kind": "tool", "call_id": "call_1"},
        {"kind": "text", "text": "You ordered ORD-1."},
    ]


def test_a_tool_appears_on_the_timeline_once_however_many_events_it_has():
    # An approved high-risk call emits approval_required, then tool_started,
    # then tool_completed under ONE call_id. Three items would draw three
    # cards for one cancellation.
    events = [
        approval_required(0, "call_1", "cancel_order", {"order_id": "ord_9"}),
        tool_started(1, "call_1", "cancel_order", {"order_id": "ord_9"}),
        tool_completed(2, "call_1", "cancel_order", result={"status": "CANCELLED"}),
    ]

    assert replay(events)["timeline"] == [{"kind": "tool", "call_id": "call_1"}]


def test_the_timeline_names_a_tool_rather_than_embedding_it():
    # A tool's state changes after it first appears. An embedded snapshot
    # would be captured as "working" and stay that way forever, so the
    # timeline carries the id and `tools` carries the state.
    events = [
        tool_started(0, "call_1", "get_orders", {"limit": 3}),
        tool_completed(1, "call_1", "get_orders", result=[{"orderNumber": "ORD-1"}]),
    ]

    conversation = replay(events)

    assert conversation["timeline"] == [{"kind": "tool", "call_id": "call_1"}]
    assert conversation["tools"][0]["ok"] is True


def test_fragments_become_one_timeline_item_that_the_message_finalises():
    events = [
        message_delta("Your most "),
        message_delta("recent order."),
        message(0, "Your most recent order."),
    ]

    assert replay(events)["timeline"] == [
        {"kind": "text", "text": "Your most recent order."}
    ]


def test_the_finished_message_replaces_the_fragments_in_place():
    # Position matters as much as content: appended at the end instead, the
    # answer would jump below a tool chip that came after it.
    events = [
        message_delta("Visit https://evil.example.com/x"),
        tool_started(0, "call_1", "get_orders", {}),
        message(1, "Visit [link removed]"),
    ]

    assert replay(events)["timeline"] == [
        {"kind": "text", "text": "Visit https://evil.example.com/x"},
        {"kind": "tool", "call_id": "call_1"},
        {"kind": "text", "text": "Visit [link removed]"},
    ]


def test_a_tool_closes_an_open_run_of_fragments():
    # Prose is finished once something else happens. Without closing, a
    # later fragment would be appended to prose from before the tool call.
    events = [
        message_delta("Checking"),
        tool_started(0, "call_1", "get_orders", {}),
        message_delta("Found it"),
    ]

    assert replay(events)["timeline"] == [
        {"kind": "text", "text": "Checking"},
        {"kind": "tool", "call_id": "call_1"},
        {"kind": "text", "text": "Found it"},
    ]


def test_a_turn_failure_takes_its_place_in_the_timeline():
    events = [
        message(0, "Looking that up."),
        error(1, "The assistant could not reach the shop.", retryable=True),
    ]

    assert replay(events)["timeline"] == [
        {"kind": "text", "text": "Looking that up."},
        {
            "kind": "error",
            "message": "The assistant could not reach the shop.",
            "retryable": True,
        },
    ]


def test_an_empty_stream_has_an_empty_timeline():
    assert replay([])["timeline"] == []
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_agent_events.py -q --no-header -k timeline`

Expected: FAIL with `KeyError: 'timeline'`.

- [ ] **Step 3: Add `timeline` to `replay()`**

In `agent/events.py`, inside `replay()`, add three locals beside the existing `pending`:

```python
    pending = ""
    # The ordered view. text/tools/errors are three parallel lists and so
    # cannot say what came before what, which is all a transcript is.
    timeline: list[dict[str, Any]] = []
    # Index of the text item still being written, or None.
    open_text: int | None = None
    # call_ids already placed. One call can emit approval_required,
    # tool_started AND tool_completed, and it is one thing on screen.
    charted: set[str] = set()
```

Replace the `message_delta` and `message` branches with:

```python
        if type_ == "message_delta":
            pending += data["text"]
            if open_text is None:
                timeline.append({"kind": "text", "text": ""})
                open_text = len(timeline) - 1
            timeline[open_text]["text"] += data["text"]

        elif type_ == "message":
            # The message wins. Its text is redacted over the whole answer
            # and may legitimately differ from the sum of the fragments;
            # when it does, the redacted one is what the customer keeps.
            text.append(data["text"])
            pending = ""
            if open_text is not None:
                # In place, so the answer keeps its position relative to
                # tool calls that came after it.
                timeline[open_text]["text"] = data["text"]
                open_text = None
            else:
                timeline.append({"kind": "text", "text": data["text"]})
```

In the `tool_started` / `approval_required` branch, add these as its first statements (before the existing `call_id = data["call_id"]` line, or immediately after it — either is fine as long as they run before the branch returns):

```python
            open_text = None
            if data["call_id"] not in charted:
                charted.add(data["call_id"])
                timeline.append({"kind": "tool", "call_id": data["call_id"]})
```

Add exactly the same three-plus-one lines as the first statements of the `tool_completed` branch:

```python
            open_text = None
            if data["call_id"] not in charted:
                charted.add(data["call_id"])
                timeline.append({"kind": "tool", "call_id": data["call_id"]})
```

In the `error` branch, add after `failures.append(data)`:

```python
            open_text = None
            timeline.append({"kind": "error", **data})
```

And add `timeline` to the returned dict:

```python
    return {
        "text": text,
        "tools": [tools[call_id] for call_id in order],
        "errors": failures,
        "gaps": [seq for seq in expected if seq not in set(seen)],
        "timeline": timeline,
    }
```

Finally extend the module docstring's summary line:

```python
Six types, one envelope, versioned from the first commit because Phase
3's interrupt payload consumes it too. replay() returns both the three
parallel lists callers already use and an ordered `timeline`, which is
what a chat transcript is rendered from.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_agent_events.py -q --no-header -k timeline`

Expected: PASS, 8 tests.

- [ ] **Step 5: Run the whole file and watch the golden fixture fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_agent_events.py -q --no-header`

Expected: exactly one failure — `test_the_golden_stream_replays_to_the_conversation_it_documents`, because `expected` has no `timeline`. **This is the contract working.** Do not weaken the assertion; update the fixture.

- [ ] **Step 6: Add `timeline` to the golden fixture**

In `contracts/assistant-events.v1.json`, replace the `"gaps": []` line inside `expected` with:

```json
    "gaps": [],
    "timeline": [
      {"kind": "tool", "call_id": "call_1"},
      {"kind": "text", "text": "Your most recent order is ORD-1042, still pending."},
      {"kind": "tool", "call_id": "call_2"},
      {"kind": "tool", "call_id": "call_3"},
      {"kind": "tool", "call_id": "call_4"},
      {"kind": "error", "message": "The assistant could not reach the shop.", "retryable": true},
      {"kind": "text", "text": "Anything else I can help with?"}
    ]
```

- [ ] **Step 7: Run the full agent suite**

Run: `.venv/Scripts/python.exe -m pytest -q --no-header`

Expected: all pass.

- [ ] **Step 8: Mutation-check the ordering rules**

Make each change below, run `.venv/Scripts/python.exe -m pytest tests/test_agent_events.py -q --no-header`, confirm it FAILS, then revert it. A mutation that survives means a rule is untested — but first check the mutation is not a no-op, because a badly built mutation looks exactly like a weak test.

1. Delete `open_text = None` from the `tool_started` branch → expect `test_a_tool_closes_an_open_run_of_fragments` to fail.
2. Change the in-place finalisation to `timeline.append({"kind": "text", "text": data["text"]})` while still clearing `open_text` → expect `test_the_finished_message_replaces_the_fragments_in_place` to fail.
3. Drop the `charted` guard so every tool event pushes an item → expect `test_a_tool_appears_on_the_timeline_once_however_many_events_it_has` to fail.
4. Embed the tool instead of naming it: push `{"kind": "tool", **data}` → expect `test_the_timeline_names_a_tool_rather_than_embedding_it` and the golden-fixture test to fail.

- [ ] **Step 9: Document `timeline` in the contract**

In `contracts/README.md`, add this section immediately before `## Rules a consumer must honour`:

```markdown
## The ordered view

`replay()` also returns `timeline`: the same conversation, in the order it
happened. The three parallel lists cannot express that, and a chat transcript
is nothing but ordering — without it a UI renders every question, then every
tool chip, then every answer, which looks right for one exchange and is wrong
for two.

    {"kind": "text",  "text": "Your most recent order is ORD-1042."}
    {"kind": "tool",  "call_id": "call_1"}
    {"kind": "error", "message": "...", "retryable": true}

A tool is **named, not embedded.** Its state changes after it first appears, so
an embedded snapshot would be captured as "working" and stay that way; the
timeline says where it sits and `tools` says what became of it.

One call is one item. A high-risk call emits `approval_required`, then
`tool_started`, then `tool_completed` under a single `call_id`, and that is one
thing on screen.

A `message` **replaces its fragments in place** rather than appending, so an
answer keeps its position relative to tool calls that followed it.
```

Then change the `agent/events.py` row of the "Two implementations exist" table to read: `The Python emitter and the reference replay() reducer, including the ordered timeline.`

- [ ] **Step 10: Commit**

```bash
git add agent/events.py tests/test_agent_events.py contracts/assistant-events.v1.json contracts/README.md
git commit -m "feat: an ordered timeline in the event reducer

replay() returned three parallel lists -- text, tools, errors -- and so
discarded the order events arrived in. A chat panel built from those
renders every question, then every tool chip, then every answer, which
looks correct for a single exchange and is plainly wrong for two.

timeline is additive and follows the message_delta procedure: the golden
fixture gains it, and both repositories go red until both are updated.

A tool is named rather than embedded, because its state changes after it
first appears and a snapshot would read 'working' forever. One call is one
item, however many events it emits. A finished message replaces its
fragments IN PLACE, so an answer keeps its position relative to tool calls
that came after it.

Mutation-tested: 4 mutations across the ordering rules, all caught.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: `timeline` in the TypeScript reducer

**Files:**
- Modify: `mcp-ecom-web-app/apps/web/lib/assistant/events.ts`
- Modify: `mcp-ecom-web-app/apps/web/lib/assistant/assistant-events.v1.json` (re-vendor, do not hand-edit)
- Test: `mcp-ecom-web-app/apps/web/tests/unit/assistant-events.test.ts`

All commands run from `mcp-ecom-web-app/apps/web/`.

- [ ] **Step 1: Re-vendor the golden fixture**

```bash
cp ../../../mcp-ecom-agent-layer/contracts/assistant-events.v1.json lib/assistant/assistant-events.v1.json
```

The suite asserts these two files are byte-identical when both repos are checked out, so copy — never hand-edit.

- [ ] **Step 2: Write the failing tests**

Append to `tests/unit/assistant-events.test.ts`:

```typescript
describe('replay ordering', () => {
  const msg = (seq: number, text: string) =>
    ({ v: 1, seq, type: 'message', data: { text } }) as any;
  const delta = (text: string) =>
    ({ v: 1, seq: OUT_OF_BAND, type: 'message_delta', data: { text } }) as any;
  const started = (seq: number, callId: string) =>
    ({
      v: 1,
      seq,
      type: 'tool_started',
      data: { call_id: callId, tool: 'get_orders', arguments: {} },
    }) as any;

  it('keeps prose and tools in the order they happened', () => {
    // The bug this exists for: three parallel lists cannot say what came
    // before what, so the panel grouped all questions, then all chips,
    // then all answers.
    const events = [
      msg(0, 'Let me look.'),
      started(1, 'c1'),
      msg(2, 'You ordered ORD-1.'),
    ];

    expect(replay(events).timeline).toEqual([
      { kind: 'text', text: 'Let me look.' },
      { kind: 'tool', call_id: 'c1' },
      { kind: 'text', text: 'You ordered ORD-1.' },
    ]);
  });

  it('lists one call once, however many events it emits', () => {
    const events = [
      {
        v: 1,
        seq: 0,
        type: 'approval_required',
        data: { call_id: 'c1', tool: 'cancel_order', arguments: {} },
      },
      started(1, 'c1'),
      {
        v: 1,
        seq: 2,
        type: 'tool_completed',
        data: { call_id: 'c1', tool: 'cancel_order', ok: true, result: {} },
      },
    ] as any;

    expect(replay(events).timeline).toEqual([{ kind: 'tool', call_id: 'c1' }]);
  });

  it('names a tool rather than embedding it', () => {
    // A tool's state changes after it appears. An embedded snapshot would
    // be captured as "working" and stay that way forever.
    const events = [
      started(0, 'c1'),
      {
        v: 1,
        seq: 1,
        type: 'tool_completed',
        data: { call_id: 'c1', tool: 'get_orders', ok: true, result: [] },
      },
    ] as any;

    const conversation = replay(events);

    expect(conversation.timeline).toEqual([{ kind: 'tool', call_id: 'c1' }]);
    expect(conversation.tools[0].ok).toBe(true);
  });

  it('finalises a run of fragments in place, keeping its position', () => {
    const events = [
      delta('Visit https://evil.example.com/x'),
      started(0, 'c1'),
      msg(1, 'Visit [link removed]'),
    ];

    expect(replay(events).timeline).toEqual([
      { kind: 'text', text: 'Visit https://evil.example.com/x' },
      { kind: 'tool', call_id: 'c1' },
      { kind: 'text', text: 'Visit [link removed]' },
    ]);
  });

  it('closes an open run of fragments when a tool intervenes', () => {
    const events = [delta('Checking'), started(0, 'c1'), delta('Found it')];

    expect(replay(events).timeline).toEqual([
      { kind: 'text', text: 'Checking' },
      { kind: 'tool', call_id: 'c1' },
      { kind: 'text', text: 'Found it' },
    ]);
  });

  it('gives a turn failure its place in the order', () => {
    const events = [
      msg(0, 'Looking that up.'),
      {
        v: 1,
        seq: 1,
        type: 'error',
        data: { message: 'Could not reach the shop.', retryable: true },
      },
    ] as any;

    expect(replay(events).timeline).toEqual([
      { kind: 'text', text: 'Looking that up.' },
      { kind: 'error', message: 'Could not reach the shop.', retryable: true },
    ]);
  });

  it('has an empty timeline for an empty stream', () => {
    expect(replay([]).timeline).toEqual([]);
  });
});
```

Also update the existing `survives an empty stream` test, which deep-equals the whole conversation:

```typescript
  it('survives an empty stream', () => {
    expect(replay([])).toEqual({
      text: [],
      tools: [],
      errors: [],
      gaps: [],
      timeline: [],
    });
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx jest --selectProjects unit tests/unit/assistant-events.test.ts`

Expected: FAIL — `timeline` is `undefined`, and the golden-fixture equality test fails because the re-vendored `expected` now carries a `timeline` the reducer does not produce.

- [ ] **Step 4: Mirror the reducer**

In `lib/assistant/events.ts`, add the item type above the `Conversation` interface:

```typescript
/**
 * One entry in the ordered view of a conversation.
 *
 * A tool is NAMED, not embedded. Its state changes after it first appears,
 * so an embedded snapshot would be captured as "working" and stay that way
 * forever; `timeline` says where it sits and `tools` says what became of it.
 */
export type TimelineItem =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; call_id: string }
  | ({ kind: 'error' } & Record<string, unknown>);
```

Add the field to `Conversation`:

```typescript
export interface Conversation {
  text: string[];
  tools: ToolActivity[];
  errors: Record<string, unknown>[];
  gaps: number[];
  /** The same conversation, in the order it happened. */
  timeline: TimelineItem[];
}
```

Inside `replay()`, beside `let pending = '';`:

```typescript
  let pending = '';
  // The ordered view. text/tools/errors are three parallel lists and so
  // cannot say what came before what, which is all a transcript is.
  const timeline: TimelineItem[] = [];
  // Index of the text item still being written, or null.
  let openText: number | null = null;
  // call_ids already placed. One call can emit approval_required,
  // tool_started AND tool_completed, and it is one thing on screen.
  const charted = new Set<string>();

  const chart = (callId: string) => {
    openText = null;
    if (charted.has(callId)) return;
    charted.add(callId);
    timeline.push({ kind: 'tool', call_id: callId });
  };
```

Replace the `message_delta` branch body:

```typescript
    if (event.type === 'message_delta') {
      pending += data.text;
      if (openText === null) {
        timeline.push({ kind: 'text', text: '' });
        openText = timeline.length - 1;
      }
      (timeline[openText] as { kind: 'text'; text: string }).text += data.text;
      continue;
    }
```

Replace the `message` branch body:

```typescript
    if (event.type === 'message') {
      text.push(data.text);
      pending = '';
      if (openText === null) {
        timeline.push({ kind: 'text', text: data.text });
      } else {
        // In place, so the answer keeps its position relative to tool
        // calls that came after it.
        (timeline[openText] as { kind: 'text'; text: string }).text = data.text;
        openText = null;
      }
      continue;
    }
```

Add `chart(callId);` as the first statement after `const callId = data.call_id as string;` in **both** the `tool_started`/`approval_required` branch and the `tool_completed` branch.

Replace the `error` branch body:

```typescript
    if (event.type === 'error') {
      errors.push(data);
      openText = null;
      timeline.push({ kind: 'error', ...data });
      continue;
    }
```

And the return:

```typescript
  return {
    text,
    tools: order.map((callId) => tools.get(callId)!),
    errors,
    gaps,
    timeline,
  };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest --selectProjects unit tests/unit/assistant-events.test.ts` then `npx tsc --noEmit`

Expected: all unit tests pass; typecheck clean.

- [ ] **Step 6: Mutation-check, mirroring Task 1**

Apply each, confirm the suite FAILS, revert:

1. Remove `openText = null;` from `chart` → `closes an open run of fragments when a tool intervenes` fails.
2. Replace the in-place finalisation with `timeline.push({ kind: 'text', text: data.text })` → `finalises a run of fragments in place` fails.
3. Remove the `charted.has(callId)` early return → `lists one call once` fails.
4. Push `{ kind: 'tool', ...data }` instead of the id alone → `names a tool rather than embedding it` and the golden-fixture test fail.

- [ ] **Step 7: Commit**

```bash
git add lib/assistant/events.ts lib/assistant/assistant-events.v1.json tests/unit/assistant-events.test.ts
git commit -m "feat: mirror the ordered timeline in the TypeScript reducer

The other half of the contract change. Both replays now reach the same
ordered conversation from the same golden stream, re-vendored byte for
byte from the agent repository.

Mutation-tested: 4 mutations, all caught.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: group events by turn in the provider

Ordering within a turn is not enough. The provider holds one flat `events` array and a separate list of utterances, so nothing says which reply answered which question. Grouping events under their turn supplies that — and it is the shape Phase 2 persists as `ConversationTurn`.

**Files:**
- Modify: `mcp-ecom-web-app/apps/web/components/assistant/assistant-provider.tsx`
- Test: `mcp-ecom-web-app/apps/web/tests/unit/assistant-provider.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/assistant-provider.test.tsx`:

```typescript
describe('turns own their events', () => {
  function TranscriptProbe() {
    const { transcript, send, status } = useAssistant();

    return (
      <div>
        <button onClick={() => send('first question')}>ask-one</button>
        <button onClick={() => send('second question')}>ask-two</button>
        <span data-testid="status">{status}</span>
        <span data-testid="shape">
          {transcript
            .map(
              (entry) =>
                `${entry.utterance}=>${entry.conversation.timeline
                  .map((item) =>
                    item.kind === 'text' ? item.text : `[${item.kind}]`
                  )
                  .join(',')}`
            )
            .join(' | ')}
        </span>
      </div>
    );
  }

  function renderTranscript() {
    return render(
      <AssistantProvider>
        <TranscriptProbe />
      </AssistantProvider>
    );
  }

  it('files each reply under the question that caused it', async () => {
    // THE BUG. With one flat event array nothing says which answer belongs
    // to which question, so a two-turn conversation cannot be rendered in
    // order however carefully the reducer sorts a single turn.
    const first =
      'event: assistant\ndata: {"v":1,"seq":0,"type":"message","data":{"text":"answer one"}}\n\n';
    const second =
      'event: assistant\ndata: {"v":1,"seq":0,"type":"message","data":{"text":"answer two"}}\n\n';

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(streamOf(first))
      .mockResolvedValueOnce(streamOf(second));

    renderTranscript();

    await act(async () => {
      screen.getByText('ask-one').click();
    });
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('idle')
    );

    await act(async () => {
      screen.getByText('ask-two').click();
    });
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('idle')
    );

    expect(screen.getByTestId('shape')).toHaveTextContent(
      'first question=>answer one | second question=>answer two'
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest --selectProjects unit tests/unit/assistant-provider.test.tsx`

Expected: FAIL — `transcript` is undefined, so `.map` throws.

- [ ] **Step 3: Change the provider**

In `components/assistant/assistant-provider.tsx`, replace the `Turn` interface and add a transcript entry type:

```typescript
export interface Turn {
  utterance: string;
  /**
   * The events this turn produced.
   *
   * GROUPED, not flat. A single array for the whole conversation cannot
   * say which reply answered which question, so a two-turn transcript
   * cannot be ordered however well the reducer sorts one turn. This is
   * also the shape a persisted ConversationTurn takes.
   */
  events: AssistantEvent[];
}

export interface TranscriptEntry {
  utterance: string;
  conversation: Conversation;
}
```

Add to `AssistantContextValue`:

```typescript
  /** What the panel renders: one entry per turn, in order. */
  transcript: TranscriptEntry[];
```

Delete `const [events, setEvents] = useState<AssistantEvent[]>([]);`.

In `send()`, replace the turn append with:

```typescript
    setTurns((previous) => [...previous, { utterance: asked, events: [] }]);
```

and replace the event append with one that files the event under the current turn:

```typescript
          const event = parseEvent(raw);
          if (event) {
            received += 1;
            setTurns((previous) => {
              if (previous.length === 0) return previous;
              const next = [...previous];
              const last = next.length - 1;
              next[last] = {
                ...next[last],
                events: [...next[last].events, event],
              };
              return next;
            });
          }
```

Replace the derived values just above the context value:

```typescript
  // Derived, so `turns` stays the single source of truth. `events` is kept
  // flat for callers that want the raw stream and for the gap report.
  const events = useMemo(() => turns.flatMap((turn) => turn.events), [turns]);

  // What the panel renders. replay() remains the ONLY reducer -- run once
  // per turn now rather than once per conversation.
  const transcript = useMemo(
    () =>
      turns.map((turn) => ({
        utterance: turn.utterance,
        conversation: replay(turn.events),
      })),
    [turns]
  );

  const conversation = useMemo(() => replay(events), [events]);
```

Add `transcript` to the context value object and to its dependency array. Ensure `Conversation` is imported as a type from `@/lib/assistant/events`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest --selectProjects unit` then `npx tsc --noEmit`

Expected: all pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add components/assistant/assistant-provider.tsx tests/unit/assistant-provider.test.tsx
git commit -m "refactor: turns own their events

A flat event array for the whole conversation cannot say which reply
answered which question, so a two-turn transcript could not be ordered
however well the reducer sorted a single turn. Events are now grouped
under the turn that produced them, and transcript is one replay() per
turn -- keeping replay() the only reducer, which is the property the
event contract exists for.

This is also the shape Phase 2 persists as ConversationTurn, so the
grouping is not scaffolding.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: render the transcript chronologically

**Files:**
- Modify: `mcp-ecom-web-app/apps/web/components/assistant/tool-activity.tsx`
- Modify: `mcp-ecom-web-app/apps/web/components/assistant/assistant-widget.tsx`
- Test: `mcp-ecom-web-app/apps/web/tests/unit/assistant-widget.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('AssistantWidget', ...)` in `tests/unit/assistant-widget.test.tsx`:

```typescript
  it('reads as a conversation: question, answer, question, answer', async () => {
    // THE BUG THIS TEST EXISTS FOR. The panel rendered every utterance,
    // then every tool chip, then every assistant message -- grouped by
    // kind rather than by when. One exchange looked perfect, which is why
    // no screenshot caught it; two exchanges came out as Q1 Q2 A1 A2.
    //
    // Asserted on DOM ORDER, because that is the whole feature. Asserting
    // that all four strings are present would pass on the broken version.
    const answer = (text: string) =>
      `event: assistant\ndata: ${JSON.stringify({
        v: 1,
        seq: 0,
        type: 'message',
        data: { text },
      })}\n\n`;

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(streamOf(answer('Your last order was ORD-1.')))
      .mockResolvedValueOnce(streamOf(answer('It ships on Friday.')));

    const { container } = renderWidget();
    await open();

    await ask('what did I order?');
    await waitFor(() => expect(screen.getByText(/ORD-1\./)).toBeInTheDocument());

    await ask('when does it ship?');
    await waitFor(() =>
      expect(screen.getByText(/ships on Friday/)).toBeInTheDocument()
    );

    const shown = [...container.querySelectorAll('p')]
      .map((node) => node.textContent ?? '')
      .filter((line) =>
        /what did I order|ORD-1\.|when does it ship|ships on Friday/.test(line)
      );

    expect(shown).toEqual([
      'what did I order?',
      'Your last order was ORD-1.',
      'when does it ship?',
      'It ships on Friday.',
    ]);
  });

  it('puts the customer on the right and the assistant on the left', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        streamOf(event(0, 'message', { text: 'You ordered ORD-1.' }))
      );

    renderWidget();
    await open();
    await ask('what did I order?');
    await waitFor(() =>
      expect(screen.getByText(/You ordered ORD-1\./)).toBeInTheDocument()
    );

    // self-end is what pushes a bubble to the right in a flex column.
    expect(screen.getByText('what did I order?').className).toContain('self-end');
    expect(
      screen.getByText(/You ordered ORD-1\./).closest('div')!.className
    ).toContain('self-start');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest --selectProjects unit tests/unit/assistant-widget.test.tsx`

Expected: FAIL. The order test receives `['what did I order?', 'when does it ship?', 'Your last order was ORD-1.', 'It ships on Friday.']` — the bug, stated plainly.

- [ ] **Step 3: Export a single-chip renderer**

In `components/assistant/tool-activity.tsx`, extract the `<li>` body into an exported component and keep the list in terms of it:

```typescript
export function ToolActivityChip({ activity }: { activity: Activity }) {
  // A call waiting on a human is not a status chip; it is a decision. The
  // card renders from a fresh server-side lookup of what the action
  // affects -- never from these arguments, and never from agent prose.
  if (activity.awaiting_approval) {
    return <ApprovalCard callId={activity.call_id} tool={activity.tool} />;
  }

  const shown = state(activity);

  return (
    <div className={`rounded border px-2 py-1 text-xs ${shown.className}`}>
      <span className="font-medium">{label(activity.tool)}</span>
      <span> - {shown.text}</span>
      {activity.ok === false && activity.error ? (
        // The storefront's own message, passed through every layer
        // verbatim: it carries the number that IS available.
        <span className="mt-0.5 block break-words opacity-80">
          {activity.error}
        </span>
      ) : null}
    </div>
  );
}

export function ToolActivityList({ tools }: { tools: Activity[] }) {
  if (tools.length === 0) return null;

  return (
    <ul className="flex flex-col gap-1" aria-label="Assistant activity">
      {tools.map((activity) => (
        <li key={activity.call_id}>
          <ToolActivityChip activity={activity} />
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Render the transcript in the widget**

In `components/assistant/assistant-widget.tsx`, change the import and the hook call:

```typescript
import { ToolActivityChip } from './tool-activity';
```

```typescript
  const { transcript, status, send } = useAssistant();
```

Replace everything from the empty-state paragraph up to (but not including) the `{busy ? ...}` line with:

```tsx
        {transcript.length === 0 ? (
          <p className="text-slate-500">
            Ask about your orders, or find something in the shop.
          </p>
        ) : null}

        {/*
          ONE BLOCK PER TURN, in order: the customer's message, then what
          the assistant did about it. The panel used to render every
          utterance, then every tool chip, then every message -- grouped by
          kind rather than by when, which reads correctly for exactly one
          exchange and wrongly for two.
        */}
        {transcript.map((entry, turnIndex) => (
          <div key={turnIndex} className="flex flex-col gap-2">
            <p className="max-w-[85%] self-end rounded-2xl bg-slate-900 px-3 py-2 text-white">
              {entry.utterance}
            </p>

            {entry.conversation.timeline.map((item, itemIndex) => {
              if (item.kind === 'text') {
                return (
                  <div
                    key={itemIndex}
                    className="max-w-[85%] self-start rounded-2xl bg-slate-100 px-3 py-2"
                  >
                    <AssistantText text={item.text} />
                  </div>
                );
              }

              if (item.kind === 'tool') {
                const activity = entry.conversation.tools.find(
                  (candidate) => candidate.call_id === item.call_id
                );
                // The timeline names a tool; `tools` says what became of
                // it. A timeline entry with no matching activity would
                // mean the reducer disagreed with itself.
                return activity ? (
                  <div key={itemIndex} className="max-w-[85%] self-start">
                    <ToolActivityChip activity={activity} />
                  </div>
                ) : null;
              }

              return (
                <p
                  key={itemIndex}
                  role="alert"
                  className="max-w-[85%] self-start text-rose-700"
                >
                  {String(item.message ?? 'The assistant could not finish that.')}
                </p>
              );
            })}
          </div>
        ))}

        {status === 'error' ? (
          <p role="alert" className="text-rose-700">
            Something went wrong reaching the assistant. Try again.
          </p>
        ) : null}
```

Note what this removes: the standalone `<ToolActivityList>`, the `conversation.text.map`, and the `conversation.errors.map`. Each is now rendered inside its own turn, which is the point.

- [ ] **Step 5: Run to verify it passes**

Run: `npx jest --selectProjects unit` then `npx tsc --noEmit`

Expected: all pass. If `shows a turn that failed midway rather than falling silent` fails, it is because a turn `error` now renders inside its turn block rather than at the panel root — confirm the assertion still finds the text and the `role="alert"`, and keep both.

- [ ] **Step 6: Check accessibility did not regress**

Run: `npx jest --selectProjects a11y`

Expected: PASS. If the suite objects to the nesting, wrap the transcript in `<ol className="flex flex-col gap-3">` with each turn as an `<li>` — honest markup for an ordered conversation anyway.

- [ ] **Step 7: Verify the production build**

Run: `npx next build`

Expected: `✓ Compiled successfully`.

- [ ] **Step 8: Commit**

```bash
git add components/assistant/tool-activity.tsx components/assistant/assistant-widget.tsx tests/unit/assistant-widget.test.tsx
git commit -m "feat: the panel reads as a conversation

Question on the right, then that question's answer and tool activity on
the left, then the next question. The panel used to render every
utterance, then every tool chip, then every assistant message -- grouped
by kind rather than by when. With one exchange that looks perfect, which
is why no screenshot caught it; with two it came out as Q1 Q2 A1 A2.

The new test asserts DOM ORDER rather than presence, because presence
passes on the broken version too.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: verify live and record

- [ ] **Step 1: Push both repositories**

```bash
cd ../../../mcp-ecom-agent-layer && git push && cd ../mcp-ecom-web-app && git push
```

- [ ] **Step 2: Confirm the deploys landed**

Check the agent's `/health` reports the new commit SHA, and that the `web` service's latest deployment reads SUCCESS. A 200 proves *a* container is up, not that it is *this* one — a mistake already made twice on this project.

Run: `curl -s https://agent-production-79c8.up.railway.app/health`

Expected: `{"ok":true,"sha":"<the new short SHA>","model":"gpt-4.1"}`

- [ ] **Step 3: Exercise two turns in the real panel**

Signed in, after a hard refresh, ask two questions in one chat — for example "what did I order recently", then "how much was the first one". Confirm the transcript reads question, answer, question, answer, and that each question's tool chip sits under that question rather than in a block of its own.

- [ ] **Step 4: Record the outcome**

Append a dated entry to `docs/PLAN_M4_STOREFRONT.txt` noting that the ordered `timeline` was added to the frozen contract additively, that the provider now groups events by turn, and that this grouping is the shape Phase 2 persists.

- [ ] **Step 5: Commit the record**

```bash
git add docs/PLAN_M4_STOREFRONT.txt
git commit -m "docs: record the chronological transcript, verified live

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage.** This plan covers only Phase 1 of `2026-09-03-chat-persistence-roadmap.md`. Phases 2–6 (storage, history UI, titles, memory, summarisation) each get their own plan; the roadmap records their scope and MUST PROVEs so nothing is lost.
- **Type consistency.** `TimelineItem` kinds (`text` / `tool` / `error`), the `call_id` field name, `Turn.events`, `TranscriptEntry.utterance` and `TranscriptEntry.conversation` are used identically in Tasks 2, 3 and 4. The Python dict keys match the TypeScript field names exactly, which is what lets one golden fixture check both.
- **Deliberately not done here.** `text`, `tools` and `errors` stay on `Conversation` even though the timeline supersedes `text` for rendering. Removing them would churn tests unrelated to this change; they remain the flat view and `gaps` still needs the whole-conversation replay.
