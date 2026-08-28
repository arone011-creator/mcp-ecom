# MCP E-Commerce: Deployment & Agentic Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the `SatvikPraveen/Nextjs-Ecommerce` storefront as a public demo on Railway + Supabase, then layer an MCP server and agentic chat over it.

**Architecture:** Railway hosts the Next.js 15 standalone service and (later) a Python MCP service on the same private network; Supabase supplies managed Postgres 15 via Prisma with pooled + direct connection URLs. Stripe is removed entirely — checkout writes Order rows directly. The MCP server calls a new versioned REST layer (`/api/v1/*`) that wraps the existing `server/queries/*` functions, never Prisma directly.

**Tech Stack:** Next.js 15.5.6, React 18, TypeScript 5.9, Prisma 5.22, PostgreSQL 15 (Supabase), NextAuth 4 (JWT strategy), Tailwind + shadcn/ui, Jest + React Testing Library, Railway, Python 3.11 + FastMCP + httpx (M3+), LangGraph (M5).

**Method — metrics-based TDD:** Every task follows red-green-refactor. On top of that, each milestone boundary captures a scorecard entry (`npm run scorecard`) recording tests, coverage, type errors, build cost, and deployed latency into `metrics/scorecard.json`, which is committed. A milestone cannot be tagged while any metric has regressed against the previous entry unless the regression is written into `acceptedRegressions` with a reason. Task 0 establishes the baseline.

**Infrastructure (already provisioned — use these, do not create new ones):**

- Supabase project `MCP_ECOM`, ref `ywhjahfylvfvhgzsklpg`, URL `https://ywhjahfylvfvhgzsklpg.supabase.co`, nano compute, no migrations applied yet.
- Railway project `mcp_ecom`, currently empty. The Next.js `web` service is added in Task 13; the Python MCP service joins the same project at M3 so they share the private network.

---

## Scope Note

This plan covers **M1 and M2 in executable detail**. M3–M5 are defined as scoped phases with deliverables and exit criteria but are **not** broken into bite-sized tasks here — the MCP tool signatures depend on the exact response shapes M2 produces, and writing them now would be guesswork. Each gets its own plan document once the preceding milestone lands.

| Milestone | Deliverable | Plan status |
|---|---|---|
| M1 | Public storefront deployed and clickable | Full detail below |
| M2 | `/api/v1/*` REST layer over `server/queries/*` | Full detail below |
| M3 | MCP server (source plan Phase 1) | Scoped; own plan after M2 |
| M4 | Single agent (source plan Phase 2) | Scoped; own plan after M3 |
| M5 | Supervisor + specialists (source plan Phase 3) | Scoped; own plan after M4 |

## Prior Findings This Plan Depends On

Verified by reading upstream at commit `e698ffa`. These are why the tasks below exist.

1. **No usable HTTP API exists.** `app/api/products/route.ts`, `app/api/cart/route.ts`, `app/api/stripe/create-checkout/route.ts`, `app/api/stripe/webhook/route.ts`, and `app/api/upload/route.ts` are disabled one-line stubs. All logic lives in `server/actions/*` (`'use server'`) and `server/queries/*`.
2. **Server Actions are not callable as an API.** They POST to the page route with a `Next-Action` header whose ID is a build-generated hash that changes every build. A Python MCP client cannot call them. Hence M2.
3. **`prisma/seed.ts:12` computes `adminPassword` but never assigns it**, and the customer gets no password at all. `lib/auth.ts:71` returns `null` when `!user.password` — so no seeded user can currently log in.
4. **No `/auth/signin` page exists**, though `lib/auth.ts:105` and `middleware.ts:44` both point at it.
5. **No `app/(store)/checkout/page.tsx` and no `app/(account)/orders/page.tsx` exist.** `middleware.ts:12` protects `/orders`, which 404s.
6. **`middleware.ts` compares `token.role !== 'admin'` (lowercase)** but `prisma/schema.prisma:39` uses `UserRole` = `USER | ADMIN` and `lib/auth.ts:93` emits uppercase. The admin guard can never pass. Two occurrences.
7. **`lib/roles.ts:6` declares `Role.SUPER_ADMIN`** which does not exist in the Prisma `UserRole` enum. Dead branch.
8. **`server/actions/orders.ts` has zero authorization** — `cancelOrder`, `updateOrderStatus`, `fulfillOrder`, `getOrderById` take a raw `orderId`, hit Prisma with no session/ownership/role check, and `getOrderById` includes the full `user` record. It duplicates a *safe* `cancelOrder` at `server/actions/checkout.ts:331`. Never expose this file.
9. **`server/queries/orders.ts:117` `getUserOrders(userId)` trusts its `userId` argument.** By contrast `getOrder` (line 75) self-scopes via `getCurrentUser()` + `hasPermission()`. The query layer is inconsistent, so M2 must inject identity itself.
10. **`lib/stripe.ts:4` runs `new Stripe(process.env.STRIPE_SECRET_KEY!)` at module load** — any import crashes the process when that env var is unset.
11. **`prisma/schema.prisma:7` has no `directUrl`.** Supabase needs pooled (6543) at runtime and direct (5432) for migrations.
12. **`package.json` `build` is bare `next build` with no `postinstall`.** Prisma Client is never generated on a clean Railway build.
13. **`next.config.mjs:4` lists `serverExternalPackages: ['@prisma/client', 'bcrypt']`** but the dependency is `bcryptjs` (`package.json:46`).
14. `next.config.mjs:3` already sets `output: 'standalone'`, and `docker/Dockerfile` exists — Railway-compatible as-is.
15. `prisma/seed.ts:365` seeds an Order whose `status` defaults to `PENDING`, which is cancellable — useful for the M4 agent demo.

**Found during Task 2, by running the app against a real database — not predicted from reading:**

16. **`/search` returns HTTP 500.** `app/(store)/search/page.tsx:245` is a Server Component passing `onClick={() => {...}}` to a Button client component: `Event handlers cannot be passed to Client Component props`. Search is broken in the repo as shipped. This is not cosmetic — M1's exit criteria require search to work, and two of the four M4 agent workflows depend on product search. Fixed in Task 6b.
17. **`searchParams` and `params` are accessed synchronously** in `app/(store)/search/page.tsx` (lines 30, 63) and `app/(store)/products/[slug]/page.tsx`. In Next.js 15 these are Promises; sync access currently logs an error but still renders, so `/products/[slug]` returns 200. It will become fatal on the next major. Fixed in Task 6b.
18. **Confirmed empirically:** after `migrate deploy` + `db:seed` against Supabase, `select email, (password is not null) from users` returns `false` for both users while the seed prints `Password: admin123`. Finding 3 verified against a live database, not inferred.
19. The Supabase project runs **Postgres 17**, not the 15 the upstream README claims. Prisma 5.22 handles it; no action needed.
20. Prisma 5.22 → 8.0.0-rc is available. **Deliberately not upgrading in M1** — a major ORM bump mid-repair would invalidate the scorecard baseline for no benefit. Tech debt, revisit after M2.
21. **Never set `NODE_ENV` in an env file.** Next sets it per command — `development` for `next dev`, `production` for `next build`. Hardcoding `NODE_ENV=development` and sourcing that file before `next build` makes Next build for production while loading React's development build, and the build dies prerendering `/404` and `/500` with a misleading `<Html> should not be imported outside of pages/_document`. Next warns `You are using a non-standard "NODE_ENV" value` — **that warning is the diagnosis, not noise.** This cost ~16 builds and six wrong hypotheses during Task 0 because the warning was ignored while the error message was taken at face value.
22. The upstream production build is **fine**. An earlier draft of these findings claimed it was broken; that was caused by finding 21 and is retracted.
23. Node 24 was suspected and is **not** implicated. Every failing build under it also carried the bad `NODE_ENV`. `engines` is therefore `">=20"`, not `">=20 <24"`. Node 22 LTS is used locally as a conservative default, not because 24 is known bad.
24. `@next/font@14.1.0` was installed but never imported (the app uses `next/font/google`). Removed in Task 0 — dead dependency, unrelated to any build failure.
25. **`/products` returns 404 — there is no index page.** `app/(store)/products/` contains only `[slug]/`. The "Browse All Products" button on the empty-search state and several nav links point at `/products`, so this is a dead link reachable from the storefront. Confirmed by HTTP after Task 6b (`404 /products`, while `/products/iphone-15-pro` returns 200). Not caused by Task 6b — pre-existing. Needs its own task in M1; queued alongside the other missing pages (Tasks 8–10).
26. **Task 6b verified over HTTP, not inferred.** After the fix, a dev server log across `/search`, `/search?q=iphone`, `/products/[slug]` and `/category/[slug]?sort=newest` contains zero errors and zero `sync-dynamic-apis` warnings, and `/search?q=iphone` renders actual product results. The first attempt at this check used a `nohup`-detached server whose log file came back empty — an empty log is not evidence of a clean log, so the check was re-run against a server whose output was actually captured.
27. **The seed is not re-runnable.** `prisma/seed.ts` has 12 bare `.create()` calls against tables with unique constraints, so `npm run db:seed` on an already-seeded database dies at `category.create` with `P2002` on `name`. Confirmed empirically in Task 3, not inferred. The two user upserts run *before* that point, so Task 3's password repair did land — but only by accident of ordering. The `update: { password }` clause added in Task 3 cannot deliver its stated purpose ("repair on re-seed") until the rest of the seed is idempotent. Needs its own task before any environment gets re-seeded; M1 is unaffected because Railway seeds once against an empty database.
28. **Do not blanket-ban `update: {}` in the seed.** The plan's original Task 3 test asserted `not.toContain('update: {},')` across the whole file. There is a third occurrence at the cart upsert where leaving an existing cart untouched is correct behaviour. The test was scoped to the two user upsert blocks instead, which is also a stronger assertion — it checks the actual repair clause rather than the absence of a string.
29. **The unconfigured providers were proven, not assumed.** Before Task 5, `GET /api/auth/providers` returned all three of `google`, `email` and `credentials` on an instance with no OAuth or SMTP credentials — the sign-in page would have advertised two options that could only fail. After the fix the same endpoint returns `credentials` alone. Confirmed over HTTP both before and after.
30. **`lib/auth.ts` was unloadable under jest, which silently blocked every auth test.** `next-auth/providers/email` requires `nodemailer`, an *optional* peer dependency that is not installed and not in `package.json`. Next/webpack resolves this lazily so the app builds and runs fine, but jest uses Node resolution and throws `Cannot find module 'nodemailer'` — so any test importing `lib/auth.ts` (directly or via `lib/roles.ts`) failed to run at all. This is why `EmailProvider` was removed outright rather than made conditional: a conditional array entry still needs the static import. The plan's original Task 5 kept that import and would therefore have shipped a test that could never execute.
31. **The existing auth integration tests validated a fiction.** Every role fixture in `tests/integration/auth.test.ts` used `'admin'` / `'customer'`, values Prisma's `UserRole` enum (`USER | ADMIN`) cannot produce. The suite passed only because the middleware compared against the same wrong casing — bug and test agreed with each other and both disagreed with the database. Fixtures corrected to `ADMIN` / `USER` in Task 4.
32. **`/access-denied` was referenced but never built.** The middleware has redirected there since the repository was published and two integration tests assert that target, but no page existed, so a permission denial rendered as a 404. The page was written rather than the redirect changed — rewriting two existing tests to match a behaviour change I had chosen unilaterally would have been the wrong direction. Verified: `GET /access-denied` returns 200.
33. **Ten assertions in `tests/integration/auth.test.ts` cannot fail.** The "allowed route" cases assert `expect(response.status).not.toBe(302)`, but this middleware only ever emits **307**, so the assertion holds whether the request was allowed or redirected. Lines 47, 71, 109, 234 and the six generated from line 295. This inflated the m0 baseline's passing-test count with tests that test nothing, and it is why correcting the role casing surfaced only one real failure instead of several. **Fixed** before Gate 1 at the user's direction. Replaced with an `expectNotRedirected` helper asserting the response carries no `Location` header and a sub-300 status. No hidden guard bugs surfaced — all 32 tests still pass, so the guards were genuinely correct once the casing was right. The repaired assertions were mutation-tested: flipping the middleware's admin comparison to an unreachable value killed 4 tests, 3 of them through the new helper. Under the old assertion those same tests passed while the middleware was actively redirecting every admin, which is the direct empirical proof that they could not fail.
34. **The scorecard's coverage gate was measuring the wrong thing, and Gate 1 caught it.** Gate 1 failed with `coverage.statements: 70.89% -> 60%`. No line lost coverage. jest only instruments files that a test imports, and at m0 that set was `lib/utils.ts` and nothing else — 95/134 statements (70.89%) and 36/51 branches (70.58%) match the recorded baseline exactly. Fixing the `nodemailer` import (finding 30) made `lib/auth.ts` and `lib/roles.ts` loadable, so they entered the report for the first time; the denominator went 134 → 245 and the percentage fell while covered statements rose 95 → 147. **Two harness defects of my own, both from Task 0:** the `Entry` type stored only percentages, so it structurally could not distinguish "covered less" from "measured more"; and the gate compared percentages alone. `Entry.coverage` now carries `statementsCovered/Total` and `branchesCovered/Total`, and `compare()` flags a drop in *covered count* always, but a falling percentage only when the measured surface did not grow. Three tests cover the new logic, including the real Gate 1 numbers.
35. **Coverage still has no stable denominator.** Even after finding 34, jest measures only the 4 files some test happens to import, out of ~100 source files. As a trend line for metrics-based TDD this is close to meaningless: adding a test for a previously-untested file will *lower* the percentage every time. **Correction:** an earlier version of this finding said the fix was to add `collectCoverageFrom`. That was wrong — `jest.config.js` already declares it, covering `app/**`, `components/**`, `lib/**` and `server/**`. It has no effect because it sits at the root of a `projects` config, where jest ignores it; it must be declared inside each project. **Deliberately not fixed:** the user has scoped M1 to getting the core user flow working so the MCP layer can sit on top, and the coverage *percentage* has been dropped as a gate in favour of the covered-count comparison from finding 34, which is honest without needing a rebaseline.
36. **`.tsx` test files were collected by nothing and reported by nothing.** The `unit` and `integration` jest projects both used `testMatch: ['**/?(*.)+(spec|test).ts']` — `.ts` only. A `.tsx` test did not fail and did not run; it was invisible. Proven with a deliberately-failing canary: with the canary present the suite reported 8 suites all passing, and after widening the pattern to `ts?(x)` the same canary produced 9 suites with 1 failure. Task 8's planned `signin-form.test.tsx` would silently never have executed — the plan would have "passed" with zero coverage of the sign-in flow.
37. **React's hooks were globally mocked, making every stateful component untestable.** `tests/setup.ts` did `jest.mock('react', ...)` replacing `useState`, `useEffect`, `useCallback`, `useMemo`, `useReducer` and `useContext` with bare `jest.fn()`s, which return `undefined` — so `const [x, setX] = useState(...)` threw on any real component. The existing suites never noticed because they only render static JSX literals. Nothing depended on the mock; removed.
38. **jest compiled JSX with the classic runtime while Next uses the automatic one.** All three projects set `jsx: 'react'`, which requires `React` to be in lexical scope. Next's source files do not import React, so every component render failed with `ReferenceError: React is not defined`. Changed to `jsx: 'react-jsx'` rather than adding a redundant import to each component — the harness was wrong, not the source.
39. **`@testing-library/jest-dom` was installed but never imported**, so `toBeInTheDocument` and friends did not exist on `expect()`. Wired into `tests/setup.ts`.

