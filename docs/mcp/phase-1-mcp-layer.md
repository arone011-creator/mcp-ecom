# Phase 1 — MCP Layer

**Milestone M3. Not yet broken into tasks.**

> Write the task-level plan before starting, against the *actual*
> `/api/v1/*` response shapes rather than any document's description of
> them. M2 found three places where a plan's own fixtures contradicted the
> real code; all three were caught by reading the signature first.

**Goal:** prove the AI-access layer works, independent of any agent.

## 1.1 Core principle

```
MCP Server -> API Client -> Existing Backend API
NOT: MCP Server -> Database directly.
```

Business logic — "is this return allowed?", "can this order still be
cancelled?" — stays in the existing backend. MCP never re-implements it.
The MCP server is an adapter, and the value of an adapter is that there is
exactly one implementation of the rule.

## 1.2 Capability mapping

Do this before writing any MCP code. The map is maintained separately
because all three phases depend on it: **[tool-surface.md](tool-surface.md)**.

## 1.3 Server structure

Python 3.11 + FastMCP + httpx + Pydantic, deployed as a second Railway
service in the same project, calling `web` over the private network.

```
apps/mcp/
├── server.py
├── tools/
│   ├── products.py
│   ├── orders.py
│   └── cart.py
├── clients/
│   └── ecommerce_api.py
└── models/
    └── schemas.py
```

Each `tools/*.py` file becomes the tool surface for one Phase 3 specialist
(`products.py` → Product agent, and so on). This folder boundary is
intentional and is reused, not coincidental.

*(The source plan called this directory `mcp-server/`. It is `apps/mcp/`
now, to sit beside `apps/web/` under the repository's service layout.)*

## 1.4 Identity & auth

The MCP server derives the authenticated user from the session token. **It
never trusts a `user_id` supplied by the LLM.**

`get_orders()` resolves to `get_orders(authenticated_user=user_123)`
server-side, not via an LLM-provided argument. This is the same rule the
web app already enforces: `/api/v1` refuses a request whose identity it
cannot establish itself, and its order routes filter by the *verified*
user, never by a caller-supplied id.

`/api/v1` accepts either a bearer token or a session cookie, and an
explicit bearer token wins over an ambient cookie. The MCP server uses the
bearer path.

## 1.5 Server-side risk enforcement

The original plan treated the risk tiers as a convention the agent was
expected to respect. **That is not a security boundary.** An agent that is
prompt-injected — for example via malicious text embedded in a product
review returned by a tool — could otherwise talk itself past an approval
step.

**Medium and high-risk tools are enforced at the MCP server.** A high-risk
tool call arriving without a valid approval token fails, or returns
`confirmation_required`, regardless of what the agent intended.

### Blocking design work — the approval token

The source plan asserted server-side enforcement but never said who mints
the token. Specify this before the phase starts:

- Minted by **non-LLM code**.
- Bound to `(session_id, tool_name, canonical_args_hash, nonce, expiry)`.
- **Single-use.**
- Validated against the *actual* arguments of the incoming call.

Presence-checking alone is not enough: it lets an agent obtain approval for
"cancel order #3" and spend the token on "cancel order #7". The hash
binding is what closes that.

### Also blocking

- **Idempotency keys** on `add_to_cart` and `cancel_order`, so a retry
  after a timeout does not double-apply.
- **Transport must be HTTP/SSE with per-request auth, not stdio.** A stdio
  transport carries one ambient identity per process, which is simply wrong
  for a multi-user chat app. The web app uses a JWT session strategy, so
  the MCP server can verify the session token out-of-band using the same
  `NEXTAUTH_SECRET`.

> **Carry forward from M2:** those JWTs are stateless and have **no
> revocation**. Rotating `NEXTAUTH_SECRET` is the only way to invalidate an
> issued token, and it signs out every browser at the same time. Any token
> handed to an agent is live until it expires. Keep the MCP server's token
> lifetime short.

## 1.6 Known risk: prompt injection via tool output

Any tool returning free-text content sourced from users or third parties —
product reviews, product descriptions — is an injection vector into the
agent's context. `Review.content`, `Review.title`, and product descriptions
are all attacker-controllable text that will flow into agent context.

Open item. Needs a mitigation pass — sanitisation, and treating tool output
as data rather than instructions — before this goes past demo scope. Server-
side risk enforcement (1.5) closes the *execution* path only; it does not
stop exfiltration through low-risk tools.

## 1.7 Test MCP independently

Prove each tool end-to-end via a bare MCP client, before any agent exists:

```
MCP Client -> search_products() -> MCP Server -> /api/v1 -> correct result
```

Do the same for every tool in the surface. This is what isolates "is it the
MCP layer or the agent" when something breaks in Phase 2.

## Scorecard

Extend the scorecard with an `mcp` section recording **per-tool p50/p95
latency and success rate**, collected by looping the bare MCP client over
every tool. Capture as `m3-mcp`.

These become the floor Phase 2 cannot regress below. An agent that makes
the same tool slower has a bug, not a feature.

> One caveat when reading M2's API latency as a baseline: `/api/v1/products`
> measured 89ms p95, but `searchProducts` sits behind a 300-second cache, so
> that number is mostly cache hits. An agent issuing varied queries will not
> see it. Measure cold.

## Exit criteria

- Every tool in [tool-surface.md](tool-surface.md) is callable from a bare
  MCP client and returns correct, **user-scoped** data.
- A high-risk tool call without a valid approval token fails, regardless of
  what the caller intended.
- No agent exists yet.
- `npm run scorecard -- m3-mcp --gate` exits 0.
