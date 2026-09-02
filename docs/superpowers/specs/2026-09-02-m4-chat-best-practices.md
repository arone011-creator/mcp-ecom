# M4 Chat Best Practices — Design

Formalizes a brainstorming conversation into concrete amendments to the two
existing M4 plans (`PLAN_M4_STOREFRONT.txt`, `PLAN_M4_AGENT.txt`). No new
code — both plans are already explicit that step-level work waits for the
framework choice and real components to exist. This spec only changes what
those plans require, at the same task-level altitude they already use.

## Decisions

**D1 — The assistant is a persistent, globally-mounted widget, not a page.**
Both plans currently assume `app/(store)/assistant/page.tsx`: a dedicated
route. Changed to: a floating entry point available on every page, backed
by a single provider mounted once in `app/layout.tsx` holding the
conversation and its streaming connection — so closing the widget hides it
without tearing down the conversation, and navigating between pages doesn't
reset it. This is a real architecture shift from the current plan, not a
cosmetic one: the streaming connection and message history move from
page-scoped state to root-scoped state.

**D2 — Chat-driven changes update the same data the rest of the site
reads, never a private copy.** A `tool_completed` event for a cart or
order change must invalidate the same cache/query the manually-clicked
cart page and header badge already read from. Two disconnected sources of
truth for "what's in your cart" is worse than a stale one.

**D3 — The assistant never navigates, filters, or touches auth on its
own.** It can show a link to a product; it doesn't route the customer
there itself. Extends the existing "approval card renders from structured
arguments, never agent prose" principle to a general rule about what the
UI is allowed to do without an explicit click.

**D4 — High-risk actions never render optimistically, anywhere.** Task 5
already requires the approval card itself to be backed by a fresh lookup.
Extending it: no UI surface (order list, badge, chat) shows an order as
cancelled until the server confirms it actually happened. Low/Medium tool
results may still update immediately — that distinction is intentional,
matching the existing risk tiers.

**D5 — Eval-time tool-selection anomaly scoring, runtime detection flagged
as future work.** The eval harness already reports "tool-selection
accuracy." Extending it to explicitly score *unexpected* tool calls beyond
a workflow's fixture — a signal that injected content moved the agent even
when the specifically-guarded tools were never reached. Live/production
anomaly detection is a separate, unscoped design pass, named in the risks
section rather than built now — it doesn't fit this milestone's size.

**D6 — A concrete per-conversation cost ceiling, decided before launch,
not discovered from a bill.** `PLAN_M4_AGENT.txt` already says to measure
tokens per workflow. Measuring isn't the same as having a limit. Added as
a fourth "decision that must be made first": pick an actual number, and
decide the behavior at that ceiling (a graceful handoff message, not
silent truncation or an unbounded loop) in advance.

## Out of scope

- Any step-level implementation — the framework choice (LangGraph vs. the
  Agent SDK's tool runner vs. a manual loop) is still an open probe task in
  `PLAN_M4_AGENT.txt` Task 0, and nothing here resolves it.
- Building the anomaly-detection system itself (D5) — only naming it as a
  flagged future risk and extending the eval report.
- Picking the actual cost-ceiling number (D6) — that's a product decision
  for whoever owns the budget when M4 starts, not something to hardcode
  into a plan doc now.

## Division of labor

Both files are pure documentation edits, in the same repo
(`mcp-ecom-web-app` for `PLAN_M4_STOREFRONT.txt`;
`mcp-ecom-agent-layer` for `PLAN_M4_AGENT.txt`).
