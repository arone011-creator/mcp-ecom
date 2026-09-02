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

## Opened by Phase 1

**The spent-nonce set is in process.**
Approval tokens are single-use, enforced by a dictionary in the MCP
server's memory. That holds for one replica. Scale the service out and a
token becomes replayable within its TTL, because the second instance has
never seen the nonce. The five-minute lifetime is what bounds the exposure.
A shared store — Redis, or the database — is required before this runs on
more than one instance.
**Owner: before the mcp service scales past one replica.**

**Six of the nine tools are unverified against production.**
They need a signed-in customer, and the M3 sweep ran without credentials.
They pass against mocks, and this project has now had three separate bugs
that only a live call exposed — a green mock suite is not the same claim.
The same gap covers `cancel_order`'s success path: its refusal is verified
live, its approval-and-cancel is not.
→ Closes with one sweep run: `python scripts/sweep.py --url ... --api ...
--email ... --password ...`

## Closed by Phase 1

**~~Railway's private network is incompatible with the HTTPS-upgrade
middleware.~~**
Fixed: the middleware now treats `x-forwarded-proto`'s total absence, not a
Host value, as the signal that traffic arrived over the private network —
Railway's public edge always sets the header to something, so its complete
absence is not spoofable by a public caller the way a Host header would be.
`web.railway.internal` calls no longer 301 to an unreachable https address.
The MCP server's configured API base URL has not yet been switched from the
public domain to take advantage of it.

**~~Who mints the approval token?~~**
`POST /approvals` on the MCP server, deliberately **not** an MCP tool, so
an agent cannot approve itself. HMAC-signed over `(session, tool,
args_hash, nonce, expiry)`, single-use, validated against the arguments of
the call actually arriving. The session id is the transport's own
`mcp-session-id`, assigned by the server at initialize rather than
supplied by the caller. Verified by mutation: replacing the binding with a
presence check fails four tests, including the one that spends an approval
for order o3 on order o7.

**~~Idempotency keys.~~**
An `idempotency_keys` table with claim-then-execute semantics. The claim
row is taken before the work runs, so two concurrent duplicates race for a
unique constraint rather than both executing. A 5xx releases the claim — it
is not an outcome, and storing it would make every retry replay the error.
`add_to_cart` and `cancel_order` carry keys; `remove_from_cart` does not,
because it is already idempotent.

**~~MCP transport must be HTTP with per-request auth, not stdio.~~**
Streamable HTTP. One `EcommerceApi` per request, never cached — a client
held between requests is an ambient identity by another name.

## Open decisions

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

**~~`remove_from_cart` has no assigned risk tier.~~**
Medium, settled during M3. Reversible, and the API scopes its delete to the
caller's own cart id. See [tool-surface.md](tool-surface.md).

**~~Token lifetime.~~**
`POST /api/v1/auth/token` now accepts `ttlSeconds`, clamped to [60s, 7d].
The MCP path asks for fifteen minutes. This does not add revocation — it
only shortens the window — and it creates a Phase 2 obligation: a
conversation outlives fifteen minutes and the MCP server never sees a
password, so **Phase 2 builds token refresh** driven by the browser
session the chat UI already holds.

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
