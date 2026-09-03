# M4 Storefront Task 4 - The Assistant Widget

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A chat available from every page that shows the agent's work as it happens, survives
navigation, and cannot be turned into a phishing surface by anything the agent says.

**Architecture:** `AssistantProvider` mounted once in `app/layout.tsx` holds the raw event
array and the streaming connection; the conversation is **derived** from it by `replay()`.
`AssistantWidget` renders that derived state. Assistant text is rendered as plain text —
never HTML, never markdown, never linkified.

**Tech Stack:** React client components, Tailwind + the repo's shadcn primitives,
`@testing-library/react`, Jest.

---

## The safety decision, made once, here

The MUST PROVE says assistant text must render "as plain text or a tightly restricted
Markdown subset — no raw HTML, no auto-linkification of arbitrary domains, links honoured
only to this storefront's own domain."

**This takes the plain-text option, and adds no markdown library at all.**

Three reasons, in order of weight:

1. React escapes interpolated text by default. `{text}` cannot become HTML. So "no raw HTML"
   is a property of *not writing* `dangerouslySetInnerHTML`, rather than something a sanitiser
   has to win — and there is a source-level test for it, in the style this repo already uses
   for RSC boundaries.
2. Every markdown renderer worth using linkifies. Adding one imports exactly the risk the
   requirement forbids, then asks a config option to remove it again.
3. There is nothing to render yet. Task 6 brings product and order cards, and those are built
   from **tool results**, not from agent prose — so the rich output arrives through structured
   data, which is the whole point of the event contract.

The agent has been told not to reproduce URLs from untrusted content (agent Task 6), and
strips one if it does. This is the third layer, and the only one that faces the customer: a
URL in assistant text arrives as inert characters. If links are ever wanted, they go through
one component with an allowlist, and this paragraph is what should be re-read first.

## The conversation is derived, never accumulated

The provider stores the array of parsed events. `replay()` turns it into the conversation on
every render.

The tempting alternative — push a message onto a list as each event arrives — quietly creates
a *second* implementation of the reducer, in the UI, untested against the golden stream. Then
the contract that both repositories agree on describes something the screen does not actually
show.

Deriving costs a `replay()` per render over an array that is at most a few dozen items, and
buys the guarantee the whole Task 1 mechanism exists for.

## Navigation survival is structural, not behavioural

`AssistantProvider` is mounted in `app/layout.tsx`, above `{children}`. A client-side route
change re-renders children; the layout — and therefore the provider's state and its open
connection — is untouched. That is a fact about where the component sits, so it is asserted at
source level, the same way `tests/unit/rsc-boundaries.test.ts` already does. The behavioural
half is the live check in 4.5.

## What this task does NOT do

No approvals. `approval_required` arrives, and the widget shows the tool as awaiting a
decision, but there is no button — Task 5 owns that, along with the route that mints. A card
that looked clickable and did nothing would be worse than one that plainly says it is waiting.

---

## File Structure

- **Create** `apps/web/components/assistant/assistant-text.tsx` — the renderer, and the only
  place that decides what agent prose may become.
- **Create** `apps/web/components/assistant/assistant-provider.tsx` — state and the stream.
- **Create** `apps/web/components/assistant/assistant-widget.tsx` — the floating entry point
  and panel.
- **Create** `apps/web/components/assistant/tool-activity.tsx` — the chips.
- **Modify** `apps/web/app/layout.tsx` — mount both, once.
- **Create** `apps/web/tests/unit/assistant-text.test.tsx`,
  `apps/web/tests/unit/assistant-provider.test.tsx`,
  `apps/web/tests/unit/assistant-mounting.test.ts`.

---

### Task 4.1: The renderer

