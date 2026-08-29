# Open Questions & Risks

Consolidated across all three phases. Each item names the phase that has to
close it, so nothing sits in a general "risks" bucket that no milestone
owns.

## Must close before this is more than a demo

**Prompt injection via tool output — unmitigated.**
`Review.content`, `Review.title`, and product descriptions are
attacker-controllable free text entering agent context through low-risk
tools. Server-side risk enforcement closes the *execution* path only; it
does not stop exfiltration through low-risk tools, and it does not stop a
deceptively-worded approval prompt.
→ Flagged in Phase 1 §1.6. Partially addressed in Phase 2 by rendering
approval prompts from structured tool arguments rather than agent prose,
but that is a mitigation for one attack, not a design pass.
**Owner: needs a design pass before Phase 2 ships.**

**Auth hardening, rate limiting, and observability.**
The whole plan is scoped as a demo/POC. Revisit all three before any
production commitment.

Two specifics already known:

- API rate limiting is **per-instance and in-process**. One replica today,
  so the budgets mean what they say; scale past one and the effective
  allowance multiplies by the replica count.
- Session JWTs are stateless and have **no revocation**. Rotating
  `NEXTAUTH_SECRET` is the only way to invalidate an issued token, and it
  signs out every browser at the same time. Any token handed to an agent is
  live until it expires.

## Blocking design work for Phase 1

These are gaps in the source plan, not implementation details. They need
answers before the phase starts, not during it.

- **Who mints the approval token?** The source plan asserted server-side
  risk enforcement but never specified the mechanism. Must be minted by
  non-LLM code, bound to `(session_id, tool_name, canonical_args_hash,
  nonce, expiry)`, single-use, and validated against the actual arguments
  of the incoming call — presence-checking alone lets an agent get approval
  for one order and spend the token on another.
- **Idempotency keys** on `add_to_cart` and `cancel_order`, so a retry after
  a timeout does not double-apply.
- **MCP transport must be HTTP/SSE with per-request auth, not stdio.** A
  stdio transport carries one ambient identity per process, which is wrong
  for a multi-user chat app.

## Open decisions

**`remove_from_cart` has no assigned risk tier.**
`DELETE /api/v1/cart` exists and the source plan assigns the tool to the
Cart agent, but the tool never appeared in the capability map. Medium is
proposed by symmetry with `add_to_cart`; no source document settled it.
→ Confirm in Phase 1. See [tool-surface.md](tool-surface.md).

**Is the Supervisor short-circuit in scope for Phase 3?**
Letting the Supervisor answer trivial single-domain queries without a
specialist round-trip conflicts with the exit criterion "the same workflows
pass again". Decide explicitly; if it is in scope, amend the exit criteria
to expect divergence on single-domain lookups.
→ Phase 3 §3.6.

**Nested-subgraph `interrupt()` propagation — unconfirmed.**
Never verified against current LangGraph docs. Moot only while `interrupt()`
is called exclusively from the Supervisor. If that placement changes, spike
it first.
→ Phase 3 §3.7.

## Closed

**~~No eval harness for tool selection.~~**
Now a required task in Phase 2, with workflow pass rate as a scorecard gate
rather than a manual demo run.

## Carried in from the web app

Not caused by this layer, but they shape what it can rely on.

- **The test suite does not exercise a database.** The integration tests
  mock Prisma wholesale. The real verification gates have been live
  end-to-end checks against the deployed instance, and Phase 1 should keep
  that habit rather than trusting a green suite.
- **Coverage has no stable denominator.** An unrelated import fix once made
  two more files loadable under Jest, grew the denominator by 111, and
  dropped the percentage without a single line losing coverage. This is why
  the scorecard records absolute covered/total alongside percentages.
- **Nothing in the storefront UI calls `cancel_order`'s backing action.**
  The API route is its only caller, so the behaviour has never been
  exercised by a person — worth knowing when it becomes the High-risk
  showcase capability.
- **`sort=price` is always descending.** Ascending is unreachable through
  the object-form call. Not fixed; relevant if an agent is expected to
  answer "cheapest first".
- **83 npm advisories, 4 critical**, inherited upstream.
