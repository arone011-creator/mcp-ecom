# M4 Chat Best Practices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Amend `PLAN_M4_STOREFRONT.txt` and `PLAN_M4_AGENT.txt` to reflect the six decisions in `docs/superpowers/specs/2026-09-02-m4-chat-best-practices.md`, at the same task-level altitude both documents already use — no step-level code, since the framework choice and the widget's real components don't exist yet.

**Architecture:** Pure documentation edits, precise find/replace, same discipline as the prompt-injection design pass's plan amendments. Two repos: `mcp-ecom-web-app` (storefront plan) and `mcp-ecom-agent-layer` (agent plan).

**Tech Stack:** N/A — text edits only.

**Spec:** `docs/superpowers/specs/2026-09-02-m4-chat-best-practices.md`

**Repos touched:**
- `mcp-ecom-web-app` (this repo) — Tasks 1-3
- `mcp-ecom-agent-layer` (sibling repo, `../mcp-ecom-agent-layer`) — Task 4

**Executed 2026-09-02. Three deviations from the text below, all to keep
the edited documents internally consistent:**

1. *Task 1, Step 1* — the replacement text as written would have produced
   two adjacent `IN PLAIN TERMS` blocks. The document's actual style is one
   per section, at the end; decisions (A)-(C) carry none of their own. So
   Decision (D) got no separate block, and a sentence about it was folded
   into the existing section-level one instead.
2. *Task 1* — `§2`'s plain-terms line still read "A chat page", which the
   file-list edit had just made self-contradictory. Changed to "A chat
   window available from every page". The plan missed it.
3. *Task 3, Step 2* — the grep found one more stale reference the plan did
   not anticipate: the task-list plain-terms summary also said "a chat
   page". Changed to "a chat window".

---

## File Structure

| File | Repo | Change |
|---|---|---|
| `docs/PLAN_M4_STOREFRONT.txt` | web-app | §1 new decision (D), §2 file list, §3 two new rules, Task 4/5/6, §5 exit criteria |
| `docs/PLAN_M4_AGENT.txt` | agent-layer | §1 new decision (D), §5 eval reporting, §7 new risk + count |

---

### Task 1: `PLAN_M4_STOREFRONT.txt` — §1 decision, §2 file list

**Files:**
- Modify: `docs/PLAN_M4_STOREFRONT.txt`

- [x] **Step 1: Add Decision (D) — where the conversation lives**

Find:
```
    IN PLAIN TERMS
    Three things to decide before building. The most important: the AI
    must not be able to approve its own actions. A human clicks the
    button, and the shop - not the AI - issues the permission slip. If the
    AI could issue its own, the whole safety design would be decoration.
```

Replace with:
```
(D) WHERE DOES THE CONVERSATION LIVE, AND HOW DOES IT SURVIVE NAVIGATION?

    The assistant is available from every page, not one dedicated route -
    a floating entry point, not a destination. That means the conversation
    and its streaming connection cannot be owned by a page component; a
    route change would tear both down.

    RECOMMENDED: a single provider mounted once in app/layout.tsx, holding
    the message history and the open connection to /api/assistant. Every
    page renders the same floating widget reading from that provider.
    Closing the widget hides it; it does not unmount the conversation.

    IN PLAIN TERMS
    The chat needs to live "above" any one page, the way the header does,
    so clicking around the site doesn't reset or drop the conversation.

    IN PLAIN TERMS
    Four things to decide before building. The most important: the AI
    must not be able to approve its own actions. A human clicks the
    button, and the shop - not the AI - issues the permission slip. If the
    AI could issue its own, the whole safety design would be decoration.
```

- [x] **Step 2: Change "Three." to "Four." at the top of the section**

Find:
```
Three. Each changes the task breakdown, so settle them before Task 1.
```

Replace with:
```
Four. Each changes the task breakdown, so settle them before Task 1.
```

- [x] **Step 3: Replace the NEW FILES list in §2**

Find:
```
    app/(store)/assistant/page.tsx       The chat page.
    components/assistant/*.tsx           Message list, tool-activity chips,
                                         approval card, product/order cards.
```

