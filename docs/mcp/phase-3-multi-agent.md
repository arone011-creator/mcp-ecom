# Phase 3 — Supervisor + Specialists

**Milestone M5. Not yet broken into tasks.** Write its plan after Phase 2
ships.

**Goal:** refactor the single agent into a Supervisor plus domain
specialists, **without changing the MCP layer or the workflows proven in
Phase 2**.

## 3.1 Why domain specialists

Splitting along the boundary the MCP folder structure already has
(`products.py`, `orders.py`, `cart.py`) keeps each agent's prompt small and
focused, makes each one testable in isolation, and gives a stronger
engineering story than one agent with a growing toolbox.

**Three specialists, not four.** The source plan's Returns agent has no
backend to talk to.

## 3.2 Architecture

```
                      USER
                        |
                        v
                 +-------------+
                 | SUPERVISOR  |  <- owns the conversation, routes work,
                 |   AGENT     |     and is the ONLY place that gates
                 +------+------+     approvals
                        |
        +---------------+---------------+
        v               v               v
   +---------+     +---------+     +---------+
   | PRODUCT |     |  CART   |     |  ORDER  |
   |  AGENT  |     |  AGENT  |     |  AGENT  |
   +---------+     +---------+     +---------+
   search_          get_cart        get_orders
   products         add_to_cart     get_order
   get_product      remove_         cancel_order
   check_             from_cart
     inventory
```

**Rules:**

- Specialists **never talk to each other directly**. Every hop goes through
  the Supervisor.
- Specialists **propose** actions (tool name + args); they do not execute
  medium or high-risk tools themselves. Execution authority above "low
  risk" sits only with the Supervisor.

That second rule keeps exactly one enforcement choke point instead of
three, and it sidesteps needing `interrupt()` to propagate correctly
through nested specialist subgraphs — see §3.7.

## 3.3 Framework: LangGraph

Chosen over CrewAI, AutoGen, the OpenAI Agents SDK, the Claude Agent SDK,
and hand-rolling, because:

- It has a documented, first-class **supervisor** multi-agent pattern
  matching the topology above.
- Its `interrupt()` / `Command(resume=...)` primitive solves
  pause-for-approval natively rather than requiring it to be hand-built.
- It streams node and tool-level events natively, matching the Phase 2
  event design.
- It has an official MCP adapter for scoping tools per agent.
- **It is not tied to one model provider.** This was the deciding factor.

The Claude Agent SDK is a strong technical fit — native MCP, and a
`canUseTool` callback that maps very precisely onto the risk-tier gate —
but it is Claude-only. Given that avoiding vendor lock-in is the priority,
LangGraph wins on that axis despite a steeper learning curve and a less
precise fit for the exact gate mechanic.

**Trade-off accepted:** a real learning curve if the team has not used
LangGraph. The graph/state-machine mental model takes time.

**And it only holds if prompts and tool schemas stay in config** rather
than being tuned implicitly to one model's quirks. A provider swap should
be "change one config block", not "rewrite three agents".

## 3.4 Interrupt / approval strategy

`interrupt()` is a general "pause the graph and ask the human something"
primitive — not just an approval mechanism. It unifies four things that
were previously described separately:

- missing-info prompts
- disambiguation ("which of two Nike orders?")
- high-risk approval
- failure recovery (Retry / Choose another date / Cancel)

All four become the same code path with a different payload shape.

**Placement:** the `interrupt()` call lives inside the **Supervisor**, never
inside a specialist. A specialist returns a proposed action; the Supervisor
checks it against the risk tier and either executes it (low), executes and
informs (medium), or calls `interrupt(payload)` and blocks (high).

### Mechanics to respect

- **Requires a checkpointer.** This is what makes pause/resume possible at
  all.
- **On resume via `Command(resume=<value>)`, any code in that node *before*
  the `interrupt()` call re-runs.** Earlier nodes do not. Keep everything
  before the interrupt line side-effect-free — reads and re-derivable
  checks only. No non-idempotent calls (counters, pre-auths) above that
  line.
- **Thread ID = the conversation/session ID.** This also gives persistent
  context (Phase 2, §2.2 point 7) for free: checkpointed state holds full
  history and survives a resume days later.
- **There is no built-in timeout.** LangGraph will leave a thread paused
  indefinitely if a user abandons an approval. Add an app-level expiry
  policy — "this action expired, please ask again".

## 3.5 Context-passing discipline

The Supervisor decides what slice of context each specialist actually
needs. The Order agent needs a user id and the order in question, not the
last 20 messages about laptop shopping.

Passing full history to every specialist call is **the main way this
architecture quietly becomes slow and expensive.** Treat it as a design
constraint, not an afterthought.

## 3.6 Trade-offs to watch

- **Latency and cost.** Trivial queries ("what's my order status") now cost
  at least two LLM hops — Supervisor to Order agent and back — instead of
  one. Acceptable for the showcase workflow, wasteful for simple lookups.
  Consider letting the Supervisor short-circuit simple single-domain
  queries without a full specialist round-trip.

  **Open decision:** short-circuiting conflicts with "the same workflows
  pass again". Decide explicitly whether it is in scope; if it is, amend the
  exit criteria to expect divergence on single-domain lookups.

## 3.7 Open validation item

Whether `interrupt()` called from inside a nested specialist subgraph
correctly propagates to and resumes at the top-level thread **was never
confirmed** against current LangGraph docs.

The §3.2/§3.4 design — `interrupt()` only ever called from the Supervisor —
sidesteps needing this to be true. It stays moot only while that placement
holds. **If the placement changes, spike this first.**

## Scorecard — this is the milestone the scorecard exists for

Multi-agent **will** regress latency and token cost on workflow 1: two LLM
hops replacing one. The gate does not let that pass silently. Either the
Supervisor short-circuit brings it back inside the Phase 2 budget, or
`latency./workflow-1` and `tokens./workflow-1` go into
`acceptedRegressions` with a written justification.

The source plan called this "wasteful for simple lookups" and left it as
something to consider. Here it becomes a number someone has to sign off on.

**Reuse the Phase 2 eval harness unchanged** — same fixtures, same runner,
different graph behind it. That is what makes the comparison meaningful.

Capture as `m5-multi-agent`.

## Exit criteria

- All four Phase 2 workflows pass again through Supervisor + specialists,
  with identical approval behaviour.
- Plus one **new** workflow requiring two specialists in sequence — Order
  agent identifies the order, Cart agent acts on it — to prove the handoff
  pattern itself.
- `npm run scorecard -- m5-multi-agent --gate` exits 0, either clean or with
  explicitly accepted and justified latency/token regressions.

---

Before building this phase, read
[appendix-a-agent-patterns.md](appendix-a-agent-patterns.md) — both to
confirm the supervisor pattern still fits once real implementation details
are in hand, and for its closing argument on what multi-agent does *not*
buy you.