**Findings 36–39 share a shape worth naming:** the test harness was configured such that whole categories of test could not run or could not pass, and because no test of that category existed yet, nothing surfaced it. The m0 baseline of "167 passing tests" was measured on a harness that could not execute a component test at all. Combined with finding 33's ten unfailable assertions, the honest reading is that the inherited suite was substantially weaker than its green output suggested.
40. **`server/actions/orders.ts` was dead, not live — a correction to how I described it.** I called it "dangerous" repeatedly. More precisely: nothing imported it, and the build's `server-reference-manifest.json` registered server actions from only five modules, none of them this one. Next tree-shook it, so its four unguarded functions were **not** reachable over HTTP in the shipped build. It was a loaded gun, not a fired one — a single future import would have registered `updateOrderStatus`, `fulfillOrder`, `cancelOrder` and `getOrderById` (which returned the full `user` record) as callable endpoints taking a raw `orderId` with no auth. Verified before deleting rather than asserted.
41. **`server/actions/checkout.ts` and the Stripe API routes were equally inert.** Nothing imported `createCheckout`; `app/api/stripe/create-checkout/route.ts` and `.../webhook/route.ts` were already one-line stubs reading "This route is disabled". The live `updateOrderStatus` is the one in `server/actions/admin.ts`, which correctly calls `requirePermission(PERMISSIONS.ORDER_UPDATE)` — confirmed, so removing the duplicate loses no guarded behaviour.
42. **Three more tests that tested nothing.** The `Checkout API Integration` block in `tests/integration/api.test.ts` never called a route. It asserted things like `expect(invalidCheckoutData.items.length === 0).toBe(true)` against a literal defined two lines above, and `expect(checkoutData.customerEmail.includes('@')).toBe(true)`. Tautologies. Deleted with the code they pretended to cover. Together with finding 33's ten unfailable assertions and findings 36–39's harness defects, thirteen of the inherited suite's tests were incapable of failing.
43. **The Stripe removal was verified by bundle size, not by absence of errors.** Standalone output fell 81,027,203 → 80,961,089 bytes (−66 KB) and `app-paths-manifest.json` contains no route matching `stripe`. The `stripe` and `@stripe/stripe-js` packages are gone from `package.json` and the lockfile. The drop is modest because nothing imported `stripe`, so it was never traced into the standalone bundle in the first place — the 66 KB is the deleted routes and actions themselves.
44. **The cart had two sources of truth that never spoke to each other, and `/cart` rendered the wrong one.** `components/add-to-cart.tsx` calls the `addToCart` server action, which writes `cart_items` rows to Postgres. `components/cart-provider.tsx` keeps an independent item list in `localStorage` and never reads the server. `app/(store)/cart/page.tsx` was `'use client'` and rendered from the provider. Net effect: adding a product wrote a database row and the cart page still said "Your cart is empty". Found by driving the real UI in a browser and then querying Supabase — the click produced a new guest cart `sessionId` with 1 × iPhone 15 Pro while the page showed nothing. **This is the single most important defect found so far for the agent layer:** an MCP `add_to_cart` tool writes server-side, so a UI reading `localStorage` would never reflect agent actions, and a checkout reading the database would disagree with what the user was shown. Fixed by making `page.tsx` a server component that calls `getCart()` and passing the rows to a client `cart-view.tsx`; `getCart()` was extended to select `sku` and inventory `available` (as `stock`), which the view needs. Mutations now `router.refresh()` instead of poking client state.
45. **`app/api/cart/route.ts` is a stub, so the cart has no HTTP surface at all.** The file contains only comments saying to use the server actions instead. Server actions are reachable only with a build-generated `Next-Action` id, so nothing outside the app can read or write a cart today. This is not a bug — it is exactly the gap M2's `/api/v1/cart` exists to close — but it means the MCP layer has no cart access until M2 lands, and it is why cart had to be verified through the browser rather than with `curl`.

**Debugging lesson, recorded because it generalises:** when a build fails, read the *warnings* in the same output before theorising about the error. A misleading error message plus an ignored warning produced six consecutive wrong hypotheses. Bisecting only helps when the control is verified — three separate bisects here returned false signals because the control was broken in a different way than the subject.

---

## File Structure

### Created in M1

| Path | Responsibility |
|---|---|
| `app/auth/signin/page.tsx` | Sign-in screen shell (server component) |
| `app/auth/signin/signin-form.tsx` | Client component owning `signIn()` calls, form state, one-click demo login |
| `app/(store)/checkout/page.tsx` | Checkout screen shell |
| `app/(store)/checkout/checkout-form.tsx` | Client component for the checkout form |
| `app/(account)/orders/page.tsx` | Order list for the signed-in user (currently 404s) |
| `server/actions/checkout-demo.ts` | `placeDemoOrder` — creates Order + OrderItems, decrements inventory, clears cart. No Stripe. |
| `server/actions/order-lifecycle.ts` | The *safe* `cancelOrder`, relocated out of the Stripe-coupled file |
| `scripts/scorecard.ts` | Metrics collection + regression comparison; the milestone gate |
| `metrics/scorecard.json` | Committed history of every milestone entry — the trend line |
| `tests/unit/*.test.ts` | Unit tests per task |

### Deleted in M1

| Path | Why |
|---|---|
| `lib/stripe.ts` | Module-load crash (finding 10); Stripe out of scope |
| `server/actions/checkout.ts` | Stripe-coupled; its one valuable function moves to `order-lifecycle.ts` |
| `server/actions/orders.ts` | Zero authorization (finding 8) |
| `app/api/stripe/` | Disabled stubs for a removed integration |

### Modified in M1

`prisma/schema.prisma` (add `directUrl`) · `prisma/seed.ts` (set passwords) · `package.json` (Prisma-aware build) · `next.config.mjs` (`bcrypt`→`bcryptjs`) · `middleware.ts` (role casing) · `lib/roles.ts` (drop `SUPER_ADMIN`) · `lib/auth.ts` (conditional providers)

### Created in M2

| Path | Responsibility |
|---|---|
| `app/api/v1/_lib/session.ts` | `requireApiUser()` — the single identity choke point |
| `app/api/v1/_lib/respond.ts` | `ok()` / `fail()` JSON envelope helpers, Decimal-safe |
| `app/api/v1/products/route.ts` | `GET` — search/filter products |
| `app/api/v1/products/[id]/route.ts` | `GET` — single product |
| `app/api/v1/products/[id]/inventory/route.ts` | `GET` — stock levels |
| `app/api/v1/orders/route.ts` | `GET` — caller's orders only |
| `app/api/v1/orders/[id]/route.ts` | `GET` — single order, ownership-checked |
| `app/api/v1/orders/[id]/cancel/route.ts` | `POST` — delegates to `order-lifecycle.ts` |
| `app/api/v1/cart/route.ts` | `GET` / `POST` / `DELETE` |
| `tests/integration/api-v1-*.test.ts` | Route tests including cross-user denial |

---

# Milestone M1 — Deployed Public Storefront

**Exit criteria:** A stranger with the URL can browse the catalogue, search it, sign in with one click, add to cart, place a dummy order, and see that order in their order list. No Stripe env vars set anywhere.

## Task 1: Establish the working repository

**Files:** the repository working tree at `C:\Users\HimanshuSekharBandha\Downloads\MCP_ECOM`

- [ ] **Step 1: Clone upstream and merge into the working directory**

The working directory already holds `MCP_Agentic_Chat_ImplementationPlan_v2.txt` and `docs/`, so clone beside them and merge.

```bash
cd /c/Users/HimanshuSekharBandha/Downloads/MCP_ECOM
git clone https://github.com/SatvikPraveen/Nextjs-Ecommerce.git .upstream
cp -r .upstream/. .
rm -rf .upstream
```

- [ ] **Step 2: Verify commit and licence**

```bash
git log --oneline -1
head -3 LICENSE
```

Expected: `e698ffa docs: update package.json description to reflect current state`. Keep the upstream `LICENSE` and attribution — this is a fork of someone else's work.

- [ ] **Step 3: Point at your own remote and branch**

Create an empty `mcp-ecom` repo on GitHub first, then:

```bash
git remote remove origin
git remote add origin https://github.com/YOUR_GITHUB_USER/mcp-ecom.git
git checkout -b m1-deploy-storefront
```

- [ ] **Step 4: Commit the planning documents**

```bash
git add docs/ MCP_Agentic_Chat_ImplementationPlan_v2.txt
git commit -m "docs: add architecture plan and implementation plan"
```

## Task 2: Prove the app boots locally (hard gate)

No code in this task. If it fails, stop and diagnose — every task below assumes a working baseline.

**Files:** Create `.env.local`

- [ ] **Step 1: Start local Postgres**

```bash
docker compose up -d
docker compose ps
```

Expected: a Postgres container in `Up` state. If the compose file names the service something other than the default, read `docker-compose.yml` and match its credentials and ports rather than assuming.

- [ ] **Step 2: Write `.env.local`**

Match `DATABASE_URL` to whatever `docker-compose.yml` actually declares.

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ecommerce?schema=public"
DIRECT_URL="postgresql://postgres:postgres@localhost:5432/ecommerce?schema=public"
NEXTAUTH_SECRET="local-dev-secret-not-for-production"
NEXTAUTH_URL="http://localhost:3000"
NEXT_PUBLIC_APP_NAME="MCP Commerce"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
ADMIN_EMAIL="admin@example.com"
NODE_ENV="development"
```

- [ ] **Step 3: Install and generate**

```bash
npm install
npx prisma generate
```

Expected: `Generated Prisma Client` in the output.

- [ ] **Step 4: Apply schema and seed**

```bash
npx prisma migrate deploy
npm run db:seed
```

Expected: seed output ending with created products, a cart, and one order.

- [ ] **Step 5: Boot and verify**

```bash
npm run dev
```

Open `http://localhost:3000`. Expected: homepage renders with seeded products and images. Then visit `http://localhost:3000/orders` and confirm it redirects to a 404 at `/auth/signin` — this is the documented broken state that Tasks 8 and 10 fix.

- [ ] **Step 5b: Verify the app can actually be built, not just run**

`next dev` never exercises the production build. An app that boots fine in dev can still be undeployable, and this gate exists to catch exactly that before Task 13 discovers it on Railway.

Stop the dev server first — `next dev` and `next build` both write to `.next`.

```bash
npm run build
du -sh .next/standalone
```

Expected: the build completes with a route table, and `.next/standalone` exists at roughly 80MB. If it is absent, the build failed regardless of what the exit code said.

**Do not set `NODE_ENV` when running this.** `.env.local` must not contain a `NODE_ENV` line (see finding 21). If the build fails with `<Html> should not be imported outside of pages/_document`, check the warnings above the error for `non-standard "NODE_ENV" value` before investigating anything else — that message is the actual diagnosis.

- [ ] **Step 6: Commit an env template**

`.env.local` is gitignored; record the shape instead.

```bash
sed 's/=.*/=""/' .env.local > .env.local.example
git add .env.local.example
git commit -m "chore: add local env template"
```

## Task 0: Establish the metrics scorecard and capture the baseline

Numbered 0 because it records the state of the codebase **before any change of ours** — that entry is what M1 is measured against. Sequenced here rather than first because it needs `npm install` from Task 2.

**Files:**
- Create: `scripts/scorecard.ts`, `metrics/scorecard.json`
- Modify: `package.json` scripts, `.gitignore`
- Test: `tests/unit/scorecard.test.ts`

- [ ] **Step 1: Write the failing test**

The comparison logic is the only part with real branching, so that is what gets tested. Collection is I/O and is verified by running it in Step 5.

```typescript
// tests/unit/scorecard.test.ts
import { compare, percentile, type Entry } from '@/scripts/scorecard';

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    milestone: 'test',
    capturedAt: '2026-08-27T00:00:00.000Z',
    commit: 'abc1234',
    tests: { passed: 10, total: 10, passRate: 1 },
    coverage: { statements: 80, branches: 70 },
    typeErrors: 0,
    build: { durationMs: 60000, standaloneBytes: 100_000_000 },
    latency: null,
    acceptedRegressions: [],
    ...overrides,
  };
}

describe('percentile', () => {
  it('returns the median for p50', () => {
    expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30);
  });

  it('returns the top of the range for p95', () => {
    expect(percentile([10, 20, 30, 40, 50], 95)).toBe(50);
  });
});

describe('compare', () => {
  it('reports nothing when there is no previous entry', () => {
    expect(compare(undefined, entry())).toEqual([]);
  });

  it('reports nothing when every metric holds', () => {
    expect(compare(entry(), entry())).toEqual([]);
  });

  it('fails any entry with failing tests, regardless of the previous entry', () => {
    const current = entry({ tests: { passed: 9, total: 10, passRate: 0.9 } });
    expect(compare(entry(), current)).toEqual([
      expect.stringContaining('tests: 9/10'),
    ]);
  });

  it('fails any entry with type errors', () => {
    expect(compare(entry(), entry({ typeErrors: 3 }))).toEqual([
      expect.stringContaining('typeErrors: 3'),
    ]);
  });

  it('flags a drop in statement coverage', () => {
    const current = entry({ coverage: { statements: 79, branches: 70 } });
    expect(compare(entry(), current)).toEqual([
      expect.stringContaining('coverage.statements: 80% -> 79%'),
    ]);
  });

  it('tolerates build time within 10% but flags beyond it', () => {
    const withinBudget = entry({
      build: { durationMs: 66000, standaloneBytes: 100_000_000 },
    });
    expect(compare(entry(), withinBudget)).toEqual([]);

    const overBudget = entry({
      build: { durationMs: 67000, standaloneBytes: 100_000_000 },
    });
    expect(compare(entry(), overBudget)).toEqual([
      expect.stringContaining('build.durationMs'),
    ]);
  });

  it('flags a p95 latency regression beyond 25%', () => {
    const previous = entry({ latency: { '/': { p50: 100, p95: 200 } } });
    const current = entry({ latency: { '/': { p50: 100, p95: 260 } } });
    expect(compare(previous, current)).toEqual([
      expect.stringContaining('latency / p95: 200ms -> 260ms'),
    ]);
  });

  it('suppresses a regression that has been explicitly accepted', () => {
    const current = entry({
      typeErrors: 3,
      acceptedRegressions: ['typeErrors'],
    });
    expect(compare(entry(), current)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/scorecard.test.ts`
Expected: FAIL — `Cannot find module '@/scripts/scorecard'`.

- [ ] **Step 3: Write the scorecard script**