Replace with:
```
    components/assistant/AssistantProvider.tsx
                                         Root-level state: the conversation
                                         and the streaming connection,
                                         mounted once in app/layout.tsx so
                                         both survive client-side
                                         navigation.
    components/assistant/AssistantWidget.tsx
                                         The floating entry point and
                                         docked panel - collapsed by
                                         default on every page, not a
                                         route of its own.
    components/assistant/*.tsx           Message list, tool-activity chips,
                                         approval card, product/order cards.
```

- [x] **Step 4: Commit**

```bash
git add docs/PLAN_M4_STOREFRONT.txt
git commit -m "docs: decide where the assistant's conversation state lives

Adds Decision D - a globally-mounted provider in app/layout.tsx,
not a page - and updates the expected file list to match. The
assistant is available from every page, not one dedicated route.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `PLAN_M4_STOREFRONT.txt` — §3 two new rules, Task 4/5/6

**Files:**
- Modify: `docs/PLAN_M4_STOREFRONT.txt`

- [x] **Step 1: Add two new non-negotiable rules to §3**

Find:
```
TWO RULES THAT ARE NOT NEGOTIABLE:

  1. THE APPROVAL CARD IS RENDERED FROM THE STRUCTURED ARGUMENTS, NEVER
     FROM AGENT PROSE. Product descriptions and reviews are written by
     strangers and reach the agent's context. If the agent writes the words
     next to the button, an injected review can write them too. The card
     shows the order number the API returned - not a sentence the model
     composed.

  2. VERSION THE SCHEMA FROM THE FIRST COMMIT. Phase 3 consumes it too.

    IN PLAIN TERMS
    The chat window shows what the AI is doing as it happens. The one
    rule that matters: the confirmation box must be built from real data -
    the actual order number - and never from a sentence the AI wrote. A
    review written by a stranger could otherwise put misleading words next
    to the confirm button.
```

Replace with:
```
FOUR RULES THAT ARE NOT NEGOTIABLE:

  1. THE APPROVAL CARD IS RENDERED FROM THE STRUCTURED ARGUMENTS, NEVER
     FROM AGENT PROSE. Product descriptions and reviews are written by
     strangers and reach the agent's context. If the agent writes the words
     next to the button, an injected review can write them too. The card
     shows the order number the API returned - not a sentence the model
     composed.

  2. VERSION THE SCHEMA FROM THE FIRST COMMIT. Phase 3 consumes it too.

  3. CHAT-DRIVEN CHANGES UPDATE THE SAME DATA THE REST OF THE SITE READS,
     NOT A PRIVATE COPY. A tool_completed event for a cart or order change
     invalidates the same cache/query the manually-clicked cart page and
     header badge already use. Two copies of "what's in your cart" is a
     worse bug than a stale one - it lies to the customer about which
     answer is real.

  4. THE ASSISTANT NEVER NAVIGATES, FILTERS, OR SIGNS THE CUSTOMER IN OR
     OUT ON ITS OWN. It can show a link to a product; it does not route
     the customer there itself. A page changing underneath a customer
     without them acting is worse than the assistant not doing it at all.

    IN PLAIN TERMS
    The chat window shows what the AI is doing as it happens. The rule
    that matters most: the confirmation box must be built from real data -
    the actual order number - and never from a sentence the AI wrote. A
    review written by a stranger could otherwise put misleading words next
    to the confirm button. The other two rules keep the assistant from
    ever lying about what's really in your cart, or taking you somewhere
    you didn't ask to go.
```

- [x] **Step 2: Rewrite Task 4 for global mounting**

Find:
```
TASK 4 - THE CHAT PAGE, READ-ONLY FIRST
    Render the event stream: messages, and tool activity as it happens. No
    approvals yet.
    MUST PROVE: the three low-risk workflows are usable end to end -
    "what did I order recently", a product search, a stock check. And:
    assistant message text renders as plain text or a tightly restricted
    Markdown subset - no raw HTML, no auto-linkification of arbitrary
    domains, links honoured only to this storefront's own domain. Product
    descriptions already arrive wrapped as untrusted content by the MCP
    server (mcp-ecom-agent-layer, docs/superpowers/specs/
    2026-09-02-prompt-injection-design-pass.md); this task is what keeps a
    rendering bypass from turning that into a clickable phishing link.