**Files:** Create `components/assistant/assistant-text.tsx`, `tests/unit/assistant-text.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/tests/unit/assistant-text.test.tsx
//
// The last layer between an injected product description and a customer
// clicking something. The agent is told not to reproduce URLs out of
// untrusted content and strips one if it does; this is what holds when
// both of those fail.

import { render, screen } from '@testing-library/react';

import { AssistantText } from '@/components/assistant/assistant-text';

describe('AssistantText', () => {
  it('shows ordinary prose', () => {
    render(<AssistantText text="Your order ORD-1042 is pending." />);

    expect(screen.getByText(/ORD-1042 is pending/)).toBeInTheDocument();
  });

  it('renders HTML as characters, not as markup', () => {
    const { container } = render(
      <AssistantText text={'<img src=x onerror="alert(1)">'} />
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x');
  });

  it('renders a markdown link as characters, not as a link', () => {
    const { container } = render(
      <AssistantText text="[Click here to verify](https://evil.example.com/x)" />
    );

    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('https://evil.example.com/x');
  });

  it('does not linkify a bare URL', () => {
    const { container } = render(
      <AssistantText text="Visit https://evil.example.com now" />
    );

    expect(container.querySelector('a')).toBeNull();
  });

  it('keeps line breaks, because the agent writes lists', () => {
    const { container } = render(<AssistantText text={'one\ntwo'} />);

    expect(container.textContent).toContain('one');
    expect(container.textContent).toContain('two');
    // Preserved by CSS rather than by parsing anything.
    expect(container.firstChild).toHaveClass('whitespace-pre-wrap');
  });

  it('renders nothing for empty text rather than an empty bubble', () => {
    const { container } = render(<AssistantText text="" />);

    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — a function component returning
  `<p className="whitespace-pre-wrap break-words">{text}</p>`, or `null` for blank text. No
  parsing, no library, no `dangerouslySetInnerHTML`. The file's header carries the reasoning
  above, because its simplicity is the point and someone will want to "improve" it.

- [ ] **Step 4: Run to verify it passes. Step 5: Commit.**

---

### Task 4.2: The provider

**Files:** Create `components/assistant/assistant-provider.tsx`,
`tests/unit/assistant-provider.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/tests/unit/assistant-provider.test.tsx
//
// The provider holds the raw event array and derives the conversation
// with replay(). Accumulating messages instead would be a second,
// untested implementation of the reducer -- and then the contract both
// repositories agree on would describe something the screen does not show.

import { act, render, screen, waitFor } from '@testing-library/react';

import {
  AssistantProvider,
  useAssistant,
} from '@/components/assistant/assistant-provider';