```typescript
// scripts/scorecard.ts
import { execSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export type Timing = { p50: number; p95: number };

export type Entry = {
  milestone: string;
  capturedAt: string;
  commit: string;
  tests: { passed: number; total: number; passRate: number };
  coverage: { statements: number; branches: number };
  typeErrors: number;
  build: { durationMs: number; standaloneBytes: number };
  latency: Record<string, Timing> | null;
  acceptedRegressions: string[];
};

const SCORECARD_PATH = join(process.cwd(), 'metrics', 'scorecard.json');
const BUILD_TOLERANCE = 1.1;
const LATENCY_TOLERANCE = 1.25;
const PROBE_PATHS = ['/', '/api/v1/products?q=shoes&limit=5'];
const LATENCY_SAMPLES = 20;

export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return Math.round(sorted[index]);
}

export function compare(previous: Entry | undefined, current: Entry): string[] {
  const accepted = new Set(current.acceptedRegressions);
  const found: string[] = [];

  const flag = (key: string, message: string) => {
    if (!accepted.has(key)) found.push(message);
  };

  // Absolute gates — these hold with or without a previous entry.
  if (current.tests.passRate < 1) {
    flag('tests', `tests: ${current.tests.passed}/${current.tests.total} passing`);
  }
  if (current.typeErrors > 0) {
    flag('typeErrors', `typeErrors: ${current.typeErrors}`);
  }

  if (!previous) return found;

  // Relative gates.
  if (current.coverage.statements < previous.coverage.statements) {
    flag(
      'coverage.statements',
      `coverage.statements: ${previous.coverage.statements}% -> ${current.coverage.statements}%`
    );
  }
  if (current.coverage.branches < previous.coverage.branches) {
    flag(
      'coverage.branches',
      `coverage.branches: ${previous.coverage.branches}% -> ${current.coverage.branches}%`
    );
  }
  if (current.build.durationMs > previous.build.durationMs * BUILD_TOLERANCE) {
    flag(
      'build.durationMs',
      `build.durationMs: ${previous.build.durationMs} -> ${current.build.durationMs}`
    );
  }
  if (
    current.build.standaloneBytes >
    previous.build.standaloneBytes * BUILD_TOLERANCE
  ) {
    flag(
      'build.standaloneBytes',
      `build.standaloneBytes: ${previous.build.standaloneBytes} -> ${current.build.standaloneBytes}`
    );
  }

  if (previous.latency && current.latency) {
    for (const [path, timing] of Object.entries(current.latency)) {
      const before = previous.latency[path];
      if (before && timing.p95 > before.p95 * LATENCY_TOLERANCE) {
        flag(
          `latency.${path}`,
          `latency ${path} p95: ${before.p95}ms -> ${timing.p95}ms`
        );
      }
    }
  }

  return found;
}

function dirSize(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    total += item.isDirectory() ? dirSize(full) : statSync(full).size;
  }
  return total;
}

function collectTests() {
  const resultPath = join(process.cwd(), 'metrics', '.jest-result.json');

  spawnSync(
    'npx',
    [
      'jest',
      '--silent',
      '--coverage',
      '--coverageReporters=json-summary',
      '--json',
      `--outputFile=${resultPath}`,
    ],
    { stdio: 'inherit', shell: true }
  );

  const result = JSON.parse(readFileSync(resultPath, 'utf-8'));
  const summaryPath = join(process.cwd(), 'coverage', 'coverage-summary.json');
  const summary = existsSync(summaryPath)
    ? JSON.parse(readFileSync(summaryPath, 'utf-8'))
    : { total: { statements: { pct: 0 }, branches: { pct: 0 } } };

  return {
    tests: {
      passed: result.numPassedTests as number,
      total: result.numTotalTests as number,
      passRate:
        result.numTotalTests === 0
          ? 0
          : result.numPassedTests / result.numTotalTests,
    },
    coverage: {
      statements: summary.total.statements.pct as number,
      branches: summary.total.branches.pct as number,
    },
  };
}

function collectTypeErrors(): number {
  const res = spawnSync('npx', ['tsc', '--noEmit'], {
    encoding: 'utf-8',
    shell: true,
  });
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  return (output.match(/error TS\d+/g) ?? []).length;
}

function collectBuild() {
  const started = Date.now();
  spawnSync('npx', ['next', 'build'], { stdio: 'inherit', shell: true });
  return {
    durationMs: Date.now() - started,
    standaloneBytes: dirSize(join(process.cwd(), '.next', 'standalone')),
  };
}

async function collectLatency(baseUrl: string) {
  const results: Record<string, Timing> = {};

  for (const path of PROBE_PATHS) {
    const timings: number[] = [];
    for (let i = 0; i < LATENCY_SAMPLES; i++) {
      const started = Date.now();
      try {
        await fetch(`${baseUrl}${path}`);
      } catch {
        // A failed probe still consumed wall-clock time; record it rather
        // than silently shrinking the sample.
      }
      timings.push(Date.now() - started);
    }
    results[path] = {
      p50: percentile(timings, 50),
      p95: percentile(timings, 95),
    };
  }

  return results;
}

function loadEntries(): Entry[] {
  if (!existsSync(SCORECARD_PATH)) return [];
  return (JSON.parse(readFileSync(SCORECARD_PATH, 'utf-8')).entries ??
    []) as Entry[];
}

async function main() {
  const milestone = process.argv[2];
  if (!milestone || milestone.startsWith('--')) {
    console.error('Usage: npm run scorecard -- <milestone> [--gate]');
    console.error('Set SCORECARD_BASE_URL to also capture deployed latency.');
    process.exit(1);
  }

  const gate = process.argv.includes('--gate');
  const baseUrl = process.env.SCORECARD_BASE_URL;

  mkdirSync(join(process.cwd(), 'metrics'), { recursive: true });

  const { tests, coverage } = collectTests();
  const typeErrors = collectTypeErrors();
  const build = collectBuild();
  const latency = baseUrl ? await collectLatency(baseUrl) : null;

  const entry: Entry = {
    milestone,
    capturedAt: new Date().toISOString(),
    commit: execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim(),
    tests,
    coverage,
    typeErrors,
    build,
    latency,
    acceptedRegressions: [],
  };

  const entries = loadEntries();
  const previous = entries[entries.length - 1];
  const regressions = compare(previous, entry);

  console.log(`\nScorecard — ${milestone} @ ${entry.commit}`);
  console.log(`  tests            ${tests.passed}/${tests.total}`);
  console.log(`  coverage stmts   ${coverage.statements}%`);
  console.log(`  coverage branch  ${coverage.branches}%`);
  console.log(`  type errors      ${typeErrors}`);
  console.log(`  build            ${Math.round(build.durationMs / 1000)}s`);
  console.log(
    `  standalone       ${Math.round(build.standaloneBytes / 1_000_000)}MB`
  );
  if (latency) {
    for (const [path, timing] of Object.entries(latency)) {
      console.log(`  p95 ${path}  ${timing.p95}ms`);
    }
  }

  entries.push(entry);
  writeFileSync(
    SCORECARD_PATH,
    `${JSON.stringify({ entries }, null, 2)}\n`
  );

  if (regressions.length > 0) {
    console.error(
      `\nRegressions against ${previous ? previous.milestone : 'absolute gates'}:`
    );
    regressions.forEach(r => console.error(`  - ${r}`));
    console.error(
      '\nFix them, or add the metric key to "acceptedRegressions" on this ' +
        'entry with a reason and re-run.'
    );
    if (gate) process.exit(1);
  } else {
    console.log('\nNo regressions.');
  }
}

main();
```

- [ ] **Step 4: Wire it up**

Add to `package.json` scripts:

```json
    "scorecard": "tsx scripts/scorecard.ts",
```

Create `metrics/scorecard.json`:

```json
{
  "entries": []
}
```

Add to `.gitignore`:

```
coverage/
metrics/.jest-result.json
```

`metrics/scorecard.json` itself is **committed** — the file's git history is the trend line.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/unit/scorecard.test.ts`
Expected: PASS, 9 tests.

If TypeScript cannot resolve `@/scripts/scorecard`, check that the `@/*` path alias in `tsconfig.json` maps to the project root rather than to `src/`. If it maps to `src/`, import via a relative path in the test instead.

- [ ] **Step 6: Capture the baseline**

```bash
npm run scorecard -- m0-upstream
```

Expected: a printed summary and one entry in `metrics/scorecard.json`. No latency section — nothing is deployed yet. Note the printed test count: the upstream README claims 149 passing. **Record whatever the real number is.** If it is lower, that is the honest baseline and every later milestone is measured against it.

- [ ] **Step 7: Commit**

```bash
git add scripts/scorecard.ts metrics/scorecard.json tests/unit/scorecard.test.ts package.json .gitignore
git commit -m "feat(metrics): add scorecard harness and capture m0 baseline"
```

## Task 3: Fix the seed so demo users can log in

**Files:**
- Modify: `prisma/seed.ts:10-38`
- Test: `tests/unit/seed-credentials.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/seed-credentials.test.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { hash, compare } from 'bcryptjs';

describe('seed credentials', () => {
  const seedSource = readFileSync(join(process.cwd(), 'prisma/seed.ts'), 'utf-8');

  it('assigns a password to the admin user', () => {
    const start = seedSource.indexOf('const admin = await prisma.user.upsert');
    const block = seedSource.slice(start, start + 400);
    expect(block).toContain('password: adminPassword');
  });

  it('assigns a password to the demo customer', () => {
    const start = seedSource.indexOf('const customer = await prisma.user.upsert');
    const block = seedSource.slice(start, start + 400);
    expect(block).toContain('password: customerPassword');
  });

  it('repairs passwords on re-seed rather than skipping with an empty update', () => {
    expect(seedSource).not.toContain('update: {},');
  });

  it('produces a verifiable bcrypt hash for the documented demo password', async () => {
    const hashed = await hash('demo1234', 12);
    await expect(compare('demo1234', hashed)).resolves.toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/seed-credentials.test.ts`
Expected: FAIL — the first three assertions fail; `password:` is absent from both upsert blocks and `update: {},` is present.

- [ ] **Step 3: Fix the seed**

Replace `prisma/seed.ts` lines 10–38 with:

```typescript
  // Create admin user
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
  const adminPassword = await hash('admin123', 12);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { password: adminPassword },
    create: {
      email: adminEmail,
      name: 'Admin User',
      role: UserRole.ADMIN,
      password: adminPassword,
    },
  });

  console.log(`Created admin user: ${admin.email}`);

  // Create demo customer
  const customerPassword = await hash('demo1234', 12);

  const customer = await prisma.user.upsert({
    where: { email: 'customer@example.com' },
    update: { password: customerPassword },
    create: {
      email: 'customer@example.com',
      name: 'John Doe',
      role: UserRole.USER,
      password: customerPassword,
    },
  });

  console.log(`Created customer: ${customer.email}`);
```

The `update:` clauses matter: the original used `update: {}`, so re-running the seed against an existing database would never repair a passwordless user.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/seed-credentials.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Re-seed**

```bash
npm run db:seed
```

- [ ] **Step 6: Commit**

```bash
git add prisma/seed.ts tests/unit/seed-credentials.test.ts
git commit -m "fix(seed): assign passwords to seeded users so credentials login works"
```

## Task 4: Fix role casing and the phantom SUPER_ADMIN

**Files:**
- Modify: `middleware.ts` (two occurrences), `lib/roles.ts:6-10`
- Test: `tests/unit/roles.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/roles.test.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { Role } from '@/lib/roles';

describe('role consistency', () => {
  it('middleware compares against the uppercase ADMIN value', () => {
    const source = readFileSync(join(process.cwd(), 'middleware.ts'), 'utf-8');
    expect(source).not.toContain("!== 'admin'");
    expect(source).toContain("!== 'ADMIN'");
  });

  it('Role enum matches the Prisma UserRole enum exactly', () => {
    const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf-8');
    const start = schema.indexOf('enum UserRole');
    const block = schema.slice(start, schema.indexOf('}', start));
    const prismaRoles = block
      .split('\n')
      .slice(1)
      .map(l => l.trim())
      .filter(Boolean)
      .sort();

    expect(Object.values(Role).sort()).toEqual(prismaRoles);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/roles.test.ts`
Expected: FAIL on both — middleware has lowercase `'admin'`, and `Role` contains `SUPER_ADMIN` which `UserRole` does not.

- [ ] **Step 3: Fix `middleware.ts`**

Change both occurrences of:

```typescript
    if (token.role !== 'admin') {
```

to:

```typescript
    if (token.role !== 'ADMIN') {
```

One is in the admin-route guard, one in the `/api/admin` guard. Confirm you found both:

```bash
grep -n "'ADMIN'" middleware.ts
```

Expected: 2 lines.

- [ ] **Step 4: Fix `lib/roles.ts`**

Replace the enum at `lib/roles.ts:6-10`:

```typescript
export enum Role {
  USER = 'USER',
  ADMIN = 'ADMIN',
}
```

Then remove `requireSuperAdmin` (around `lib/roles.ts:147`) and every other `SUPER_ADMIN` reference:

```bash
grep -rn "SUPER_ADMIN" --include=*.ts --include=*.tsx .
```

Expected after edits: no matches.

- [ ] **Step 5: Run tests and typecheck**

```bash
npx jest tests/unit/roles.test.ts
npm run type-check
```

Expected: tests PASS, `tsc --noEmit` exits 0.

- [ ] **Step 6: Commit**

```bash
git add middleware.ts lib/roles.ts tests/unit/roles.test.ts
git commit -m "fix(auth): correct ADMIN role casing and drop phantom SUPER_ADMIN"
```

## Task 5: Make optional auth providers conditional

`lib/auth.ts:43-57` registers Google and Email unconditionally with `!` non-null assertions. With no OAuth credentials — the deployed configuration — NextAuth renders a broken provider list and can throw during sign-in.

**Files:**
- Modify: `lib/auth.ts:42-58`
- Test: `tests/unit/auth-providers.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/auth-providers.test.ts
describe('auth providers', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.EMAIL_SERVER_HOST;
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('registers only credentials when no OAuth env vars are set', async () => {
    const { authOptions } = await import('@/lib/auth');
    const ids = authOptions.providers.map((p: any) => p.id);
    expect(ids).toEqual(['credentials']);
  });

  it('registers google when its env vars are present', async () => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    const { authOptions } = await import('@/lib/auth');
    const ids = authOptions.providers.map((p: any) => p.id);
    expect(ids).toContain('google');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/auth-providers.test.ts`
Expected: FAIL — the first test finds `['google', 'email', 'credentials']`.

- [ ] **Step 3: Rewrite the providers array**

Replace `lib/auth.ts` lines 42–58 (the `providers: [ ... ],` array, up to but not including `session:`) with:

