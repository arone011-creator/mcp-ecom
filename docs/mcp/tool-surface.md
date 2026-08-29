# Tool Surface & Risk Tiers

Canonical for all three phases. Phase 1 implements this table, Phase 2 gates
on the tiers, Phase 3 splits the specialists along the domain column.

## The governing rule

**Expose business-level capabilities, not HTTP endpoints.**

`check_return_eligibility` is a good tool. `GET /orders/{id}/return-check`
is an implementation detail and must not become a 1:1 tool. The MCP server
is an adapter over the existing backend — it never re-implements business
logic. "Is this return allowed?" stays in the backend.

```
MCP Server -> API Client -> Existing Backend API
NOT: MCP Server -> Database directly.
```

## The tools

Every backing route below was verified to exist in `apps/web/app/api/v1/`.

| Tool | Backing route | Risk | Phase 3 owner |
|---|---|---|---|
| `search_products` | `GET /api/v1/products` | Low | Product |
| `get_product` | `GET /api/v1/products/{id}` | Low | Product |
| `check_inventory` | `GET /api/v1/products/{id}/inventory` | Low | Product |
| `get_orders` | `GET /api/v1/orders` | Low | Order |
| `get_order` | `GET /api/v1/orders/{id}` | Low | Order |
| `get_cart` | `GET /api/v1/cart` | Low | Cart |
| `add_to_cart` | `POST /api/v1/cart` | Medium | Cart |
| `remove_from_cart` | `DELETE /api/v1/cart` | Medium | Cart |
| `cancel_order` | `POST /api/v1/orders/{id}/cancel` | **High** | Order |

`POST /api/v1/auth/token` is not a tool. It is how the MCP server obtains a
bearer token for a user; exposing it to an agent would be handing the agent
the credential exchange.

## What the tiers mean

| Tier | Agent behaviour | Server behaviour |
|---|---|---|
| Low | Auto-execute, no confirmation. | Execute. |
| Medium | Execute, then surface as an informational event ("Added to cart") — not a blocking prompt. | Execute. |
| High | Block. Require explicit confirmation with a concrete action button before calling the tool — "I've found the best laptop for $899. Shall I add it to your cart?", never a generic "proceed?". | **Reject without a valid approval token**, regardless of what the agent intended. |

The two columns are the point. The tier is not a convention the agent is
trusted to respect — see [phase-1-mcp-layer.md](phase-1-mcp-layer.md) §1.5.

## Changes from the original capability map

The source plan's map was written before the backend was examined. These
are the corrections, each with its reason.

**Dropped — no backend to adapt:**

- `create_return`, `check_return_eligibility`, `get_return_status`. No
  `Return` model exists in the schema. The only trace of the concept is
  `REFUNDED` in the `OrderStatus` enum. Building a returns subsystem is
  separate product work, not part of this layer.
- `place_order`, `process_payment`. Payment was removed from the app
  entirely; checkout is a dummy flow. Exposing order placement to an LLM
  buys the demo nothing.

**Promoted:**

- `cancel_order` replaces `create_return` as the High-risk showcase
  capability. It is the better example anyway: ownership-checked,
  status-guarded, and it restores inventory — exactly the "business logic
  stays in the backend" case the adapter principle argues for.

**Tier corrections:**

- `add_to_cart` is fixed at **Medium**. The source plan gave it three
  different tiers in three different sections (Low in the capability map,
  Medium in the risk-tier table, and gated behind approval in the sample
  workflow). Medium — execute, then inform — matches the intended UX.

**Added:**

- `remove_from_cart`. `DELETE /api/v1/cart` exists and the source plan
  assigns the tool to the Cart agent, but it never appeared in the
  capability map, so it had no tier from either source document.

  **Settled at Medium during M3**, on two grounds. It is reversible — the
  remedy for a wrong removal is to add the line back. And the API scopes
  its `deleteMany` to the caller's own cart id, so a `productId` from the
  query string can only ever reach their own lines; there is no argument
  an agent could supply that reaches someone else's cart.

  One implementation note that followed from the tier: unlike
  `add_to_cart`, it sends no idempotency key. The operation is already
  idempotent — removing a line that is gone leaves the cart in the state
  the caller asked for — so a key would write a row per removal to protect
  against nothing.

## Folder boundary

The Phase 1 layout groups tools by domain:

```
tools/{products,orders,cart}.py
```

This is deliberate and gets reused: each file becomes one Phase 3
specialist's tool surface. It is not a coincidence and should not be
reorganised for convenience.

Note there are **three** domains, not four. The source plan's Returns agent
has no backend to talk to.
