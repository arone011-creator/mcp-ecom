# Source Documents

`implementation-plan-v2.txt` is the original brainstorm output for the
agentic layer, kept **verbatim**. Nothing in it has been edited.

It is **superseded** by the phase documents one level up. Read those to
know what to build; read this to know what was originally decided and why,
or to check a claim in the phase docs against its source.

Two reasons it is not simply deleted:

1. The phase docs are a derivative — a merge of this file with revisions
   made later against the real repository. If that merge dropped or
   distorted something, this is the ground truth to diff against.
2. It records the reasoning behind decisions that the phase docs only state.

## What changed between this file and the phase docs

The plan was written before the storefront was deployed and before
`/api/v1` existed, so parts of it describe capabilities the backend turned
out not to have.

| Area | This file | Phase docs |
|---|---|---|
| Returns tools | `check_return_eligibility`, `create_return`, `get_return_status` | Dropped — no `Return` model exists |
| High-risk showcase | `create_return` | `cancel_order` |
| Payments | `place_order`, `process_payment` | Dropped — payment was removed from the app |
| `add_to_cart` tier | Low in §1.2, Medium in §2.3, approval-gated in §2.5 | Fixed at Medium |
| `remove_from_cart` | Assigned to the Cart agent in §3.2, absent from the §1.2 map | Listed, tier still unsettled |
| Specialist count | Four (Product, Cart, Order, Returns) | Three — the Returns agent has no backend |
| Server directory | `mcp-server/` | `apps/mcp/`, matching the repository's service layout |
| Approval token | Asserted, mechanism unspecified | Specified as blocking design work |
| Eval harness | Listed as an open risk | A required task in Phase 2 |

Each of these is also noted at the point of use in the phase docs, with the
reason.