```typescript
  providers: [
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          }),
        ]
      : []),
    ...(process.env.EMAIL_SERVER_HOST
      ? [
          EmailProvider({
            server: {
              host: process.env.EMAIL_SERVER_HOST,
              port: Number(process.env.EMAIL_SERVER_PORT ?? 587),
              auth: {
                user: process.env.EMAIL_SERVER_USER,
                pass: process.env.EMAIL_SERVER_PASSWORD,
              },
            },
            from: process.env.EMAIL_FROM,
          }),
        ]
      : []),
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user || !user.password) return null;

        const isValid = await bcrypt.compare(credentials.password, user.password);
        if (!isValid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/auth-providers.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/auth.ts tests/unit/auth-providers.test.ts
git commit -m "fix(auth): register google and email providers only when configured"
```

## Task 6: Extract the safe cancelOrder, then remove Stripe

`server/actions/checkout.ts:331` contains the only well-written mutation in the codebase — it checks auth, verifies `order.userId === user.id`, enforces `status ∈ {PENDING, PROCESSING}`, restores reserved inventory, and stamps `cancelledAt`. It must survive the Stripe removal. `server/actions/orders.ts` contains an unauthorized duplicate that must not.

**Files:**
- Create: `server/actions/order-lifecycle.ts`, `tests/unit/order-lifecycle.test.ts`
- Delete: `lib/stripe.ts`, `server/actions/checkout.ts`, `server/actions/orders.ts`, `app/api/stripe/`
- Modify: `next.config.mjs:4`

- [ ] **Step 1: Confirm nothing in the UI imports what you are about to delete**

```bash
grep -rn "actions/checkout\|actions/orders\|lib/stripe" --include=*.ts --include=*.tsx app components server lib
```

Record every hit. Anything under `app/admin/` that imports `server/actions/orders` must be repointed at `order-lifecycle.ts` in Step 5.

- [ ] **Step 2: Write the failing test**

```typescript
// tests/unit/order-lifecycle.test.ts
jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    order: { findUnique: jest.fn(), update: jest.fn() },
    inventory: { findUnique: jest.fn(), update: jest.fn() },
  },
}));
jest.mock('@/lib/roles', () => ({ getCurrentUser: jest.fn() }));
jest.mock('next/cache', () => ({ revalidateTag: jest.fn() }));

import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/roles';
import { cancelOrder } from '@/server/actions/order-lifecycle';

const mockPrisma = prisma as any;
const mockGetCurrentUser = getCurrentUser as jest.Mock;

describe('cancelOrder', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuses when there is no session', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    await expect(cancelOrder('order_1')).resolves.toEqual({
      success: false,
      error: 'Authentication required',
    });
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });

  it('refuses to cancel an order belonging to another user', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'user_a' });
    mockPrisma.order.findUnique.mockResolvedValue({
      id: 'order_1',
      userId: 'user_b',
      status: 'PENDING',
      orderItems: [],
    });
    await expect(cancelOrder('order_1')).resolves.toEqual({
      success: false,
      error: 'Unauthorized',
    });
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });

  it('refuses to cancel an order that has already shipped', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'user_a' });
    mockPrisma.order.findUnique.mockResolvedValue({
      id: 'order_1',
      userId: 'user_a',
      status: 'SHIPPED',
      orderItems: [],
    });
    await expect(cancelOrder('order_1')).resolves.toEqual({
      success: false,
      error: 'Order cannot be cancelled',
    });
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });

  it('cancels a pending order owned by the caller', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'user_a' });
    mockPrisma.order.findUnique.mockResolvedValue({
      id: 'order_1',
      userId: 'user_a',
      status: 'PENDING',
      orderItems: [],
    });
    mockPrisma.order.update.mockResolvedValue({});

    await expect(cancelOrder('order_1')).resolves.toEqual({ success: true });
    expect(mockPrisma.order.update).toHaveBeenCalledWith({
      where: { id: 'order_1' },
      data: { status: 'CANCELLED', cancelledAt: expect.any(Date) },
    });
  });

  it('restores reserved inventory when cancelling a PROCESSING order', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'user_a' });
    mockPrisma.order.findUnique.mockResolvedValue({
      id: 'order_1',
      userId: 'user_a',
      status: 'PROCESSING',
      orderItems: [{ productId: 'prod_1', quantity: 2 }],
    });
    mockPrisma.inventory.findUnique.mockResolvedValue({
      productId: 'prod_1',
      available: 5,
      reserved: 3,
    });
    mockPrisma.order.update.mockResolvedValue({});

    await cancelOrder('order_1');

    expect(mockPrisma.inventory.update).toHaveBeenCalledWith({
      where: { productId: 'prod_1' },
      data: { available: 7, reserved: 1 },
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest tests/unit/order-lifecycle.test.ts`
Expected: FAIL — `Cannot find module '@/server/actions/order-lifecycle'`.

- [ ] **Step 4: Create `server/actions/order-lifecycle.ts`**

```typescript
// server/actions/order-lifecycle.ts
'use server';

import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/roles';
import { revalidateTag } from 'next/cache';

const CANCELLABLE_STATUSES = ['PENDING', 'PROCESSING'];

export async function cancelOrder(orderId: string) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Authentication required' };
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { orderItems: true },
    });

    if (!order) {
      return { success: false, error: 'Order not found' };
    }

    if (order.userId !== user.id) {
      return { success: false, error: 'Unauthorized' };
    }

    if (!CANCELLABLE_STATUSES.includes(order.status)) {
      return { success: false, error: 'Order cannot be cancelled' };
    }

    if (order.status === 'PROCESSING') {
      for (const item of order.orderItems) {
        const inventory = await prisma.inventory.findUnique({
          where: { productId: item.productId },
        });

        if (inventory) {
          await prisma.inventory.update({
            where: { productId: item.productId },
            data: {
              available: inventory.available + item.quantity,
              reserved: Math.max(0, inventory.reserved - item.quantity),
            },
          });
        }
      }
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    revalidateTag('orders');
    revalidateTag('products');

    return { success: true };
  } catch (error) {
    console.error('Cancel order error:', error);
    return { success: false, error: 'Failed to cancel order' };
  }
}
```

- [ ] **Step 5: Delete the Stripe-coupled and unauthorized files**

```bash
git rm lib/stripe.ts server/actions/checkout.ts server/actions/orders.ts
git rm -r app/api/stripe
```

Repoint any import you recorded in Step 1 at `@/server/actions/order-lifecycle`.

- [ ] **Step 6: Fix the external-packages list**

In `next.config.mjs:4`, change:

```javascript
  serverExternalPackages: ['@prisma/client', 'bcrypt'],
```

to:

```javascript
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],
```

- [ ] **Step 7: Run tests and typecheck**

```bash
npx jest tests/unit/order-lifecycle.test.ts
npm run type-check
```

Expected: 5 tests PASS, `tsc --noEmit` exits 0. If typecheck reports a missing module, you have an unrepointed import from Step 1.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: extract safe cancelOrder, remove stripe and unauthorized order actions"
```

## Task 6b: Fix the broken search page and the Next 15 async params

Discovered by running the app in Task 2, not by reading it (findings 16 and 17). `/search` returns 500 today. M1 cannot exit without this, and two M4 agent workflows depend on product search.

**Files:**
- Modify: `app/(store)/search/page.tsx:16-24,26-29,49-53,239-257`
- Modify: `app/(store)/products/[slug]/page.tsx:20-29,60-61`
- Modify: `app/(store)/category/[slug]/page.tsx:19`
- Modify: `app/(account)/orders/[id]/page.tsx:17`
- Test: `tests/unit/rsc-boundaries.test.ts`

- [ ] **Step 1: Write the failing test**

Async Server Components can't be rendered by React Testing Library, so this is a source-level guard in the same style as the seed and roles tests. The real proof is the HTTP check in Step 5.

```typescript
// tests/unit/rsc-boundaries.test.ts
import { readFileSync } from 'fs';
import { join } from 'path';

const SERVER_PAGES = [
  'app/(store)/search/page.tsx',
  'app/(store)/products/[slug]/page.tsx',
  'app/(store)/category/[slug]/page.tsx',
  'app/(account)/orders/[id]/page.tsx',
];

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf-8');
}

