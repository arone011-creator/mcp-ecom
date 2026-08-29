# Phase 2 — Single Agent

**Milestone M4. Not yet broken into tasks.** Write its plan after Phase 1
ships.

**Goal:** prove the tool contracts and the agentic UX patterns work, before
adding the complexity of multi-agent orchestration. One agent, full
toolbox, connected to the Phase 1 MCP server.

## 2.1 Why single agent first

Multi-agent orchestration is deferred to Phase 3 **on purpose**. Building
it first would confound two unknowns at once — *do my tools and workflows
work*, and *does my orchestration layer work*. A single agent isolates the
first question.

This phase is a legitimate, demoable product on its own even if Phase 3
never happened.

## 2.2 UX capabilities to build

1. **Natural-language intent recognition** — understand the ask before
   executing anything.
2. **Ask for missing info only when necessary**, and prefer structured
   choices over free-text prompts. "Which order?" with selectable cards,
   not "please provide your order ID".
3. **Show the agent's plan** for multi-step requests, updating it live as
   steps complete. Visibility without exposing raw chain-of-thought.
4. **Human approval gating**, driven by the risk tiers — see
   [tool-surface.md](tool-surface.md) and §2.3.
5. **Rich responses** — product cards, order cards, not just prose.
6. **Workflow progress indicators** for longer flows, including failure
   states with explicit recovery options (Retry / Choose another date /
   Cancel).
7. **Persistent, visible context** — the agent remembers "the second order"
   without the user repeating an order ID, and the current context
   (customer, order, action) is *shown*, not silently inferred.

### Token refresh — required, decided during M3

M3 gave `POST /api/v1/auth/token` a `ttlSeconds` parameter and the MCP
server asks for fifteen minutes, because a token handed to an agent cannot
be revoked: the JWTs are stateless, and rotating `NEXTAUTH_SECRET` signs
out every browser at once. A short lifetime is the only lever there is.

That leaves a gap this phase has to close. A conversation outlives fifteen
minutes, and the MCP server never sees the user's password, so it cannot
mint a replacement itself. **Phase 2 builds a refresh mechanism** rather
than raising the floor — the chat UI holds the browser session and can
exchange it for a fresh short-lived token whenever the current one nears
expiry.

Raising the TTL instead was considered and rejected: it trades a bounded,
solvable problem for a permanently larger blast radius on a credential
that has no kill switch.

## 2.3 Risk tier → agent behaviour

| Tier | Behaviour |
|---|---|
| Low | Auto-execute, no confirmation needed. |
| Medium | Execute, but surface it as an informational event ("Added to cart") — not a blocking prompt. |
| High | Block and require explicit confirmation before calling the tool, with a concrete action button. |

The server enforces this too. The agent's behaviour is the UX; the MCP
server's rejection is the boundary. See
[phase-1-mcp-layer.md](phase-1-mcp-layer.md) §1.5.

### Render approval prompts from structured tool arguments, never agent prose

Currently unmitigated and required here. Product descriptions and review
text are attacker-controllable free text flowing into agent context. **The
gate is only as trustworthy as the text beside the button.** If the agent
writes the confirmation copy, an injected review can write it too.

## 2.4 Agent events streaming

The chat UI consumes structured events, not raw text:

```
tool_started    tool_completed    approval_required
```

This is the plumbing that later becomes the `interrupt()` payload in Phase
3 — designing it now avoids rework.

**Freeze the event schema as a versioned contract before building the UI.**
The UI, this phase, and Phase 3's interrupt payload all depend on it, and
it is the cheapest thing to get wrong.

## 2.5 Workflows to validate end-to-end

1. **"What did I order recently?"** — single tool call.
2. **"Cancel my most recent order."** — `get_orders` → `get_order` →
   confirm → `cancel_order`. *(Replaces the source plan's returns workflow,
   which has no backend.)*
3. **"Find me headphones under $200 with a 4+ rating and add the best one
   to my cart."** — `search_products` (using the `minRating` filter added
   in M2) → `check_inventory` → recommend → approval → `add_to_cart`.
4. **Showcase:** *"Find running shoes under $150 rated above 4.3, show me
   your best option, and don't add anything to my cart until I approve."* —
   planning, multiple tools, constraints, state, recommendation, and human
   approval in a single ask.

## The eval harness — a required task in this phase

Workflow pass rate cannot be a scorecard metric without one, and this also
closes the "no eval harness for tool selection" risk carried since the
source plan.

Build `evals/workflows/*.yaml` holding the four workflows as fixtures —
user utterance, expected tool call sequence, expected approval interrupts —
plus a runner that executes each N times against the live agent and reports
pass rate, tool-selection accuracy, turn latency, and tokens consumed.

**Run each workflow at least 5 times per eval.** A single green run of a
non-deterministic system is not evidence.

## Scorecard

Wire the harness output into the scorecard as an `agent` section: workflow
pass rate (absolute gate: 100%), tool-selection accuracy, p50/p95 turn
latency per workflow, tokens per workflow. Capture as `m4-single-agent`.

## Exit criteria

- All four workflows complete correctly through a single agent.
- Approval gating behaves per the risk tiers.
- The chat UI is driven by structured agent events rather than parsed text.
- `npm run scorecard -- m4-single-agent --gate` exits 0.

The workflow-1 latency and token figures in that entry become the explicit
budget Phase 3 is measured against.