```

Replace with:
```
TASK 4 - THE ASSISTANT WIDGET, READ-ONLY FIRST, MOUNTED GLOBALLY
    AssistantProvider in app/layout.tsx; AssistantWidget rendered on every
    page. Render the event stream: messages, and tool activity as it
    happens. No approvals yet.
    MUST PROVE: the three low-risk workflows are usable end to end -
    "what did I order recently", a product search, a stock check. The
    conversation survives a client-side navigation between at least two
    different page types (e.g. home -> a product page) without resetting
    or dropping the connection. And: assistant message text renders as
    plain text or a tightly restricted Markdown subset - no raw HTML, no
    auto-linkification of arbitrary domains, links honoured only to this
    storefront's own domain. Product descriptions already arrive wrapped
    as untrusted content by the MCP server (mcp-ecom-agent-layer,
    docs/superpowers/specs/2026-09-02-prompt-injection-design-pass.md);
    this task is what keeps a rendering bypass from turning that into a
    clickable phishing link.
```

- [x] **Step 3: Add the optimistic-rendering rule to Task 5**

Find:
```
      * the approve route mints for the EXACT arguments in the event, not
        arguments supplied by the caller;
      * a second click does not mint a second approval;
      * declining sends nothing to the MCP server.
```

Replace with:
```
      * the approve route mints for the EXACT arguments in the event, not
        arguments supplied by the caller;
      * a second click does not mint a second approval;
      * declining sends nothing to the MCP server;
      * nothing anywhere shows the action as completed until the server
        confirms it happened - a High-risk action never renders
        optimistically, unlike a Low/Medium tool result, which may.
```

- [x] **Step 4: Add the shared-cache proof to Task 6**

Find:
```
    MUST PROVE: a failed tool call produces a visible failure with a way
    forward, not a stalled spinner.
```

Replace with:
```
    MUST PROVE: a failed tool call produces a visible failure with a way
    forward, not a stalled spinner. And: a cart or order change made
    through the assistant is visible on the actual cart/orders page
    without a manual refresh, because it went through the same data path
    a manual action would (Rule 3, section 3) - never a private copy the
    chat keeps to itself.
```

- [x] **Step 5: Commit**

```bash
git add docs/PLAN_M4_STOREFRONT.txt
git commit -m "docs: add shared-state, no-optimistic-render, and no-drive rules

Two new non-negotiable rules in the event contract (shared cache with
the rest of the site; no chat-driven navigation/filters/auth), plus
matching MUST PROVE additions to Tasks 4, 5, and 6, and the Task 4
rewrite for a globally-mounted widget instead of a dedicated page.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `PLAN_M4_STOREFRONT.txt` — §5 exit criteria, verification

**Files:**
- Modify: `docs/PLAN_M4_STOREFRONT.txt`

- [x] **Step 1: Add two exit criteria**

Find:
```
    * No bearer token is ever exposed to the browser.
    * `npm run scorecard -- m4-single-agent --gate` exits 0.
```

Replace with:
```
    * No bearer token is ever exposed to the browser.
    * The assistant is reachable from every page as a persistent widget,
      not a single dedicated route, and a conversation survives
      client-side navigation.
    * A cart or order change made through the assistant is visible
      everywhere else on the site immediately, through the same data path
      a manual action would use - never a private copy.
    * `npm run scorecard -- m4-single-agent --gate` exits 0.
```

- [x] **Step 2: Verify no stale references to the dedicated page remain**

Run: `grep -n "assistant/page.tsx\|THE CHAT PAGE, READ-ONLY FIRST" docs/PLAN_M4_STOREFRONT.txt`
Expected: no output.

- [x] **Step 3: Commit**

```bash
git add docs/PLAN_M4_STOREFRONT.txt
git commit -m "docs: exit criteria for global availability and shared state

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `PLAN_M4_AGENT.txt` (sibling repo `mcp-ecom-agent-layer`) — cost ceiling, eval reporting, risk

**Files (in `mcp-ecom-agent-layer`, not this repo):**
- Modify: `docs/PLAN_M4_AGENT.txt`

All commands in this task run with `mcp-ecom-agent-layer` as the working directory (`../mcp-ecom-agent-layer` if starting from `mcp-ecom-web-app`).

- [x] **Step 1: Add Decision (D) — the cost ceiling**

Find:
```
    IN PLAIN TERMS
    Three decisions. The critical one: the AI must never be able to give
    itself permission for a dangerous action. A person clicks, the shop
    issues the permission, and the AI only ever receives it.