describe('server component boundaries', () => {
  it.each(SERVER_PAGES)('%s passes no event handlers', path => {
    const source = read(path);
    if (source.includes("'use client'")) return;
    expect(source).not.toMatch(/\bon[A-Z][a-zA-Z]*=\{/);
  });

  it.each(SERVER_PAGES)('%s types its dynamic props as Promises', path => {
    const source = read(path);
    if (/\bparams:/.test(source)) {
      expect(source).toMatch(/params:\s*Promise</);
    }
    if (/\bsearchParams:/.test(source)) {
      expect(source).toMatch(/searchParams:\s*Promise</);
    }
  });

  it('search page awaits searchParams before reading properties', () => {
    const source = read('app/(store)/search/page.tsx');
    expect(source).toMatch(/await\s+searchParams/);
    expect(source).not.toMatch(/searchParams\.q\b/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/rsc-boundaries.test.ts`
Expected: FAIL — the search page has `onClick={`, all four type `params`/`searchParams` as plain objects, and the search page reads `searchParams.q` directly.

- [ ] **Step 3: Replace the onClick button with the pattern the file already uses**

`app/(store)/search/page.tsx` lines 239–257 render a "clear search" button using `onClick` and raw DOM manipulation. Twenty lines further down the same file already solves this with `asChild` + `Link`. Use that — clearing the query is just navigation to `/search` with no parameters, and it needs no client component at all.

Replace lines 239–257 (the whole `{query && ( <Button ... onClick={...}> ... </Button> )}` block) with:

```tsx
              {query && (
                <Button
                  asChild
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1 h-8 w-8 p-0"
                >
                  <Link href="/search" aria-label="Clear search">
                    <X className="h-4 w-4" />
                  </Link>
                </Button>
              )}
```

`Link` and `X` are already imported at the top of the file. This also fixes an accessibility gap — the original button had no accessible name.

- [ ] **Step 4: Make the dynamic props Promises and await them**

In `app/(store)/search/page.tsx`, change the interface at lines 16–24:

```tsx
interface SearchPageProps {
  searchParams: Promise<{
    q?: string;
    sort?: string;
    category?: string;
    minPrice?: string;
    maxPrice?: string;
    page?: string;
  }>;
}

type ResolvedSearchParams = Awaited<SearchPageProps['searchParams']>;
```

In `generateMetadata`, await before reading:

```tsx
export async function generateMetadata({
  searchParams,
}: SearchPageProps): Promise<Metadata> {
  const { q } = await searchParams;
  const query = q || '';
```

Change `SearchResults` to take the already-resolved object:

```tsx
async function SearchResults({
  searchParams,
}: {
  searchParams: ResolvedSearchParams;
}) {
```

Its body then works unchanged — it is reading a plain object by that point.

In the default export, await once and pass the resolved value down. Find `export default async function SearchPage({ searchParams }: SearchPageProps)` and add as its first line:

```tsx
  const resolvedSearchParams = await searchParams;
```

Then replace every remaining `searchParams` reference in that function body with `resolvedSearchParams` — including the `{...searchParams}` spreads inside the `new URLSearchParams({...})` calls around lines 300–330, and the `<SearchResults searchParams={searchParams} />` near line 345. Verify none are left:

```bash
grep -n "searchParams" "app/(store)/search/page.tsx"
```

Expected: matches only in the interface, the `await searchParams` lines, the prop type, and `resolvedSearchParams` assignments — no bare `searchParams.` property reads.

- [ ] **Step 5: Apply the same treatment to the three other dynamic routes**

Each declares `params: { ... }` and reads `params.slug` or `params.id` synchronously. For each of `app/(store)/products/[slug]/page.tsx`, `app/(store)/category/[slug]/page.tsx`, and `app/(account)/orders/[id]/page.tsx`:

Change the interface to wrap the object in `Promise<>`:

```tsx
interface ProductPageProps {
  params: Promise<{
    slug: string;
  }>;
}
```

Then in both `generateMetadata` and the default export, destructure with await as the first statement:

```tsx
  const { slug } = await params;
```

and replace `params.slug` with `slug` throughout. For the orders page the field is `id`, not `slug`.

- [ ] **Step 6: Run tests and typecheck**

```bash
npx jest tests/unit/rsc-boundaries.test.ts
npm run type-check
```

Expected: PASS, and `tsc --noEmit` exits 0. TypeScript will point at any `params.slug` read you missed, since the type is now a Promise.

- [ ] **Step 7: Verify over HTTP — this is the real proof**

With `npm run dev` running:

```bash
for R in "/" "/search?q=iphone" "/search" "/products/iphone-15-pro" "/cart"; do
  printf "  %-28s HTTP %s\n" "$R" "$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000$R")"
done
```

Expected: all `200`. Before this task `/search?q=iphone` returned `500`.

Then confirm the dev log is clean of the two error classes:

```bash
grep -cE "Event handlers cannot be passed|should be awaited before using" <dev-server-log>
```

Expected: `0` new occurrences after a fresh request.

- [ ] **Step 8: Commit**

```bash
git add "app/(store)/search/page.tsx" "app/(store)/products/[slug]/page.tsx" "app/(store)/category/[slug]/page.tsx" "app/(account)/orders/[id]/page.tsx" tests/unit/rsc-boundaries.test.ts
git commit -m "fix(search): remove server-component event handler and await dynamic params"
```

## Task 7: Build the dummy checkout action

**Files:**
- Create: `server/actions/checkout-demo.ts`, `tests/unit/checkout-demo.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/checkout-demo.test.ts
jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    cart: { findUnique: jest.fn() },
    order: { create: jest.fn() },
    orderItem: { create: jest.fn() },
    inventory: { findUnique: jest.fn(), update: jest.fn() },
    cartItem: { deleteMany: jest.fn() },
  },
}));
jest.mock('@/lib/roles', () => ({ getCurrentUser: jest.fn() }));
jest.mock('next/cache', () => ({ revalidateTag: jest.fn() }));

import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/roles';
import { placeDemoOrder } from '@/server/actions/checkout-demo';

const mockPrisma = prisma as any;
const mockGetCurrentUser = getCurrentUser as jest.Mock;

function buildForm() {
  const form = new FormData();
  form.set('shippingName', 'John Doe');
  form.set('shippingAddress', '123 Main St');
  form.set('shippingCity', 'New York');
  form.set('shippingState', 'NY');
  form.set('shippingZip', '10001');
  form.set('customerPhone', '+1234567890');
  return form;
}

describe('placeDemoOrder', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuses when there is no session', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    await expect(placeDemoOrder(buildForm())).resolves.toEqual({
      success: false,
      error: 'Authentication required',
    });
  });

  it('refuses when the cart is empty', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'user_a', email: 'a@x.com' });
    mockPrisma.cart.findUnique.mockResolvedValue({ id: 'cart_1', items: [] });
    await expect(placeDemoOrder(buildForm())).resolves.toEqual({
      success: false,
      error: 'Cart is empty',
    });
    expect(mockPrisma.order.create).not.toHaveBeenCalled();
  });

  it('creates an order with 8% tax and flat 9.99 shipping', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'user_a', email: 'a@x.com' });
    mockPrisma.cart.findUnique.mockResolvedValue({
      id: 'cart_1',
      items: [
        {
          productId: 'prod_1',
          quantity: 2,
          product: { id: 'prod_1', name: 'Runner', price: 50, sku: 'SKU1' },
        },
      ],
    });
    mockPrisma.order.create.mockResolvedValue({ id: 'order_1', orderNumber: 'ORD-1' });
    mockPrisma.inventory.findUnique.mockResolvedValue({
      productId: 'prod_1',
      quantity: 10,
      available: 10,
    });

    const result = await placeDemoOrder(buildForm());

    expect(result.success).toBe(true);
    expect(result.orderId).toBe('order_1');

    const created = mockPrisma.order.create.mock.calls[0][0].data;
    expect(created.subtotal).toBe(100);
    expect(created.tax).toBeCloseTo(8, 5);
    expect(created.shipping).toBe(9.99);
    expect(created.total).toBeCloseTo(117.99, 5);
    expect(created.status).toBe('PENDING');
    expect(created.userId).toBe('user_a');
  });

  it('decrements inventory and clears the cart', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'user_a', email: 'a@x.com' });
    mockPrisma.cart.findUnique.mockResolvedValue({
      id: 'cart_1',
      items: [
        {
          productId: 'prod_1',
          quantity: 2,
          product: { id: 'prod_1', name: 'Runner', price: 50, sku: 'SKU1' },
        },
      ],
    });
    mockPrisma.order.create.mockResolvedValue({ id: 'order_1', orderNumber: 'ORD-1' });
    mockPrisma.inventory.findUnique.mockResolvedValue({
      productId: 'prod_1',
      quantity: 10,
      available: 10,
    });

    await placeDemoOrder(buildForm());

    expect(mockPrisma.inventory.update).toHaveBeenCalledWith({
      where: { productId: 'prod_1' },
      data: { quantity: 8, available: 8 },
    });
    expect(mockPrisma.cartItem.deleteMany).toHaveBeenCalledWith({
      where: { cartId: 'cart_1' },
    });
  });

  it('never records Stripe payment fields', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'user_a', email: 'a@x.com' });
    mockPrisma.cart.findUnique.mockResolvedValue({
      id: 'cart_1',
      items: [
        {
          productId: 'prod_1',
          quantity: 1,
          product: { id: 'prod_1', name: 'Runner', price: 10, sku: 'SKU1' },
        },
      ],
    });
    mockPrisma.order.create.mockResolvedValue({ id: 'order_1', orderNumber: 'ORD-1' });
    mockPrisma.inventory.findUnique.mockResolvedValue({
      productId: 'prod_1',
      quantity: 4,
      available: 4,
    });

    await placeDemoOrder(buildForm());

    const created = mockPrisma.order.create.mock.calls[0][0].data;
    expect(created.stripePaymentIntentId).toBeUndefined();
    expect(created.stripeSessionId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/checkout-demo.test.ts`
Expected: FAIL — `Cannot find module '@/server/actions/checkout-demo'`.

- [ ] **Step 3: Write the implementation**

```typescript
// server/actions/checkout-demo.ts
'use server';

import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/roles';
import { revalidateTag } from 'next/cache';

const TAX_RATE = 0.08;
const FLAT_SHIPPING = 9.99;

export type PlaceDemoOrderResult =
  | { success: true; orderId: string; orderNumber: string }
  | { success: false; error: string };

export async function placeDemoOrder(
  formData: FormData
): Promise<PlaceDemoOrderResult> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Authentication required' };
    }

    const cart = await prisma.cart.findUnique({
      where: { userId: user.id },
      include: { items: { include: { product: true } } },
    });

    if (!cart || cart.items.length === 0) {
      return { success: false, error: 'Cart is empty' };
    }

    const subtotal = cart.items.reduce(
      (sum, item) => sum + Number(item.product.price) * item.quantity,
      0
    );
    const tax = subtotal * TAX_RATE;
    const total = subtotal + tax + FLAT_SHIPPING;

    const order = await prisma.order.create({
      data: {
        orderNumber: `ORD-${Date.now()}`,
        status: 'PENDING',
        subtotal,
        tax,
        shipping: FLAT_SHIPPING,
        total,
        currency: 'USD',
        customerEmail: user.email ?? '',
        customerPhone: (formData.get('customerPhone') as string) || null,
        shippingName: formData.get('shippingName') as string,
        shippingAddress: formData.get('shippingAddress') as string,
        shippingCity: formData.get('shippingCity') as string,
        shippingState: (formData.get('shippingState') as string) || null,
        shippingZip: formData.get('shippingZip') as string,
        shippingCountry: 'US',
        shippingMethod: 'standard',
        userId: user.id,
      },
    });

    for (const item of cart.items) {
      await prisma.orderItem.create({
        data: {
          quantity: item.quantity,
          price: item.product.price,
          productName: item.product.name,
          productSku: item.product.sku,
          orderId: order.id,
          productId: item.productId,
        },
      });

      const inventory = await prisma.inventory.findUnique({
        where: { productId: item.productId },
      });

      if (inventory) {
        await prisma.inventory.update({
          where: { productId: item.productId },
          data: {
            quantity: Math.max(0, inventory.quantity - item.quantity),
            available: Math.max(0, inventory.available - item.quantity),
          },
        });
      }
    }

    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });

    revalidateTag('orders');
    revalidateTag('products');

    return {
      success: true,
      orderId: order.id,
      orderNumber: order.orderNumber,
    };
  } catch (error) {
    console.error('Place demo order error:', error);
    return { success: false, error: 'Failed to place order' };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/checkout-demo.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add server/actions/checkout-demo.ts tests/unit/checkout-demo.test.ts
git commit -m "feat(checkout): add dummy order placement without payment processing"
```

## Task 8: Build the sign-in page with one-click demo login

**Files:**
- Create: `app/auth/signin/page.tsx`, `app/auth/signin/signin-form.tsx`
- Test: `tests/unit/signin-form.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/signin-form.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { signIn } from 'next-auth/react';
import SignInForm from '@/app/auth/signin/signin-form';

jest.mock('next-auth/react', () => ({ signIn: jest.fn() }));

const mockSignIn = signIn as jest.Mock;

describe('SignInForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSignIn.mockResolvedValue({ ok: true, error: null });
  });

  it('offers a one-click demo login', () => {
    render(<SignInForm callbackUrl="/" />);
    expect(
      screen.getByRole('button', { name: /sign in as demo customer/i })
    ).toBeInTheDocument();
  });

  it('signs in with the seeded demo credentials on one click', async () => {
    render(<SignInForm callbackUrl="/orders" />);
    fireEvent.click(
      screen.getByRole('button', { name: /sign in as demo customer/i })
    );

    await waitFor(() =>
      expect(mockSignIn).toHaveBeenCalledWith('credentials', {
        email: 'customer@example.com',
        password: 'demo1234',
        callbackUrl: '/orders',
      })
    );
  });

  it('surfaces an error when credentials are rejected', async () => {
    mockSignIn.mockResolvedValue({ ok: false, error: 'CredentialsSignin' });
    render(<SignInForm callbackUrl="/" />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'nobody@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /invalid email or password/i
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/signin-form.test.tsx`
Expected: FAIL — `Cannot find module '@/app/auth/signin/signin-form'`.

- [ ] **Step 3: Write the client component**

```tsx
// app/auth/signin/signin-form.tsx
'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';

const DEMO_EMAIL = 'customer@example.com';
const DEMO_PASSWORD = 'demo1234';

export default function SignInForm({ callbackUrl }: { callbackUrl: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function attempt(nextEmail: string, nextPassword: string) {
    setPending(true);
    setError(null);

    const result = await signIn('credentials', {
      email: nextEmail,
      password: nextPassword,
      callbackUrl,
    });

    if (result && !result.ok) {
      setError('Invalid email or password.');
    }
    setPending(false);
  }

  return (
    <div className="mx-auto w-full max-w-sm space-y-6">
      <button
        type="button"
        disabled={pending}
        onClick={() => attempt(DEMO_EMAIL, DEMO_PASSWORD)}
        className="w-full rounded-md bg-black px-4 py-2 text-white disabled:opacity-50"
      >
        Sign in as demo customer
      </button>

      <p className="text-center text-sm text-gray-500">
        or use your own credentials
      </p>

      <form
        onSubmit={e => {
          e.preventDefault();
          attempt(email, password);
        }}
        className="space-y-4"
      >
        <div className="space-y-1">
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full rounded-md border px-3 py-2"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full rounded-md border px-3 py-2"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md border px-4 py-2 disabled:opacity-50"
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Write the page shell**

```tsx
// app/auth/signin/page.tsx
import SignInForm from './signin-form';

export const metadata = { title: 'Sign in' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;

  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center px-4">
      <h1 className="mb-8 text-2xl font-semibold">Sign in</h1>
      <SignInForm callbackUrl={callbackUrl ?? '/'} />
    </main>
  );
}
```

`searchParams` is a Promise in Next.js 15 — awaiting it is required, not optional.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/unit/signin-form.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 6: Verify manually**

With `npm run dev` running, open `http://localhost:3000/orders`. Expected: redirect to `/auth/signin?callbackUrl=%2Forders`, which now renders. Click "Sign in as demo customer". Expected: you land on `/orders` authenticated. That route still 404s until Task 10 — confirm the redirect and session, not the destination.

- [ ] **Step 7: Commit**

```bash
git add app/auth tests/unit/signin-form.test.tsx
git commit -m "feat(auth): add sign-in page with one-click demo login"
```

## Task 9: Build the checkout page

**Files:**
- Create: `app/(store)/checkout/page.tsx`, `app/(store)/checkout/checkout-form.tsx`
- Test: `tests/unit/checkout-form.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/checkout-form.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CheckoutForm from '@/app/(store)/checkout/checkout-form';
import { placeDemoOrder } from '@/server/actions/checkout-demo';

jest.mock('@/server/actions/checkout-demo', () => ({
  placeDemoOrder: jest.fn(),
}));
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

const mockPlace = placeDemoOrder as jest.Mock;

describe('CheckoutForm', () => {
  beforeEach(() => jest.clearAllMocks());

  it('pre-fills a demo shipping address so checkout is one click', () => {
    render(<CheckoutForm total={117.99} />);
    expect(screen.getByLabelText(/full name/i)).toHaveValue('John Doe');
    expect(screen.getByLabelText(/address/i)).toHaveValue('123 Main St');
    expect(screen.getByLabelText(/city/i)).toHaveValue('New York');
    expect(screen.getByLabelText(/zip/i)).toHaveValue('10001');
  });

  it('states plainly that no payment is taken', () => {
    render(<CheckoutForm total={117.99} />);
    expect(screen.getByText(/no payment will be taken/i)).toBeInTheDocument();
  });

  it('redirects to the order on success', async () => {
    mockPlace.mockResolvedValue({
      success: true,
      orderId: 'order_1',
      orderNumber: 'ORD-1',
    });
    render(<CheckoutForm total={117.99} />);

    fireEvent.click(screen.getByRole('button', { name: /place order/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/orders/order_1'));
  });

  it('surfaces the error and does not redirect on failure', async () => {
    mockPlace.mockResolvedValue({ success: false, error: 'Cart is empty' });
    render(<CheckoutForm total={0} />);

    fireEvent.click(screen.getByRole('button', { name: /place order/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Cart is empty');
    expect(mockPush).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/checkout-form.test.tsx`
Expected: FAIL — `Cannot find module '@/app/(store)/checkout/checkout-form'`.

- [ ] **Step 3: Write the client component**

```tsx
// app/(store)/checkout/checkout-form.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { placeDemoOrder } from '@/server/actions/checkout-demo';

const DEMO_ADDRESS = {
  shippingName: 'John Doe',
  shippingAddress: '123 Main St',
  shippingCity: 'New York',
  shippingState: 'NY',
  shippingZip: '10001',
  customerPhone: '+1234567890',
};

export default function CheckoutForm({ total }: { total: number }) {
  const router = useRouter();
  const [values, setValues] = useState(DEMO_ADDRESS);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function update(field: keyof typeof DEMO_ADDRESS, value: string) {
    setValues(prev => ({ ...prev, [field]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const formData = new FormData();
    Object.entries(values).forEach(([key, value]) => formData.set(key, value));

    const result = await placeDemoOrder(formData);

    if (result.success) {
      router.push(`/orders/${result.orderId}`);
    } else {
      setError(result.error);
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="shippingName" className="block text-sm font-medium">
          Full name
        </label>
        <input
          id="shippingName"
          value={values.shippingName}
          onChange={e => update('shippingName', e.target.value)}
          className="w-full rounded-md border px-3 py-2"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="shippingAddress" className="block text-sm font-medium">
          Address
        </label>
        <input
          id="shippingAddress"
          value={values.shippingAddress}
          onChange={e => update('shippingAddress', e.target.value)}
          className="w-full rounded-md border px-3 py-2"
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <label htmlFor="shippingCity" className="block text-sm font-medium">
            City
          </label>
          <input
            id="shippingCity"
            value={values.shippingCity}
            onChange={e => update('shippingCity', e.target.value)}
            className="w-full rounded-md border px-3 py-2"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="shippingState" className="block text-sm font-medium">
            State
          </label>
          <input
            id="shippingState"
            value={values.shippingState}
            onChange={e => update('shippingState', e.target.value)}
            className="w-full rounded-md border px-3 py-2"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="shippingZip" className="block text-sm font-medium">
            ZIP
          </label>
          <input
            id="shippingZip"
            value={values.shippingZip}
            onChange={e => update('shippingZip', e.target.value)}
            className="w-full rounded-md border px-3 py-2"
          />
        </div>
      </div>

      <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Demo checkout — no payment will be taken and no card details are collected.
      </p>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-black px-4 py-3 text-white disabled:opacity-50"
      >
        {pending ? 'Placing order…' : `Place order — $${total.toFixed(2)}`}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Write the page shell**

```tsx
// app/(store)/checkout/page.tsx
import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/roles';
import CheckoutForm from './checkout-form';

export const metadata = { title: 'Checkout' };

const TAX_RATE = 0.08;
const FLAT_SHIPPING = 9.99;

export default async function CheckoutPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/auth/signin?callbackUrl=%2Fcheckout');
  }

  const cart = await prisma.cart.findUnique({
    where: { userId: user.id },
    include: { items: { include: { product: true } } },
  });

  if (!cart || cart.items.length === 0) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="mb-4 text-2xl font-semibold">Checkout</h1>
        <p className="text-gray-600">Your cart is empty.</p>
      </main>
    );
  }

  const subtotal = cart.items.reduce(
    (sum, item) => sum + Number(item.product.price) * item.quantity,
    0
  );
  const total = subtotal + subtotal * TAX_RATE + FLAT_SHIPPING;

  return (
    <main className="mx-auto max-w-lg px-4 py-12">
      <h1 className="mb-8 text-2xl font-semibold">Checkout</h1>
      <CheckoutForm total={total} />
    </main>
  );
}
```

- [ ] **Step 5: Link the cart page to checkout**

Open `app/(store)/cart/page.tsx` and add a link to `/checkout` beside the totals. Match the existing button styling in that file rather than importing new components.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest tests/unit/checkout-form.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add "app/(store)/checkout" "app/(store)/cart/page.tsx" tests/unit/checkout-form.test.tsx
git commit -m "feat(checkout): add demo checkout page with no payment step"
```

## Task 10: Build the missing orders list page

**Files:**
- Create: `app/(account)/orders/page.tsx`

- [ ] **Step 1: Confirm the route currently 404s**

With the dev server running and signed in as the demo customer, open `http://localhost:3000/orders`.
Expected: Next.js 404 page. This is the bug being fixed.

- [ ] **Step 2: Write the page**

`getUserOrders` at `server/queries/orders.ts:117` takes a `userId` it does not verify (finding 9). Pass the session user's own id and never a value from the request.

```tsx
// app/(account)/orders/page.tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/roles';
import { getUserOrders } from '@/server/queries/orders';

export const metadata = { title: 'Your orders' };

export default async function OrdersPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/auth/signin?callbackUrl=%2Forders');
  }

  const { orders } = await getUserOrders(user.id);

  if (orders.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="mb-4 text-2xl font-semibold">Your orders</h1>
        <p className="text-gray-600">You have not placed any orders yet.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-8 text-2xl font-semibold">Your orders</h1>
      <ul className="space-y-4">
        {orders.map(order => (
          <li key={order.id} className="rounded-lg border p-4">
            <Link href={`/orders/${order.id}`} className="flex justify-between">
              <span>
                <span className="font-medium">{order.orderNumber}</span>
                <span className="ml-3 rounded-full bg-gray-100 px-2 py-0.5 text-xs">
                  {order.status}
                </span>
              </span>
              <span className="font-medium">
                ${Number(order.total).toFixed(2)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 3: Verify the return shape of `getUserOrders`**

Read `server/queries/orders.ts:117-160`. If it returns a bare array rather than `{ orders, total }`, change the destructuring above to match. Do not guess — read it.

- [ ] **Step 4: Verify manually**

Reload `http://localhost:3000/orders`. Expected: the seeded `PENDING` order is listed, and clicking it opens the existing detail page.

- [ ] **Step 5: Run the full test suite**

```bash
npx jest
npm run type-check
```

Expected: all tests PASS, `tsc --noEmit` exits 0.

- [ ] **Step 6: Commit**

```bash
git add "app/(account)/orders/page.tsx"
git commit -m "feat(orders): add missing orders list page"
```

## Task 11: Prepare the build for a clean deploy

**Files:**
- Modify: `prisma/schema.prisma:7-10`, `package.json` scripts

- [ ] **Step 1: Add `directUrl` to the datasource**

Replace `prisma/schema.prisma` lines 7–10:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

- [ ] **Step 2: Make the build Prisma-aware**

In `package.json`, change the `build` script and add `postinstall`:

```json
    "build": "prisma generate && next build",
    "postinstall": "prisma generate",
    "db:migrate:deploy": "prisma migrate deploy",
```

Keep every existing script; only add these and replace `build`.

- [ ] **Step 3: Verify a clean build from scratch**

```bash
rm -rf .next node_modules
npm install
npm run build
```

Expected: `Generated Prisma Client` appears during install *and* during build, and the build completes with a route summary. This proves Railway will succeed.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma package.json
git commit -m "build: add directUrl and generate prisma client during build"
```

## Task 12: Provision Supabase Postgres

- [ ] **Step 1: Confirm the existing project**

The project already exists — do not create another. Supabase project `MCP_ECOM`, ref `ywhjahfylvfvhgzsklpg`, `https://ywhjahfylvfvhgzsklpg.supabase.co`, nano compute, healthy, zero migrations applied. Pick the Railway region in Task 13 to match this project's region.

- [ ] **Step 2: Collect both connection strings**

From Project Settings → Database → Connection string. Both contain the ref `ywhjahfylvfvhgzsklpg`:

- **Transaction pooler** (port `6543`) → this becomes `DATABASE_URL`. Append `?pgbouncer=true&connection_limit=1`.
- **Direct connection** (port `5432`) → this becomes `DIRECT_URL`.

The `pgbouncer=true` flag is required: Prisma otherwise issues prepared statements the transaction pooler cannot handle, and you get intermittent `prepared statement "s0" already exists` errors under load.

- [ ] **Step 3: Run the migrations against Supabase from your machine**

```bash
DATABASE_URL="<pooled-url>" DIRECT_URL="<direct-url>" npx prisma migrate deploy
```

Expected: all three migrations in `prisma/migrations/` applied.

- [ ] **Step 4: Seed Supabase**

```bash
DATABASE_URL="<pooled-url>" DIRECT_URL="<direct-url>" npm run db:seed
```

Expected: the same seed output as local.

- [ ] **Step 5: Verify from the Supabase SQL editor**

```sql
select email, (password is not null) as has_password, role from users;
select count(*) from products;
select "orderNumber", status from orders;
```

Expected: two users both with `has_password = true`, a non-zero product count, and one `PENDING` order. If `has_password` is false, Task 3 was not applied before seeding — re-run the seed.

## Task 13: Deploy to Railway

- [ ] **Step 1: Push your branch**

```bash
git push -u origin m1-deploy-storefront
```

- [ ] **Step 2: Add the web service to the existing Railway project**

The project already exists and is empty — do not create another. In Railway project `mcp_ecom`, add a service named `web` connected to your GitHub repo, targeting the `m1-deploy-storefront` branch. Railway detects `output: 'standalone'` and the Node builder automatically; you do not need to point it at `docker/Dockerfile`.

Keep the project empty of other services for now. The Python MCP service is added to this same project at M3 so the two share Railway's private network.

- [ ] **Step 3: Set environment variables**

Set exactly these on the service. Generate the secret with `openssl rand -base64 32`.

```
DATABASE_URL=<supabase-pooled-url-with-pgbouncer-flag>
DIRECT_URL=<supabase-direct-url>
NEXTAUTH_SECRET=<generated-secret>
NEXTAUTH_URL=https://<railway-generated-domain>
NEXT_PUBLIC_APP_NAME=MCP Commerce
NEXT_PUBLIC_APP_URL=https://<railway-generated-domain>
ADMIN_EMAIL=admin@example.com
NODE_ENV=production
```

Set no `STRIPE_*`, `GOOGLE_*`, `EMAIL_*`, or `RESEND_API_KEY` variables. Their absence is now intentional and handled by Tasks 5 and 6.

- [ ] **Step 4: Generate the public domain**

Generate a domain on the service, then update `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` to that exact value and redeploy. A mismatched `NEXTAUTH_URL` produces a sign-in redirect loop, which is the single most common failure at this step.

- [ ] **Step 5: Watch the deploy logs**

Expected in order: `Generated Prisma Client`, a Next.js route summary, then `Ready`. If the build fails at Prisma generation, Task 11 Step 2 was not applied.

## Task 14: Verify the deployed demo end-to-end

- [ ] **Step 1: Walk the full path on the public URL**

Against `https://<railway-domain>`, confirm each in order:

1. Homepage renders with seeded products and images.
2. Search returns results.
3. A product detail page loads.
4. `/orders` redirects to `/auth/signin?callbackUrl=%2Forders`.
5. "Sign in as demo customer" signs you in and lands on `/orders`.
6. The seeded `PENDING` order is listed.
7. Add a product to the cart; the cart shows it.
8. `/checkout` shows the pre-filled address and the "no payment will be taken" notice.
9. "Place order" redirects to the new order's detail page.
10. `/orders` now lists two orders.

- [ ] **Step 2: Confirm Stripe is genuinely absent**

```bash
grep -rn "stripe" --include=*.ts --include=*.tsx app components server lib
```

Expected: matches only in `prisma/schema.prisma` (the unused `stripePaymentIntentId` / `stripeSessionId` columns, which stay — dropping them is a needless migration).

- [ ] **Step 3: Capture the M1 scorecard**

This is the milestone gate. `SCORECARD_BASE_URL` makes it probe the live deployment, so M1 is the first entry with latency numbers.

```bash
SCORECARD_BASE_URL="https://<railway-domain>" npm run scorecard -- m1-storefront --gate
```

Expected: exits 0 with "No regressions." Against the `m0-upstream` baseline the absolute gates apply — tests must be 100% passing and type errors must be 0.

If it exits 1, do not proceed. Either fix the regression, or open `metrics/scorecard.json`, add the offending metric key to `acceptedRegressions` on the newest entry **with a reason in the commit message**, and re-run. Coverage dropping because Task 6 deleted three files is a legitimate acceptance; failing tests are not.

- [ ] **Step 4: Merge and tag**

```bash
git add metrics/scorecard.json
git commit -m "chore(metrics): capture m1 scorecard"
git checkout main
git merge m1-deploy-storefront
git tag m1-storefront-live
git push origin main --tags
```

---

# Milestone M2 — REST API Layer

**Exit criteria:** Every capability in the source plan's §1.2 map is reachable over authenticated HTTP and verified with curl, and a request authenticated as user A cannot read or mutate user B's data.

**Design rule that governs every task here:** identity comes from the session, never from the request. `requireApiUser()` is the only place identity is resolved. No route handler accepts a `userId` parameter from a query string, path segment, or body. This is the source plan's §1.4 made concrete, and it is load-bearing because finding 9 shows the query layer will not enforce it for you.

## Task 15: Build the API session helper and response envelope

**Files:**
- Create: `app/api/v1/_lib/session.ts`, `app/api/v1/_lib/respond.ts`
- Test: `tests/integration/api-v1-session.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/api-v1-session.test.ts
jest.mock('next-auth/jwt', () => ({ getToken: jest.fn() }));

import { getToken } from 'next-auth/jwt';
import { NextRequest } from 'next/server';
import { requireApiUser } from '@/app/api/v1/_lib/session';
import { ok, fail } from '@/app/api/v1/_lib/respond';

const mockGetToken = getToken as jest.Mock;

function req() {
  return new NextRequest('https://example.com/api/v1/orders');
}

describe('requireApiUser', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the user when a valid token is present', async () => {
    mockGetToken.mockResolvedValue({ sub: 'user_a', email: 'a@x.com', role: 'USER' });
    await expect(requireApiUser(req())).resolves.toEqual({
      id: 'user_a',
      email: 'a@x.com',
      role: 'USER',
    });
  });

  it('returns null when no token is present', async () => {
    mockGetToken.mockResolvedValue(null);
    await expect(requireApiUser(req())).resolves.toBeNull();
  });

  it('returns null when the token has no subject', async () => {
    mockGetToken.mockResolvedValue({ email: 'a@x.com' });
    await expect(requireApiUser(req())).resolves.toBeNull();
  });
});

describe('response envelope', () => {
  it('wraps success payloads under data', async () => {
    const body = await ok({ id: 'x' }).json();
    expect(body).toEqual({ data: { id: 'x' } });
  });

  it('serialises Decimal-like values as numbers', async () => {
    const decimalish = { toFixed: () => '10.50', toString: () => '10.50' };
    const body = await ok({ price: decimalish }).json();
    expect(body.data.price).toBe('10.50');
  });

  it('returns the given status and message on failure', async () => {
    const response = fail(403, 'Forbidden');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/integration/api-v1-session.test.ts`
Expected: FAIL — both modules missing.

- [ ] **Step 3: Write `session.ts`**

```typescript
// app/api/v1/_lib/session.ts
import { getToken } from 'next-auth/jwt';
import type { NextRequest } from 'next/server';

export type ApiUser = {
  id: string;
  email: string | null;
  role: string;
};

export async function requireApiUser(req: NextRequest): Promise<ApiUser | null> {
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
    cookieName:
      process.env.NODE_ENV === 'production'
        ? '__Secure-next-auth.session-token'
        : 'next-auth.session-token',
  });

  if (!token?.sub) return null;

  return {
    id: token.sub,
    email: (token.email as string) ?? null,
    role: (token.role as string) ?? 'USER',
  };
}
```

- [ ] **Step 4: Write `respond.ts`**

Prisma returns `Decimal` for money columns, which `JSON.stringify` renders as an object. Normalise it once here rather than in every route.

```typescript
// app/api/v1/_lib/respond.ts
import { NextResponse } from 'next/server';

function normalise(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(normalise);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.toFixed === 'function' && typeof obj.toString === 'function') {
      return obj.toString();
    }
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, normalise(v)])
    );
  }
  return value;
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ data: normalise(data) }, { status });
}

export function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/integration/api-v1-session.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add app/api/v1/_lib tests/integration/api-v1-session.test.ts
git commit -m "feat(api): add v1 session helper and response envelope"
```

## Task 16: Product read routes

**Files:**
- Create: `app/api/v1/products/route.ts`, `app/api/v1/products/[id]/route.ts`, `app/api/v1/products/[id]/inventory/route.ts`
- Test: `tests/integration/api-v1-products.test.ts`

- [ ] **Step 1: Read the real signatures before writing anything**

```bash
sed -n '200,240p' server/queries/products.ts
sed -n '89,130p' server/queries/products.ts
sed -n '100,160p' server/queries/inventory.ts
```

`searchProducts` accepts either a bare string or `{ query, page, limit, sort, categoryFilter, minPrice, maxPrice }`. It has **no rating filter** — Task 18 adds one. Write the route against what you actually read, not against this plan's summary.

- [ ] **Step 2: Write the failing test**

```typescript
// tests/integration/api-v1-products.test.ts
jest.mock('@/server/queries/products', () => ({
  searchProducts: jest.fn(),
  getProductById: jest.fn(),
}));
jest.mock('@/server/queries/inventory', () => ({ getInventory: jest.fn() }));

import { NextRequest } from 'next/server';
import { searchProducts, getProductById } from '@/server/queries/products';
import { GET as listProducts } from '@/app/api/v1/products/route';
import { GET as getProduct } from '@/app/api/v1/products/[id]/route';

const mockSearch = searchProducts as unknown as jest.Mock;
const mockGetById = getProductById as unknown as jest.Mock;

describe('GET /api/v1/products', () => {
  beforeEach(() => jest.clearAllMocks());

  it('passes query and price filters through to searchProducts', async () => {
    mockSearch.mockResolvedValue({ products: [], total: 0 });
    const req = new NextRequest(
      'https://x.test/api/v1/products?q=headphones&maxPrice=10000&limit=5'
    );

    await listProducts(req);

    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'headphones', maxPrice: 10000, limit: 5 })
    );
  });

  it('returns results under a data envelope', async () => {
    mockSearch.mockResolvedValue({ products: [{ id: 'p1' }], total: 1 });
    const req = new NextRequest('https://x.test/api/v1/products?q=x');

    const body = await (await listProducts(req)).json();

    expect(body.data.products).toEqual([{ id: 'p1' }]);
  });

  it('caps limit at 50 so an agent cannot request the whole catalogue', async () => {
    mockSearch.mockResolvedValue({ products: [], total: 0 });
    const req = new NextRequest('https://x.test/api/v1/products?q=x&limit=9999');

    await listProducts(req);

    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 })
    );
  });
});

describe('GET /api/v1/products/[id]', () => {
  beforeEach(() => jest.clearAllMocks());

  it('404s for an unknown product', async () => {
    mockGetById.mockResolvedValue(null);
    const res = await getProduct(
      new NextRequest('https://x.test/api/v1/products/nope'),
      { params: Promise.resolve({ id: 'nope' }) }
    );
    expect(res.status).toBe(404);
  });

  it('returns the product when found', async () => {
    mockGetById.mockResolvedValue({ id: 'p1', name: 'Runner' });
    const res = await getProduct(
      new NextRequest('https://x.test/api/v1/products/p1'),
      { params: Promise.resolve({ id: 'p1' }) }
    );
    const body = await res.json();
    expect(body.data.name).toBe('Runner');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest tests/integration/api-v1-products.test.ts`
Expected: FAIL — route modules missing.

- [ ] **Step 4: Write the list route**

```typescript
// app/api/v1/products/route.ts
import type { NextRequest } from 'next/server';
import { searchProducts } from '@/server/queries/products';
import { ok, fail } from '../_lib/respond';

const MAX_LIMIT = 50;

function num(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const requestedLimit = num(params.get('limit')) ?? 20;

    const result = await searchProducts({
      query: params.get('q') ?? '',
      page: num(params.get('page')) ?? 1,
      limit: Math.min(requestedLimit, MAX_LIMIT),
      sort: params.get('sort') ?? undefined,
      categoryFilter: params.get('category') ?? undefined,
      minPrice: num(params.get('minPrice')),
      maxPrice: num(params.get('maxPrice')),
    });

    return ok(result);
  } catch (error) {
    console.error('GET /api/v1/products failed:', error);
    return fail(500, 'Failed to search products');
  }
}
```

Products are public on the storefront, so this route is deliberately unauthenticated. Every route below is not.

- [ ] **Step 5: Write the detail and inventory routes**

```typescript
// app/api/v1/products/[id]/route.ts
import type { NextRequest } from 'next/server';
import { getProductById } from '@/server/queries/products';
import { ok, fail } from '../../_lib/respond';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const product = await getProductById(id);

    if (!product) return fail(404, 'Product not found');

    return ok(product);
  } catch (error) {
    console.error('GET /api/v1/products/[id] failed:', error);
    return fail(500, 'Failed to load product');
  }
}
```

```typescript
// app/api/v1/products/[id]/inventory/route.ts
import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { ok, fail } from '../../../_lib/respond';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const inventory = await prisma.inventory.findUnique({
      where: { productId: id },
      select: { productId: true, quantity: true, reserved: true, available: true },
    });

    if (!inventory) return fail(404, 'No inventory record for that product');

    return ok({ ...inventory, inStock: inventory.available > 0 });
  } catch (error) {
    console.error('GET /api/v1/products/[id]/inventory failed:', error);
    return fail(500, 'Failed to load inventory');
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest tests/integration/api-v1-products.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add app/api/v1/products tests/integration/api-v1-products.test.ts
git commit -m "feat(api): add v1 product read routes"
```

## Task 17: Order routes with ownership enforcement

**Files:**
- Create: `app/api/v1/orders/route.ts`, `app/api/v1/orders/[id]/route.ts`, `app/api/v1/orders/[id]/cancel/route.ts`
- Test: `tests/integration/api-v1-orders.test.ts`

- [ ] **Step 1: Write the failing test**

The cross-user denial cases are the point of this task. Do not skip them.

```typescript
// tests/integration/api-v1-orders.test.ts
jest.mock('@/app/api/v1/_lib/session', () => ({ requireApiUser: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: { order: { findMany: jest.fn(), findUnique: jest.fn() } },
}));
jest.mock('@/server/actions/order-lifecycle', () => ({ cancelOrder: jest.fn() }));

import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireApiUser } from '@/app/api/v1/_lib/session';
import { cancelOrder } from '@/server/actions/order-lifecycle';
import { GET as listOrders } from '@/app/api/v1/orders/route';
import { GET as getOrder } from '@/app/api/v1/orders/[id]/route';
import { POST as postCancel } from '@/app/api/v1/orders/[id]/cancel/route';

const mockPrisma = prisma as any;
const mockUser = requireApiUser as jest.Mock;
const mockCancel = cancelOrder as jest.Mock;

const req = (path: string) => new NextRequest(`https://x.test${path}`);

describe('GET /api/v1/orders', () => {
  beforeEach(() => jest.clearAllMocks());

  it('401s without a session', async () => {
    mockUser.mockResolvedValue(null);
    expect((await listOrders(req('/api/v1/orders'))).status).toBe(401);
  });

  it('scopes the query to the session user, ignoring any userId in the query string', async () => {
    mockUser.mockResolvedValue({ id: 'user_a', email: 'a@x.com', role: 'USER' });
    mockPrisma.order.findMany.mockResolvedValue([]);

    await listOrders(req('/api/v1/orders?userId=user_b'));

    expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user_a' } })
    );
  });
});

describe('GET /api/v1/orders/[id]', () => {
  beforeEach(() => jest.clearAllMocks());

  it("404s rather than 403s for another user's order", async () => {
    mockUser.mockResolvedValue({ id: 'user_a', email: 'a@x.com', role: 'USER' });
    mockPrisma.order.findUnique.mockResolvedValue(null);

    const res = await getOrder(req('/api/v1/orders/order_b'), {
      params: Promise.resolve({ id: 'order_b' }),
    });

    expect(res.status).toBe(404);
    expect(mockPrisma.order.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'order_b', userId: 'user_a' } })
    );
  });
});

