# Appendix A — Multi-Agent Pattern Reference

Read this when [Phase 3](phase-3-multi-agent.md) is actually being built —
both to confirm the pattern we picked still fits once real implementation
details are in hand, and as a menu if a specific workflow later needs a
different pattern layered in locally.

## A.1 The patterns, and our verdict on each

| Pattern | What it is | Verdict for this project |
|---|---|---|
| **Supervisor / orchestrator-worker** (hierarchical) | One agent owns the conversation and routes to specialists; specialists report back, never talk to each other. | **SELECTED.** Fits distinct domains (product / cart / order) and gives exactly one place to enforce approval gating. |
| **Pipeline / sequential** | Fixed-order chain, each agent's output feeds the next, like an assembly line. | Not used. Our workflows branch on user intent, not a fixed order. |
| **Parallel fan-out / fan-in** | Independent subtasks dispatched at once, results merged. | Candidate for use *inside* a specialist later — e.g. the Product agent checking price, rating and delivery concurrently. Not at the Supervisor level, since our specialists are sequentially dependent. |
| **Debate / actor-critic** (adversarial) | One agent proposes, a second refutes or red-teams it; a judge may decide. | Not needed. Our ground truth is the backend API, not LLM judgment. Revisit only if an agent starts making judgment calls with no API to check against. |
| **Planner-executor split** | One agent decomposes a goal into steps; a separate agent executes each against tools. | Not used now, but the natural next refinement if the Supervisor prompt gets overloaded doing both planning and approval duty. |
| **Blackboard / shared-state** | Agents read and write a shared workspace; no fixed handoff order, whichever agent's trigger fires acts next. | Deliberately avoided — trades away the single choke-point control we need for approvals. |
| **Group chat / conversational** (AutoGen-style) | Agents converse in a shared thread and self-organise who speaks next. | Ruled out — hard to guarantee specialists won't bypass the Supervisor and talk directly to each other. |
| **Redundancy / voting** | Multiple agents or runs attempt the same task; majority vote or a judge picks the best answer. | Not needed for deterministic tool calls — an order either exists or it doesn't. Could harden genuinely ambiguous judgment calls later ("is this the best product match"). |

## A.2 Pattern-to-use-case cheat sheet

For future features beyond this POC, or if this architecture gets reused
elsewhere:

| Use case | Pattern |
|---|---|
| Transactional, customer-facing apps *(this project)* | Supervisor + specialists, human-in-the-loop gates |
| Research / synthesis | Parallel fan-out feeding a synthesis agent |
| Code review, high-stakes decision support | Debate / adversarial, optionally plus voting |
| Creative ideation, open strategy exploration | Group chat, or a judge panel over N independent attempts |
| Ops / monitoring at scale | Blackboard / event-driven — agents react to changing state rather than following a scripted conversation |

## A.3 Cross-cutting principles

Apply regardless of which pattern is chosen.

- **Keep each agent's scope narrow** rather than capable-at-everything.
  This is what the Phase 3 specialist boundaries are for.
- **Prefer structured, typed handoffs over free-form chat.** Specialists
  return proposed actions and results, not prose, to the Supervisor.
- **Put approval authority at exactly one point in the graph.** Never
  duplicate enforcement across agents.
- **Make individual agent steps idempotent** where possible, so retries and
  `interrupt()` pauses are safe. This is the same rule as Phase 3 §3.4's
  "no side effects before the interrupt line".
- **Instrument per-agent observability.** You need to see which agent did
  what when a multi-agent chain misbehaves. Ties to the Phase 2 event
  design.
- **Budget for cost and latency.** More agents means more LLM hops. Don't
  route trivial single-domain queries through a full round trip if it can
  be short-circuited.
- **Don't add an agent per tool.** Split only where there is a real domain
  or reasoning boundary, or the coordination overhead buys nothing.

## A.4 Reality check: multi-agent is not a reliability lever

Worth keeping in view while building Phase 3, so the refactor doesn't get
credited with something it isn't responsible for.

Claude Code — arguably the most reliable agentic system in this space — is
**single-agent by default**: a simple while-loop (call model, run tool,
repeat), with sub-agent delegation used selectively for parallelisable or
context-heavy work, not as the default architecture.

Its accuracy comes from four things unrelated to agent count:

- **Agentic search** — grep, glob, read the real file, just in time —
  instead of pre-indexing or RAG. It reads ground truth rather than a
  retrieved approximation of it.
- **Tools that are self-contained, error-robust, and unambiguous**, in a
  minimal non-overlapping set. Same principle as Phase 1's rule:
  business-level tools, not raw endpoints.
- **Context compaction plus structured external memory**, so long sessions
  don't degrade from an ever-growing transcript.
- **Sub-agents, when used, return a condensed summary** to the coordinator,
  not their full transcript. Same principle as Phase 3 §3.5's
  context-passing discipline.

A hard permission system sits on top as a *separate safety layer* from the
reasoning loop — mirroring our own split between "the agent decides" and
"the system enforces".

### Conclusion for this project

Phase 3's move to multi-agent is justified for domain clarity,
testability, and the vendor-flexible orchestration story — **not because it
will make the agent more accurate.**

Accuracy is earned in Phase 1 (tight, unambiguous tools) and Phase 2
(context and approval discipline), before Phase 3 ever starts. If Phase 3
is rushed while Phases 1 and 2 are still shaky, splitting into multiple
agents will not fix that. It will distribute the same unreliability across
more moving parts.