```

Replace with:
```
(D) DECIDE THE COST CEILING NOW, NOT AFTER THE FIRST BILL.

    Every conversation spends money, and a looping agent spends more.
    Section 3 already requires measuring tokens per workflow from the
    first eval run. Measuring is not the same as having a limit.

    RECOMMENDED: pick a concrete per-conversation token or cost cap before
    launch, and decide the behaviour at that cap in advance - a graceful
    "I need to hand this to a person" message, not a silent truncation or
    an unbounded loop that only shows up on an invoice.

    IN PLAIN TERMS
    Decide the spending limit before the AI goes live, and decide what it
    says when it hits that limit - don't find either one out from a bill.

    IN PLAIN TERMS
    Four decisions. The critical one: the AI must never be able to give
    itself permission for a dangerous action. A person clicks, the shop
    issues the permission, and the AI only ever receives it.
```

- [x] **Step 2: Change "Three options" framing isn't affected — verify the decision count elsewhere**

Run: `grep -n "^(A)\|^(B)\|^(C)\|^(D)" docs/PLAN_M4_AGENT.txt`
Expected: four lines, `(A)` through `(D)`, in order.

- [x] **Step 3: Extend the eval harness's REPORTED line**

Find:
```
    REPORTED       pass rate, tool-selection accuracy, turn latency,
                   tokens consumed
```

Replace with:
```
    REPORTED       pass rate, tool-selection accuracy, turn latency,
                   tokens consumed, and whether an UNEXPECTED tool call
                   happened beyond what the workflow fixture expects - a
                   signal that an injected instruction moved the agent
                   even when the guarded tools themselves were never
                   reached
```

- [x] **Step 4: Add the runtime-anomaly-detection risk to §7**

Find:
```
    * COST IS NOW A LIVE VARIABLE. Every conversation spends money, and an
      agent that loops spends more. Measure tokens per workflow from the
      first eval run, not after the first bill.
```

Replace with:
```
    * COST IS NOW A LIVE VARIABLE. Every conversation spends money, and an
      agent that loops spends more. Measure tokens per workflow from the
      first eval run, not after the first bill. Section 1's Decision D
      sets a ceiling before launch; this is what it protects against.

    * TOOL-SELECTION ANOMALY DETECTION IS EVAL-TIME ONLY, NOT RUNTIME.
      The eval harness (section 5) now scores unexpected tool calls
      against known fixtures. Nothing watches a LIVE conversation's tool
      sequence for the same drift. Flagged, not scoped - worth its own
      design pass if injected content in review or description text turns
      out to be a live problem rather than a theoretical one.
```

- [x] **Step 5: Update the risk count**

Find:
```
    IN PLAIN TERMS
    Four known problems carried into this stage. Two are worth watching
    closely: hidden instructions inside product reviews now have a design
    to follow, but Task 6 has not been built yet, and from this point
    onwards every conversation costs real money - so it is measured from
    day one rather than discovered later.
```

Replace with:
```
    IN PLAIN TERMS
    Five known problems carried into this stage. Two are worth watching
    closely: hidden instructions inside product reviews now have a design
    to follow, but Task 6 has not been built yet, and from this point
    onwards every conversation costs real money - so it is measured from
    day one, capped by Section 1's Decision D, rather than discovered
    later.
```

- [x] **Step 6: Verify no stale counts remain**

Run: `grep -n "Three decisions\|Four known problems" docs/PLAN_M4_AGENT.txt`
Expected: no output.

- [x] **Step 7: Commit**

```bash
git add docs/PLAN_M4_AGENT.txt
git commit -m "docs: add the cost-ceiling decision and eval-time anomaly scoring

Decision D requires a concrete per-conversation cost cap and a
decided stop behavior before launch, rather than 'measure and see'.
The eval harness now also scores unexpected tool calls, and a new
risk item names live tool-selection anomaly detection as flagged but
unscoped future work.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Push both repos

**Files:** none modified.

- [x] **Step 1: Review what's pending in each repo**

In `mcp-ecom-web-app`:
Run: `git log --oneline origin/main..HEAD`
Expected: the commits from Tasks 1-3 above, plus the spec commit already made.

In `mcp-ecom-agent-layer`:
Run: `git log --oneline origin/main..HEAD`
Expected: the one commit from Task 4 above.

- [x] **Step 2: Push, after user confirmation**

```bash
git push origin main
```
Run in both repos.