describe('POST /api/v1/orders/[id]/cancel', () => {
  beforeEach(() => jest.clearAllMocks());

  it('401s without a session and never calls the action', async () => {
    mockUser.mockResolvedValue(null);
    const res = await postCancel(req('/api/v1/orders/o1/cancel'), {
      params: Promise.resolve({ id: 'o1' }),
    });
    expect(res.status).toBe(401);
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('maps an Unauthorized action result to 403', async () => {
    mockUser.mockResolvedValue({ id: 'user_a', email: 'a@x.com', role: 'USER' });
    mockCancel.mockResolvedValue({ success: false, error: 'Unauthorized' });

    const res = await postCancel(req('/api/v1/orders/o1/cancel'), {
      params: Promise.resolve({ id: 'o1' }),
    });

    expect(res.status).toBe(403);
  });

  it('maps a non-cancellable status to 409', async () => {
    mockUser.mockResolvedValue({ id: 'user_a', email: 'a@x.com', role: 'USER' });
    mockCancel.mockResolvedValue({
      success: false,
      error: 'Order cannot be cancelled',
    });

    const res = await postCancel(req('/api/v1/orders/o1/cancel'), {
      params: Promise.resolve({ id: 'o1' }),
    });

    expect(res.status).toBe(409);
  });

  it('returns 200 on success', async () => {
    mockUser.mockResolvedValue({ id: 'user_a', email: 'a@x.com', role: 'USER' });
    mockCancel.mockResolvedValue({ success: true });

    const res = await postCancel(req('/api/v1/orders/o1/cancel'), {
      params: Promise.resolve({ id: 'o1' }),
    });

    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/integration/api-v1-orders.test.ts`
Expected: FAIL — route modules missing.

- [ ] **Step 3: Write the list route**

These routes query Prisma directly rather than calling `getUserOrders`, because that function trusts its `userId` argument (finding 9) and is wrapped in `unstable_cache`, which would cache one user's orders under a shared key.

```typescript
// app/api/v1/orders/route.ts
import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireApiUser } from '../_lib/session';
import { ok, fail } from '../_lib/respond';

const MAX_LIMIT = 50;

export async function GET(req: NextRequest) {
  try {
    const user = await requireApiUser(req);
    if (!user) return fail(401, 'Authentication required');

    const requested = Number(req.nextUrl.searchParams.get('limit') ?? 20);
    const limit = Math.min(Number.isFinite(requested) ? requested : 20, MAX_LIMIT);

    const orders = await prisma.order.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        orderItems: {
          select: { productId: true, productName: true, quantity: true, price: true },
        },
      },
    });

    return ok({ orders });
  } catch (error) {
    console.error('GET /api/v1/orders failed:', error);
    return fail(500, 'Failed to load orders');
  }
}
```

- [ ] **Step 4: Write the detail route**

The ownership check is expressed as part of the `where` clause, so a non-owned order is indistinguishable from a non-existent one. That is deliberate: it stops an agent enumerating valid order IDs.

```typescript
// app/api/v1/orders/[id]/route.ts
import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireApiUser } from '../../_lib/session';
import { ok, fail } from '../../_lib/respond';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireApiUser(req);
    if (!user) return fail(401, 'Authentication required');

    const { id } = await params;

    const order = await prisma.order.findUnique({
      where: { id, userId: user.id },
      include: {
        orderItems: {
          select: { productId: true, productName: true, quantity: true, price: true },
        },
      },
    });

    if (!order) return fail(404, 'Order not found');

    return ok(order);
  } catch (error) {
    console.error('GET /api/v1/orders/[id] failed:', error);
    return fail(500, 'Failed to load order');
  }
}
```

If Prisma rejects `where: { id, userId }` because `userId` is not part of a unique constraint, switch to `findFirst` with the same `where`. Verify with `npm run type-check` and adjust.

- [ ] **Step 5: Write the cancel route**

```typescript
// app/api/v1/orders/[id]/cancel/route.ts
import type { NextRequest } from 'next/server';
import { requireApiUser } from '../../../_lib/session';
import { ok, fail } from '../../../_lib/respond';
import { cancelOrder } from '@/server/actions/order-lifecycle';

