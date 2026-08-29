# MCP & Agentic Layer

Everything about the MCP server and the agents that sit on top of it. The
storefront and its REST API are documented elsewhere — this folder starts
where `/api/v1` ends.

## Where the code will live

The MCP server lives in its own repository, not in this one:

- **[arone011-creator/mcp-ecom-agent-layer](https://github.com/arone011-creator/mcp-ecom-agent-layer)**
  — Python 3.11 + FastMCP. Phase 1 shipped; Phase 2 and 3 will be built
  there too.
- This repository — the Next.js storefront and `/api/v1`, in `apps/web/`.

It was built here first, as `apps/mcp/`, and split out at the end of M3
when it became a second deployable. The split is a deliberate boundary:
the agent layer depends on the storefront's public API and nothing else,
so a change here that the API contract survives cannot break it.

**The documents in this folder stay here.** They are the design record for
both repositories — the phase plans, the capability map, and the reasoning
behind decisions the code can only show the result of. See
[../DOCS_INDEX.md](../DOCS_INDEX.md) for the layout of this repository.

## The three phases

The build is sequenced so each phase is a working, demoable checkpoint on
its own, and so that failures are attributable. Building the agent and the
tools at once would confound two unknowns: *do my tools work* and *does my
orchestration work*.

| Phase | Doc | What it delivers | Status |
|---|---|---|---|
| 1 | [phase-1-mcp-layer.md](phase-1-mcp-layer.md) | MCP server. Every tool callable from a bare MCP client. No agent exists. | **Shipped** — see below |
| 2 | [phase-2-single-agent.md](phase-2-single-agent.md) | One agent, full toolbox, structured-event chat UI, approval gating. | Not started |
| 3 | [phase-3-multi-agent.md](phase-3-multi-agent.md) | Refactor into a LangGraph Supervisor + domain specialists. | Not started |

Phase 1 shipped on 2026-08-29. All nine tools are live and callable from a
bare MCP client, and the high-risk refusal is enforced in production. Two
exit criteria are **partially** met, and the gap is deliberate rather than
overlooked:

- Six of the nine tools are verified against mocks but not against
  production. They need a signed-in customer and no demo credentials were
  supplied for the sweep. The three public tools are verified end to end.
- `cancel_order`'s *refusal* path is verified live — with no token, and
  with a forged one. Its *success* path, cancelling a real order behind a
  real approval, is verified only against mocks.

Closing both is one sweep run with credentials:
`python scripts/sweep.py --url ... --api ... --email ... --password ...`

Two references cut across all three:

- **[tool-surface.md](tool-surface.md)** — the capability map and risk
  tiers. Phase 1 builds it, Phase 2 gates on it, Phase 3 splits the agents
  along it. Canonical: where the source documents disagreed, this file is
  the resolution.
- **[open-questions.md](open-questions.md)** — risks carried across phases,
  including the ones that must be closed before this is more than a demo.

Plus [appendix-a-agent-patterns.md](appendix-a-agent-patterns.md), a
multi-agent pattern reference to re-read when Phase 3 is actually being
built, and a reality check on what multi-agent does and does not buy.

## Phase numbers vs. milestone numbers

The delivery plan numbers milestones `M0`–`M5` across the whole project;
this folder numbers phases `1`–`3` across the agentic layer only. They are
the same work:

| Milestone | Phase | |
|---|---|---|
| M0 – M2 | — | Storefront, deploy, and the `/api/v1` REST API. **Shipped.** |
| M3 | Phase 1 | MCP server |
| M4 | Phase 2 | Single agent |
| M5 | Phase 3 | Supervisor + specialists |

Each phase doc names its milestone at the top. When a scorecard entry says
`m3-mcp`, that is Phase 1.

## Provenance, and why these documents exist

The plan for this layer was written before the storefront was deployed and
before `/api/v1` existed, so parts of it describe capabilities the backend
turned out not to have. It was then partially revised inside a 3,590-line
delivery plan, which left the current answer split across two documents
that disagreed with each other in several places.

These phase docs are the merge. They carry the source plan's reasoning
forward intact and fold in every revision made against the real repository,
marking each change and the reason for it. Where the two sources conflicted,
the phase docs say so explicitly rather than silently picking one.

- **Source of record:** [source/implementation-plan-v2.txt](source/implementation-plan-v2.txt),
  kept verbatim. It is the original brainstorm output, superseded by the
  phase docs but preserved so any claim here can be traced back.
- **Delivery plan:** [../superpowers/plans/2026-08-27-mcp-ecom-deployment-and-agent-layer.md](../superpowers/plans/2026-08-27-mcp-ecom-deployment-and-agent-layer.md)
  — task-level detail for M0–M2, and the revisions to M3–M5 that these docs
  absorb.

One habit is worth carrying into Phase 1, because it has already paid for
itself twice. M2 found three places where the delivery plan's own fixtures
contradicted the real code — a wrong return shape, a filter that paginated
before filtering, and a cart route that replaced quantities where the
storefront increments. All three were caught by reading the actual function
signature before writing against it. Phase 1's plan should be written the
same way: against the real `/api/v1` responses, not against this folder's
description of them.