function streamOf(wire: string): Response {
  return new Response(wire, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

const ONE_TURN =
  'event: assistant\ndata: {"v":1,"seq":0,"type":"tool_started","data":{"call_id":"c1","tool":"get_orders","arguments":{"limit":3}}}\n\n' +
  'event: assistant\ndata: {"v":1,"seq":1,"type":"tool_completed","data":{"call_id":"c1","tool":"get_orders","ok":true,"result":[]}}\n\n' +
  'event: assistant\ndata: {"v":1,"seq":2,"type":"message","data":{"text":"You ordered ORD-1."}}\n\n';

function Probe() {
  const { conversation, status, send } = useAssistant();

  return (
    <div>
      <button onClick={() => send('what did I order?')}>ask</button>
      <span data-testid="status">{status}</span>
      <span data-testid="text">{conversation.text.join('|')}</span>
      <span data-testid="tools">
        {conversation.tools.map((t) => `${t.tool}:${t.ok}`).join('|')}
      </span>
    </div>
  );
}

function renderProbe() {
  return render(
    <AssistantProvider>
      <Probe />
    </AssistantProvider>
  );
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue(streamOf(ONE_TURN));
});

describe('AssistantProvider', () => {
  it('starts idle with an empty conversation', () => {
    renderProbe();

    expect(screen.getByTestId('status')).toHaveTextContent('idle');
    expect(screen.getByTestId('text')).toHaveTextContent('');
  });

  it('derives the conversation from the events it received', async () => {
    renderProbe();

    await act(async () => {
      screen.getByText('ask').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('text')).toHaveTextContent('You ordered ORD-1.');
    });
    expect(screen.getByTestId('tools')).toHaveTextContent('get_orders:true');
  });

  it('drops a malformed frame and keeps the rest of the stream', async () => {
    // parseEvent returns null rather than throwing, and this is what
    // that decision buys: one bad frame does not cost the conversation.
    global.fetch = jest.fn().mockResolvedValue(
      streamOf(
        'event: assistant\ndata: {"v":99,"seq":0,"type":"message","data":{"text":"nope"}}\n\n' +
          'event: assistant\ndata: {"v":1,"seq":1,"type":"message","data":{"text":"kept"}}\n\n'
      )
    );
    renderProbe();

    await act(async () => {
      screen.getByText('ask').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('text')).toHaveTextContent('kept');
    });
    expect(screen.getByTestId('text')).not.toHaveTextContent('nope');
  });

  it('reports a failed request without losing what came before', async () => {
    renderProbe();
    await act(async () => {
      screen.getByText('ask').click();
    });
    await waitFor(() =>
      expect(screen.getByTestId('text')).toHaveTextContent('ORD-1')
    );

    global.fetch = jest.fn().mockResolvedValue(new Response('', { status: 502 }));
    await act(async () => {
      screen.getByText('ask').click();
    });

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('error')
    );
    // The earlier answer is still on screen. A failure must not wipe the
    // conversation a customer was reading.
    expect(screen.getByTestId('text')).toHaveTextContent('ORD-1');
  });

  it('refuses to send while a turn is already in flight', async () => {
    renderProbe();

    await act(async () => {
      screen.getByText('ask').click();
      screen.getByText('ask').click();
    });

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('idle')
    );
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement.** The provider holds `events: AssistantEvent[]`, `status:
  'idle' | 'streaming' | 'error'`, and the user's own utterances for display. `send()`:

1. refuses if `status === 'streaming'` — one turn at a time, and no way to fire two;
2. POSTs to `/api/assistant`;
3. non-ok → `status = 'error'`, events untouched;
4. reads the body with `SseParser`, `parseEvent`s each `assistant` frame's data, appends
   whatever parses, ignores what does not;
5. `status = 'idle'` when the stream ends.

`conversation` is `useMemo(() => replay(events), [events])`.

- [ ] **Step 4: Run to verify it passes. Step 5: Commit.**

---

### Task 4.3: The widget

**Files:** Create `components/assistant/assistant-widget.tsx`,
`components/assistant/tool-activity.tsx`

- [ ] **Step 1: Write the failing tests** (appended to the provider test file, since the
  widget only renders what the provider derives):

```tsx
describe('AssistantWidget', () => {
  it('is collapsed by default on every page', () => {
    render(
      <AssistantProvider>
        <AssistantWidget />
      </AssistantProvider>
    );

    expect(screen.getByRole('button', { name: /assistant/i })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens and closes without losing the conversation', async () => {
    // Closing hides the panel; it does not unmount the conversation.
    // ... open, ask, close, reopen, assert the answer is still there
  });

  it('shows a tool as running before it finishes', () => {
    // A chip that never resolves is the bug the event contract's
    // "every start gets a completion" rule exists to prevent; this is
    // the half that shows it.
  });

  it('shows a tool awaiting approval as waiting, with no button', () => {
    // Task 5 owns the button. A card that looked clickable and did
    // nothing would be worse than one that says it is waiting.
  });

  it('renders assistant prose through AssistantText', () => {
    // Asserted by behaviour: a markdown link in the message must not
    // become an anchor anywhere in the widget.
  });
});
```

Fill each in fully when writing the file — the shapes above are the intent, not the code.

- [ ] **Step 2-4: Red, implement, green.** The widget is a floating button, fixed
  bottom-right, that toggles a panel: message list (user utterances and `AssistantText` for
  assistant prose), tool chips from `conversation.tools`, an input, and a disabled send while
  streaming. `aria-label` on the launcher, `role="dialog"` on the panel.

- [ ] **Step 5: Commit.**

---

### Task 4.4: Mount it, once

**Files:** Modify `app/layout.tsx`; create `tests/unit/assistant-mounting.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/tests/unit/assistant-mounting.test.ts
//
// Where the provider sits IS the feature: mounted in the root layout, a
// client-side navigation re-renders children and leaves the conversation
// and its open connection alone. Source-level, like rsc-boundaries.test.ts
// -- the behavioural half is the live check in the task's verification.

import { readFileSync } from 'fs';
import { join } from 'path';

const layout = readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf-8');

describe('the assistant is mounted above the page', () => {
  it('wraps children in the root layout', () => {
    expect(layout).toContain('AssistantProvider');
    expect(layout).toContain('AssistantWidget');
  });

  it('mounts the widget outside <main>, so no page owns it', () => {
    const widgetAt = layout.indexOf('<AssistantWidget');
    const mainClosesAt = layout.indexOf('</main>');

    expect(widgetAt).toBeGreaterThan(mainClosesAt);
  });

  it('is not mounted in any page, which would give it a lifetime', () => {
    // A second mount would create a second conversation that resets on
    // navigation -- exactly what mounting it once prevents.
    const { execSync } = require('child_process');
    const hits = execSync(
      'git grep -l "AssistantProvider" -- app components || true',
      { encoding: 'utf-8' }
    )
      .split('\n')
      .filter(Boolean);

    expect(hits.sort()).toEqual([
      'app/layout.tsx',
      'components/assistant/assistant-provider.tsx',
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Mount** `<AssistantProvider>` inside `<CartProvider>` and
  `<AssistantWidget />` after `</main>`, alongside `<Toaster />`. Inside `CartProvider`
  deliberately: Rule 3 of section 3 requires a chat-driven cart change to invalidate the same
  data the header badge reads, and Task 6 will need that access.

- [ ] **Step 4: Run the whole suite and `npx tsc --noEmit`. Step 5: Commit.**

---

### Task 4.5: Verify live

- [ ] **Step 1: The three low-risk workflows**, signed in, through the real widget:
  "what did I order recently", a product search, a stock check.

- [ ] **Step 2: Navigation survival.** Ask something, navigate home → a product page via
  client-side links, and confirm the conversation is still there and the widget still works.

- [ ] **Step 3: The rendering restriction, end to end.** Not reproducible through the live
  shop — no product description contains an injection — so it is proved at the unit level in
  4.1 and re-checked here only in the weaker sense that ordinary answers render as expected.
  Say so plainly rather than claiming more.

- [ ] **Step 4: Record** in `PLAN_M4_STOREFRONT.txt`.

---

## Self-Review

**Spec coverage.** The three workflows and navigation survival are 4.5; the rendering
restriction is 4.1 plus the structural no-`dangerouslySetInnerHTML` guard; "no approvals yet"
is stated in scope and tested as "waiting, with no button".

**Placeholders.** 4.3's tests are sketched rather than written in full, which is a real
weakness of this plan and is flagged rather than hidden: the widget's markup does not exist
yet, and test bodies written against imagined DOM would need rewriting anyway. Every other
task's tests are complete.

**Type consistency.** `useAssistant()` returns `{ conversation, status, send, events }`, used
identically in the probe, the widget, and its tests. `Conversation` is the type
`lib/assistant/events.ts` already exports.

**One thing deferred deliberately.** Rule 3 — a chat-driven cart change refreshing the same
data the header badge reads — is not wired here, because no cart-changing tool is reachable
from the widget until Task 6 renders results. The provider is mounted inside `CartProvider`
so that it can be, without moving anything.