const STATUS_FOR_ERROR: Record<string, number> = {
  'Authentication required': 401,
  Unauthorized: 403,
  'Order not found': 404,
  'Order cannot be cancelled': 409,
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireApiUser(req);
    if (!user) return fail(401, 'Authentication required');

    const { id } = await params;
    const result = await cancelOrder(id);

    if (!result.success) {
      return fail(STATUS_FOR_ERROR[result.error] ?? 400, result.error);
    }

    return ok({ orderId: id, status: 'CANCELLED' });
  } catch (error) {
    console.error('POST /api/v1/orders/[id]/cancel failed:', error);
    return fail(500, 'Failed to cancel order');
  }
}
```

`cancelOrder` resolves identity itself via `getCurrentUser()`, so it re-checks ownership independently of this route. That redundancy is intentional — it is the "one enforcement choke point per layer" discipline the source plan's §3.2 argues for.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest tests/integration/api-v1-orders.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 7: Commit**

```bash
git add app/api/v1/orders tests/integration/api-v1-orders.test.ts
git commit -m "feat(api): add v1 order routes with ownership enforcement"
```

## Task 18: Add the rating filter to product search

Two of the four workflows in the source plan's §2.5 filter on rating ("4+ rating", "rated above 4.3"). `searchProducts` has no such filter, so without this the agent would have to fetch everything and filter in the model — slow, expensive, and unreliable.

**Files:**
- Modify: `server/queries/products.ts:200`, `app/api/v1/products/route.ts`
- Test: `tests/integration/api-v1-products-rating.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/api-v1-products-rating.test.ts
jest.mock('@/server/queries/products', () => ({
  searchProducts: jest.fn(),
  getProductById: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { searchProducts } from '@/server/queries/products';
import { GET as listProducts } from '@/app/api/v1/products/route';

const mockSearch = searchProducts as unknown as jest.Mock;

describe('rating filter', () => {
  beforeEach(() => jest.clearAllMocks());

  it('passes minRating through when provided', async () => {
    mockSearch.mockResolvedValue({ products: [], total: 0 });
    await listProducts(
      new NextRequest('https://x.test/api/v1/products?q=shoes&minRating=4.3')
    );
    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({ minRating: 4.3 })
    );
  });

  it('omits minRating when absent rather than defaulting to zero', async () => {
    mockSearch.mockResolvedValue({ products: [], total: 0 });
    await listProducts(new NextRequest('https://x.test/api/v1/products?q=shoes'));
    expect(mockSearch.mock.calls[0][0].minRating).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/integration/api-v1-products-rating.test.ts`
Expected: FAIL on the first test — `minRating` is not forwarded.

- [ ] **Step 3: Forward the parameter from the route**

In `app/api/v1/products/route.ts`, add to the object passed to `searchProducts`:

```typescript
      minRating: num(params.get('minRating')),
```

- [ ] **Step 4: Implement the filter in the query layer**

Read `server/queries/products.ts:200-316` first. Add `minRating?: number` to the options type, then filter on the aggregate rating. The `Review` model has no denormalised average on `Product`, so compute it:

```typescript
    // inside searchProducts, after the base query resolves
    if (typeof minRating === 'number') {
      const ratings = await prisma.review.groupBy({
        by: ['productId'],
        where: { productId: { in: products.map(p => p.id) } },
        _avg: { rating: true },
      });

      const averageByProduct = new Map(
        ratings.map(r => [r.productId, r._avg.rating ?? 0])
      );

      products = products.filter(
        p => (averageByProduct.get(p.id) ?? 0) >= minRating
      );
    }
```

Adapt the variable names to whatever the surrounding function actually uses — read it before editing. If `products` is `const`, change it to `let`.

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx jest tests/integration/api-v1-products-rating.test.ts
npx jest tests/integration/api-v1-products.test.ts
npm run type-check
```

Expected: all PASS, `tsc --noEmit` exits 0.

- [ ] **Step 6: Commit**

```bash
git add server/queries/products.ts app/api/v1/products/route.ts tests/integration/api-v1-products-rating.test.ts
git commit -m "feat(products): add minRating filter to search"
```

## Task 19: Cart routes

**Files:**
- Create: `app/api/v1/cart/route.ts`
- Test: `tests/integration/api-v1-cart.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/api-v1-cart.test.ts
jest.mock('@/app/api/v1/_lib/session', () => ({ requireApiUser: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    cart: { upsert: jest.fn(), findUnique: jest.fn() },
    cartItem: { upsert: jest.fn(), deleteMany: jest.fn() },
    product: { findUnique: jest.fn() },
  },
}));

import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireApiUser } from '@/app/api/v1/_lib/session';
import { GET, POST, DELETE } from '@/app/api/v1/cart/route';

const mockPrisma = prisma as any;
const mockUser = requireApiUser as jest.Mock;

function postReq(body: unknown) {
  return new NextRequest('https://x.test/api/v1/cart', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('cart routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('401s on GET without a session', async () => {
    mockUser.mockResolvedValue(null);
    expect((await GET(new NextRequest('https://x.test/api/v1/cart'))).status).toBe(401);
  });

  it('401s on POST without a session', async () => {
    mockUser.mockResolvedValue(null);
    expect((await POST(postReq({ productId: 'p1', quantity: 1 }))).status).toBe(401);
  });

  it('400s when quantity is not a positive integer', async () => {
    mockUser.mockResolvedValue({ id: 'user_a', email: 'a@x.com', role: 'USER' });
    expect((await POST(postReq({ productId: 'p1', quantity: 0 }))).status).toBe(400);
    expect((await POST(postReq({ productId: 'p1', quantity: -3 }))).status).toBe(400);
  });

  it('404s when the product does not exist', async () => {
    mockUser.mockResolvedValue({ id: 'user_a', email: 'a@x.com', role: 'USER' });
    mockPrisma.product.findUnique.mockResolvedValue(null);
    expect((await POST(postReq({ productId: 'nope', quantity: 1 }))).status).toBe(404);
  });

  it('adds to the session user cart, never a supplied one', async () => {
    mockUser.mockResolvedValue({ id: 'user_a', email: 'a@x.com', role: 'USER' });
    mockPrisma.product.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    mockPrisma.cart.upsert.mockResolvedValue({ id: 'cart_a' });
    mockPrisma.cartItem.upsert.mockResolvedValue({});
    mockPrisma.cart.findUnique.mockResolvedValue({ id: 'cart_a', items: [] });

    await POST(postReq({ productId: 'p1', quantity: 2, cartId: 'cart_someone_else' }));

    expect(mockPrisma.cart.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user_a' } })
    );
  });

  it('clears only the session user cart on DELETE', async () => {
    mockUser.mockResolvedValue({ id: 'user_a', email: 'a@x.com', role: 'USER' });
    mockPrisma.cart.findUnique.mockResolvedValue({ id: 'cart_a', items: [] });
    mockPrisma.cartItem.deleteMany.mockResolvedValue({ count: 2 });

    await DELETE(new NextRequest('https://x.test/api/v1/cart', { method: 'DELETE' }));

    expect(mockPrisma.cartItem.deleteMany).toHaveBeenCalledWith({
      where: { cartId: 'cart_a' },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/integration/api-v1-cart.test.ts`
Expected: FAIL — route module missing.

- [ ] **Step 3: Write the route**

This does not reuse `server/actions/cart.ts` because that module calls `cookies()` for the guest-cart path, which is unavailable and meaningless in an API called by a service.

```typescript
// app/api/v1/cart/route.ts
import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireApiUser } from '../_lib/session';
import { ok, fail } from '../_lib/respond';

const MAX_QUANTITY = 99;

async function loadCart(userId: string) {
  return prisma.cart.findUnique({
    where: { userId },
    include: { items: { include: { product: true } } },
  });
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireApiUser(req);
    if (!user) return fail(401, 'Authentication required');

    const cart = await loadCart(user.id);
    return ok({ items: cart?.items ?? [] });
  } catch (error) {
    console.error('GET /api/v1/cart failed:', error);
    return fail(500, 'Failed to load cart');
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireApiUser(req);
    if (!user) return fail(401, 'Authentication required');

    const body = await req.json();
    const productId = body?.productId;
    const quantity = body?.quantity;

    if (typeof productId !== 'string' || productId.length === 0) {
      return fail(400, 'productId is required');
    }
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_QUANTITY
    ) {
      return fail(400, `quantity must be an integer between 1 and ${MAX_QUANTITY}`);
    }

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) return fail(404, 'Product not found');

    const cart = await prisma.cart.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    });

    await prisma.cartItem.upsert({
      where: {
        cartId_productId_variantId: {
          cartId: cart.id,
          productId,
          variantId: null,
        },
      },
      update: { quantity },
      create: { cartId: cart.id, productId, quantity },
    });

    const updated = await loadCart(user.id);
    return ok({ items: updated?.items ?? [] });
  } catch (error) {
    console.error('POST /api/v1/cart failed:', error);
    return fail(500, 'Failed to update cart');
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireApiUser(req);
    if (!user) return fail(401, 'Authentication required');

    const cart = await loadCart(user.id);
    if (cart) {
      await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    }

    return ok({ items: [] });
  } catch (error) {
    console.error('DELETE /api/v1/cart failed:', error);
    return fail(500, 'Failed to clear cart');
  }
}
```

The compound unique key name `cartId_productId_variantId` comes from `@@unique([cartId, productId, variantId])` at `prisma/schema.prisma:202`. If the generated client names it differently, read `node_modules/.prisma/client/index.d.ts` and use the actual name.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/integration/api-v1-cart.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/cart tests/integration/api-v1-cart.test.ts
git commit -m "feat(api): add v1 cart routes scoped to the session user"
```

## Task 20: Verify the whole API against the deployed instance

- [ ] **Step 1: Run the full suite and deploy**

```bash
npx jest
npm run type-check
npm run build
git push
```

Expected: all tests PASS, build succeeds, Railway redeploys green.

- [ ] **Step 2: Capture a session cookie**

Sign in as the demo customer in a browser against the Railway URL, open DevTools → Application → Cookies, and copy the value of `__Secure-next-auth.session-token`.

```bash
export BASE="https://<railway-domain>"
export COOKIE="__Secure-next-auth.session-token=<value>"
```

- [ ] **Step 3: Verify each route**

```bash
curl -s "$BASE/api/v1/products?q=shoes&maxPrice=200&limit=3" | head -c 400
curl -s "$BASE/api/v1/orders" -H "Cookie: $COOKIE" | head -c 400
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/api/v1/orders"
curl -s "$BASE/api/v1/cart" -H "Cookie: $COOKIE" | head -c 200
```

Expected: products returns a `data.products` array; orders returns the caller's orders; the unauthenticated orders call returns `401`; cart returns `data.items`.

- [ ] **Step 4: Verify cross-user denial**

Take an order ID that belongs to the *admin* user (find one in the Supabase SQL editor), then request it with the customer's cookie:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/api/v1/orders/<admin-order-id>" -H "Cookie: $COOKIE"
```

Expected: `404`. If this returns `200`, stop — the ownership clause in Task 17 Step 4 is not being applied, and M3 must not begin until it is.

- [ ] **Step 5: Capture the M2 scorecard**

```bash
SCORECARD_BASE_URL="https://<railway-domain>" npm run scorecard -- m2-api --gate
```

Expected: exits 0. The `/api/v1/products` probe path now returns real data rather than a 404, so its p95 becomes the meaningful API baseline that M3's MCP layer and M4's agent latency are measured against.

- [ ] **Step 6: Tag**

```bash
git add metrics/scorecard.json
git commit -m "chore(metrics): capture m2 scorecard"
git tag m2-api-live
git push origin main --tags
```

---

# M3 — MCP Server (source plan Phase 1)

**Not yet broken into tasks.** Write its plan after M2 ships, using the actual `/api/v1/*` response shapes.

**Deliverable:** A Python 3.11 + FastMCP server deployed as a second Railway service in the same project, calling `web` over the private network via httpx.

**Structure** (from the source plan §1.3, unchanged — the folder boundary is deliberately reused as the M5 agent boundary):

```
mcp-server/
├── server.py
├── tools/{products,orders,cart}.py
├── clients/ecommerce_api.py
└── models/schemas.py
```

**Tool surface**, revised against what the repo actually supports:

| Tool | Backing route | Risk |
|---|---|---|
| `search_products` | `GET /api/v1/products` | Low |
| `get_product` | `GET /api/v1/products/{id}` | Low |
| `check_inventory` | `GET /api/v1/products/{id}/inventory` | Low |
| `get_orders` | `GET /api/v1/orders` | Low |
| `get_order` | `GET /api/v1/orders/{id}` | Low |
| `get_cart` | `GET /api/v1/cart` | Low |
| `add_to_cart` | `POST /api/v1/cart` | Medium |
| `cancel_order` | `POST /api/v1/orders/{id}/cancel` | High |

**Deliberate changes from the source plan's §1.2 map:**

- `create_return`, `check_return_eligibility`, `get_return_status` are **dropped**. No `Return` model exists; the only trace of the concept is `REFUNDED` in the `OrderStatus` enum. Building a returns subsystem is separate product work.
- `cancel_order` **replaces `create_return` as the High-risk showcase capability.** It is genuinely well-implemented, ownership-checked, status-guarded, and restores inventory — exactly the "business logic stays in the backend" case the source plan §1.1 argues for.
- `place_order` and `process_payment` are **dropped**. Payment does not exist after M1, and exposing order placement to an LLM buys the demo nothing.
- `add_to_cart` is fixed at **Medium** — the source plan gave it three different tiers across §1.2, §2.3, and §2.5. Medium means "execute, then inform", which matches the intended UX.

**Blocking design work before this phase starts** (the gap identified in the plan review, still open):

- **Specify the approval-token mechanism.** The source plan §1.5 asserts server-side risk enforcement but never says who mints the token. It must be minted by non-LLM code and bound to `(session_id, tool_name, canonical_args_hash, nonce, expiry)`, single-use, and validated against the *actual* args of the incoming call. Presence-checking alone lets an agent get approval for "cancel order #3" and spend the token on "cancel order #7".
- **Add idempotency keys** to `add_to_cart` and `cancel_order`, so a retry after a timeout does not double-apply.
- **Decide MCP transport.** It must be HTTP/SSE with per-request auth, not stdio — stdio carries one ambient identity per process, which is wrong for a multi-user chat app. NextAuth's JWT strategy (`lib/auth.ts:88`) means the MCP server can verify the session token out-of-band with the same `NEXTAUTH_SECRET`.

**Scorecard additions for this phase:** extend `scripts/scorecard.ts` with a `mcp` section recording per-tool p50/p95 latency and success rate, collected by looping the bare MCP client over every tool. Capture as `m3-mcp`. These become the floor M4 cannot regress below — an agent that makes the same tool slower has a bug, not a feature.

**Exit criteria:** Every tool above is callable from a bare MCP client and returns correct, user-scoped data. A high-risk tool call without a valid approval token fails regardless of what the caller intended. No agent exists yet. `npm run scorecard -- m3-mcp --gate` exits 0.

# M4 — Single Agent (source plan Phase 2)

**Not yet broken into tasks.** Write its plan after M3 ships.

**Deliverable:** One agent with the full toolbox, connected to the M3 MCP server, driving a chat UI through structured events.

**Workflows to validate**, revised for what exists:

1. "What did I order recently?" — single tool call.
2. "Cancel my most recent order." — `get_orders` → `get_order` → confirm → `cancel_order`. *(Replaces the returns workflow.)*
3. "Find me headphones under $200 with a 4+ rating and add the best one to my cart." — `search_products` (with the `minRating` filter from Task 18) → `check_inventory` → recommend → approval → `add_to_cart`.
4. Showcase: "Find running shoes under $150 rated above 4.3, show me your best option, and don't add anything to my cart until I approve."

**Carried forward from the source plan, unchanged:** the seven UX capabilities in §2.2, the risk-tier behaviour table in §2.3, and the `tool_started` / `tool_completed` / `approval_required` event schema in §2.4.

**One addition from the plan review:** freeze the event schema as a versioned contract *before* building the UI. The UI, this milestone, and M5's `interrupt()` payload all depend on it, and it is the cheapest thing to get wrong.

**Also required here, and currently unmitigated:** render approval prompts from **structured tool arguments**, never from agent prose. `Review.content` and `Review.title` (`prisma/schema.prisma:297`) and product descriptions are free user text flowing into agent context. The gate is only as trustworthy as the text beside the button.

**Required task in this phase — the eval harness.** Workflow pass rate cannot be a scorecard metric without one, and this also closes the "no eval harness" open risk carried since the source plan. Build `evals/workflows/*.yaml` holding the four workflows as fixtures — user utterance, expected tool call sequence, expected approval interrupts — plus a runner that executes each N times against the live agent and reports pass rate, tool-selection accuracy, turn latency, and tokens consumed. Wire its output into `scripts/scorecard.ts` as an `agent` section.

Run each workflow at least 5 times per eval. A single green run of a non-deterministic system is not evidence.

**Scorecard additions for this phase:** workflow pass rate (absolute gate: 100%), tool-selection accuracy, p50/p95 turn latency per workflow, tokens per workflow. Capture as `m4-single-agent`.

**Exit criteria:** All four workflows complete correctly, approval gating behaves per the risk tiers, and the chat UI is driven by structured events rather than parsed text. `npm run scorecard -- m4-single-agent --gate` exits 0, and the workflow-1 latency and token figures in that entry become the explicit budget M5 is measured against.

# M5 — Supervisor + Specialists (source plan Phase 3)

**Not yet broken into tasks.** Write its plan after M4 ships.

**Deliverable:** The M4 agent refactored into a LangGraph Supervisor plus three domain specialists — Product, Cart, Order — without changing the MCP layer or the validated workflows.

**Note the specialist count is three, not four.** The source plan's Returns agent has no backend to talk to.

**Carried forward unchanged:** the §3.2 topology rules (specialists never talk to each other; execution authority above low-risk sits only with the Supervisor), the §3.3 framework rationale, the §3.4 `interrupt()` mechanics — especially "no side effects before the interrupt line" and the app-level expiry policy, since LangGraph will leave a thread paused indefinitely — and the §3.5 context-passing discipline.

**Two open items from the plan review to resolve here:**

- §3.6's Supervisor short-circuit for trivial single-domain queries conflicts with "the same workflows pass again". Decide explicitly whether short-circuiting is in scope; if it is, amend the exit criteria to expect divergence on single-domain lookups.
- §3.7's nested-subgraph `interrupt()` propagation stays unconfirmed. It remains moot only while `interrupt()` is called exclusively from the Supervisor. If that placement changes, spike it first.

**This is the milestone the scorecard exists for.** Multi-agent *will* regress latency and token cost on workflow 1 — two LLM hops replacing one. The gate does not let that pass silently. Either the Supervisor short-circuit brings it back inside the M4 budget, or `latency./workflow-1` and `tokens./workflow-1` go into `acceptedRegressions` with a written justification. The source plan's §3.6 called this "wasteful for simple lookups" and left it as something to consider; here it becomes a number someone has to sign off on.

Reuse the M4 eval harness unchanged — same fixtures, same runner, different graph behind it. That is what makes the comparison meaningful.

**Exit criteria:** All four M4 workflows pass again through Supervisor + specialists with identical approval behaviour, plus one new workflow requiring two specialists in sequence (Order agent identifies the order, Cart agent acts on it). `npm run scorecard -- m5-multi-agent --gate` exits 0, either clean or with explicitly accepted and justified latency/token regressions.

---

## Open Risks Carried Across All Milestones

- **Prompt injection via tool output is unmitigated.** `Review.content`, `Review.title`, and product descriptions are attacker-controllable free text entering agent context. Server-side risk enforcement closes only the *execution* path; it does not stop exfiltration through low-risk tools or deceptively-worded approval prompts. Needs a design pass before this goes past demo scope.
- ~~No eval harness for tool selection.~~ **Closed** — the harness is now a required task in M4, and workflow pass rate is a scorecard gate rather than a manual demo run.
- **The repo's test badge overstates coverage.** `tests/integration/api.test.ts` mocks Prisma wholesale, so nothing in the upstream suite exercises a database. The tests added by this plan follow the same mocking pattern; the real verification gates are Task 14 and Task 20, which run against the deployed instance.
- **Vendor-neutrality holds only if prompts and tool schemas stay in config.** A provider swap should be one config block, not four rewritten agents.
