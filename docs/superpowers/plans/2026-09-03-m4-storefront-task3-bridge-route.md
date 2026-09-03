# M4 Storefront Task 3 - The Bridge Route

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /api/assistant` — the browser's only door to the agent. Holds the session,
mints a short-lived bearer server-side, calls the agent service, and streams back only what
the browser is allowed to see.

**Architecture:** Four small pieces, three of which are independently testable and one of
which is glue: a shared mint helper, an incremental SSE frame parser, a server-side turn
store, and the route itself.

**Tech Stack:** Next.js route handler, `ReadableStream`, next-auth `getToken`/`encode`, Jest
integration project.

---

## What this route is for, in one sentence

Decision (C) of `PLAN_M4_STOREFRONT.txt`: **the browser never sees a bearer token at all.**
The route holds the cookie, mints a fifteen-minute token server-side, spends it, and throws
it away. Nothing long-lived exists in the browser and "refresh" is just "mint another one".

## The two things that must not cross to the browser

The agent's SSE stream carries two channels (agent Task 8, and section 3 of this plan):

| frame | contents | this route |
|---|---|---|
| `event: assistant` | a v1 event from the frozen contract | **forwards** |
| `event: control` | `{turn_id, session_id}` | **keeps** |

So there are two secrets to hold, not one. The MUST PROVE names the bearer; `control` is the
other, and it is easier to leak because it arrives looking like ordinary stream content. The
agent's MCP session id would let a caller mint an approval against the agent's own session,
which is the boundary M4 Task 5 exists to defend. A test greps the entire browser-facing
stream for both.

## Why `control` is stored rather than discarded

Task 5's approve route needs `turn_id` (to tell the agent the decision) and `session_id` (to
mint the approval against the agent's MCP session). Neither can be recovered later — the
frames arrive once, mid-stream. Dropping them now means re-plumbing this route then.

What is stored is deliberately **not** the bearer. The person clicking approve is the same
signed-in browser, so the approve route mints its own token from its own cookie. The store
holds `turn_id -> { sessionId, userId, createdAt }`, and `userId` is what lets Task 5 refuse
an approval from a different customer.

## The unglamorous part that will break if rushed

An SSE frame can straddle a chunk boundary. `chunk.split('\n\n')` per chunk silently loses
any frame that arrives in two pieces, and it will do so intermittently, under load, in
production — the failure mode that is hardest to reproduce and easiest to blame on the model.

So the parser is its own unit with its own tests, fed deliberately nasty splits: mid-`data:`,
mid-word, one byte at a time.

---

## File Structure

- **Create** `apps/web/app/api/v1/_lib/mint.ts` — mint a bearer from a resolved session. The
  plan's own suggestion ("factor the minting into a helper both routes call"); `/refresh` and
  this route are those two callers.
- **Create** `apps/web/lib/assistant/sse.ts` — the incremental frame parser.
- **Create** `apps/web/lib/assistant/turns.ts` — the server-side turn store.
- **Create** `apps/web/app/api/assistant/route.ts` — the bridge.
- **Modify** `apps/web/app/api/v1/auth/refresh/route.ts` — use the shared helper.
- **Create** `apps/web/tests/unit/assistant-sse.test.ts`,
  `apps/web/tests/unit/assistant-turns.test.ts`,
  `apps/web/tests/integration/api-assistant-bridge.test.ts`.

---

### Task 3.1: The shared mint helper

**Files:** Create `app/api/v1/_lib/mint.ts`; modify `auth/refresh/route.ts`

- [ ] **Step 1: Write the failing test** (`tests/integration/api-v1-auth-refresh.test.ts`,
  appended):

```typescript
describe('the shared mint helper', () => {
  it('produces a token /whoami accepts', async () => {
    const { mintBearer } = await import('@/app/api/v1/_lib/mint');

    const token = await mintBearer(
      { sub: 'user_9', email: 'a@b.com', role: 'USER' },
      process.env.NEXTAUTH_SECRET as string,
      REFRESH_TTL_SECONDS
    );

    const identified = await whoami(
      new NextRequest('https://example.com/api/v1/auth/whoami', {
        headers: { authorization: `Bearer ${token}` },
      })
    );

    expect((await identified.json()).data.id).toBe('user_9');
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement.**

```typescript
// app/api/v1/_lib/mint.ts
//
// One place that turns a resolved session into a bearer. Two callers:
// POST /api/v1/auth/refresh, and the assistant bridge, which mints one
// per request and never lets it reach the browser.
//
// Factored out rather than duplicated so the two cannot drift about what
// goes into a token -- an extra claim in one and not the other is the
// kind of difference nothing fails on until it matters.
import { encode } from 'next-auth/jwt';

export type MintableSession = {
  sub: string;
  email?: unknown;
  role?: unknown;
};

export async function mintBearer(
  session: MintableSession,
  secret: string,
  ttlSeconds: number
): Promise<string> {
  return encode({
    token: { sub: session.sub, email: session.email, role: session.role },
    secret,
    maxAge: ttlSeconds,
  });
}
```

Then replace the inline `encode` in `auth/refresh/route.ts` with a `mintBearer` call. Its
tests must still pass **unchanged** — that is the evidence the refactor changed nothing.

- [ ] **Step 4: Run the refresh suite. Step 5: Commit.**

---

### Task 3.2: The SSE frame parser

**Files:** Create `lib/assistant/sse.ts`, `tests/unit/assistant-sse.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/web/tests/unit/assistant-sse.test.ts
//
// An SSE frame can straddle a chunk boundary. Splitting each chunk on a
// blank line loses any frame that arrives in two pieces -- intermittently,
// under load, in production. This parser buffers instead, and these tests
// feed it deliberately nasty splits.

import { SseParser } from '@/lib/assistant/sse';

function feed(parser: SseParser, chunks: string[]) {
  return chunks.flatMap((chunk) => parser.push(chunk));
}

describe('SseParser', () => {
  it('reads one whole frame', () => {
    const frames = feed(new SseParser(), ['event: assistant\ndata: {"a":1}\n\n']);

    expect(frames).toEqual([{ event: 'assistant', data: '{"a":1}' }]);
  });

  it('reads several frames from one chunk', () => {
    const frames = feed(new SseParser(), [
      'event: control\ndata: {"t":1}\n\nevent: assistant\ndata: {"a":2}\n\n',
    ]);

    expect(frames.map((f) => f.event)).toEqual(['control', 'assistant']);
  });

  it('joins a frame split across two chunks', () => {
    const frames = feed(new SseParser(), [
      'event: assistant\ndata: {"a"',
      ':1}\n\n',
    ]);

    expect(frames).toEqual([{ event: 'assistant', data: '{"a":1}' }]);
  });

  it('joins a frame split on the blank line itself', () => {
    const frames = feed(new SseParser(), ['event: assistant\ndata: {}\n', '\n']);

    expect(frames).toHaveLength(1);
  });

  it('survives being fed one byte at a time', () => {
    // The worst case, and the one a naive splitter fails hardest on.
    const wire = 'event: assistant\ndata: {"a":1}\n\nevent: control\ndata: {}\n\n';
    const frames = feed(new SseParser(), wire.split(''));

    expect(frames.map((f) => f.event)).toEqual(['assistant', 'control']);
  });

  it('defaults a frame with no event line to "message"', () => {
    // The SSE default, and what an agent emitting bare data would send.
    expect(feed(new SseParser(), ['data: hi\n\n'])).toEqual([
      { event: 'message', data: 'hi' },
    ]);
  });

  it('ignores comments and unknown fields rather than choking', () => {
    const frames = feed(new SseParser(), [
      ': keep-alive\n\nid: 7\nevent: assistant\ndata: {}\n\n',
    ]);

    expect(frames).toEqual([{ event: 'assistant', data: '{}' }]);
  });

  it('holds an incomplete trailing frame rather than emitting half of it', () => {
    const parser = new SseParser();

    expect(parser.push('event: assistant\ndata: {"a"')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement `SseParser`** with a string buffer: `push(chunk)` appends, then
  repeatedly splits off complete frames on `\n\n`, parsing each into `{event, data}` —
  `event:` defaulting to `'message'`, `data:` lines joined with `\n`, lines beginning `:`
  ignored, unknown fields ignored. An incomplete tail stays in the buffer.

- [ ] **Step 4: Run to verify it passes. Step 5: Commit.**

---

### Task 3.3: The turn store

**Files:** Create `lib/assistant/turns.ts`, `tests/unit/assistant-turns.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/web/tests/unit/assistant-turns.test.ts
//
// The control frame arrives once, mid-stream, and Task 5's approve route
// needs both of its fields afterwards. Discarding them means re-plumbing
// the bridge later; storing the customer's bearer would mean holding a
// credential we do not need, because the person clicking approve is the
// same signed-in browser and can mint their own.

import { forgetTurn, rememberTurn, recallTurn, sweepTurns } from '@/lib/assistant/turns';

describe('the turn store', () => {
  it('remembers what the approve route will need', () => {
    rememberTurn('turn_1', { sessionId: 'sess_1', userId: 'user_1' });

    expect(recallTurn('turn_1')).toMatchObject({
      sessionId: 'sess_1',
      userId: 'user_1',
    });
  });

  it('knows nothing about a turn it never saw', () => {
    expect(recallTurn('never')).toBeNull();
  });

  it('never stores a bearer token', () => {
    // Asserted structurally: the shape has no room for one, so a future
    // caller cannot quietly start putting one there.
    rememberTurn('turn_2', { sessionId: 's', userId: 'u' });

    expect(Object.keys(recallTurn('turn_2') as object).sort()).toEqual([
      'createdAt',
      'sessionId',
      'userId',
    ]);
  });

  it('forgets a turn when it ends', () => {
    rememberTurn('turn_3', { sessionId: 's', userId: 'u' });
    forgetTurn('turn_3');

    expect(recallTurn('turn_3')).toBeNull();
  });

  it('forgets a turn nobody ever finished', () => {
    // A store that only grows is a leak with a slow fuse -- the same
    // reasoning as the agent's own TurnRegistry.
    rememberTurn('turn_4', { sessionId: 's', userId: 'u' });
    sweepTurns(Date.now() + 60 * 60 * 1000);

    expect(recallTurn('turn_4')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** a module-level `Map<string, {sessionId, userId, createdAt}>`
  with `rememberTurn`, `recallTurn`, `forgetTurn`, and `sweepTurns(now)` dropping anything
  older than 15 minutes. `recallTurn` sweeps opportunistically so no timer is needed.
  Document that it is per-process, like every other in-memory store in this system.

- [ ] **Step 4: Run to verify it passes. Step 5: Commit.**

---

### Task 3.4: The bridge

**Files:** Create `app/api/assistant/route.ts`, `tests/integration/api-assistant-bridge.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/web/tests/integration/api-assistant-bridge.test.ts
//
// POST /api/assistant -- the browser's only door to the agent.
//
// Two things must not cross to the browser: the bearer this route mints,
// and the `control` frames, which carry the agent's MCP session id. The
// second is the easier leak, because it arrives looking like ordinary
// stream content.

jest.mock('next-auth/jwt', () => ({
  ...jest.requireActual('next-auth/jwt'),
  getToken: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import { POST } from '@/app/api/assistant/route';
import { recallTurn } from '@/lib/assistant/turns';

const mockGetToken = getToken as unknown as jest.Mock;
const SIGNED_IN = { sub: 'user_1', email: 'c@example.com', role: 'USER' };

const AGENT_WIRE =
  'event: control\ndata: {"turn_id":"t1","session_id":"mcp-sess-9"}\n\n' +
  'event: assistant\ndata: {"v":1,"seq":0,"type":"message","data":{"text":"hi"}}\n\n';

function agentResponds(wire = AGENT_WIRE, status = 200) {
  return jest.fn().mockResolvedValue(
    new Response(wire, { status, headers: { 'content-type': 'text/event-stream' } })
  );
}

function ask(body: unknown = { utterance: 'what did I order?' }) {
  return new NextRequest('https://example.com/api/assistant', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function readAll(response: Response): Promise<string> {
  return await response.text();
}

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = 'test-secret-value-for-the-bridge-route';
  process.env.AGENT_SERVICE_URL = 'https://agent.example.com';
  process.env.AGENT_SERVICE_KEY = 'agent-key';
  mockGetToken.mockReset();
});

describe('POST /api/assistant', () => {
  it('refuses an unauthenticated caller', async () => {
    mockGetToken.mockResolvedValue(null);
    global.fetch = agentResponds();

    expect((await POST(ask())).status).toBe(401);
    // And spends nothing: no token minted, no agent call, no model cost.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refuses a request with no utterance', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    global.fetch = agentResponds();

    expect((await POST(ask({}))).status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sends the service key and a freshly minted bearer to the agent', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    const fetchMock = agentResponds();
    global.fetch = fetchMock;

    await POST(ask());

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get('x-agent-key')).toBe('agent-key');
    expect(headers.get('authorization')).toMatch(/^Bearer .+/);
  });

  it('never lets the bearer reach the browser', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    const fetchMock = agentResponds();
    global.fetch = fetchMock;

    const response = await POST(ask());
    const body = await readAll(response);

    const sent = new Headers(fetchMock.mock.calls[0][1].headers)
      .get('authorization')!
      .replace('Bearer ', '');

    expect(sent.length).toBeGreaterThan(20);
    expect(body).not.toContain(sent);
  });

  it('never forwards a control frame', async () => {
    // The agent's MCP session id would let a caller mint an approval
    // against the agent's own session -- the boundary Task 5 defends.
    mockGetToken.mockResolvedValue(SIGNED_IN);
    global.fetch = agentResponds();

    const body = await readAll(await POST(ask()));

    expect(body).not.toContain('mcp-sess-9');
    expect(body).not.toContain('control');
    expect(body).toContain('"type":"message"');
  });

  it('remembers the control frame for the approve route', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    global.fetch = agentResponds();

    await readAll(await POST(ask()));

    expect(recallTurn('t1')).toMatchObject({
      sessionId: 'mcp-sess-9',
      userId: 'user_1',
    });
  });

  it('reports an agent that refuses without leaking why', async () => {
    mockGetToken.mockResolvedValue(SIGNED_IN);
    global.fetch = agentResponds('', 401);

    const response = await POST(ask());

    expect(response.status).toBe(502);
    expect(await readAll(response)).not.toContain('agent-key');
  });
});

describe('a dropped connection', () => {
  it('aborts the agent request rather than leaving it running', async () => {
    // Otherwise the agent keeps a turn -- and an MCP session -- alive
    // with nowhere to send its events.
    mockGetToken.mockResolvedValue(SIGNED_IN);
    const fetchMock = agentResponds();
    global.fetch = fetchMock;

    const controller = new AbortController();
    const request = new NextRequest('https://example.com/api/assistant', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ utterance: 'hi' }),
      signal: controller.signal,
    });

    await POST(request);
    const passedSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;

    expect(passedSignal).toBeDefined();
    expect(passedSignal.aborted).toBe(false);

    controller.abort();
    expect(passedSignal.aborted).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement the route.** Its obligations, in order:

1. resolve the caller from the **cookie** (`getToken`) — 401 if absent;
2. read `{ utterance }` — 400 if missing or blank;
3. refuse with 500 if `NEXTAUTH_SECRET`, `AGENT_SERVICE_URL` or `AGENT_SERVICE_KEY` is
   unset, the same call every other route here makes about missing configuration;
4. mint a bearer with `mintBearer` and `REFRESH_TTL_SECONDS`;
5. `fetch` the agent's `/turn`, passing `req.signal` so a dropped browser connection
   cancels the upstream request;
6. non-2xx from the agent becomes a 502 whose body names nothing about the request that
   was made;
7. stream the response through `SseParser`, forwarding only `assistant` frames re-encoded
   as SSE, and calling `rememberTurn` for each `control` frame;
8. `forgetTurn` when the stream ends.

- [ ] **Step 4: Run the whole suite and `npx tsc --noEmit`.**

- [ ] **Step 5: Commit.**

---

### Task 3.5: Configure and record

- [ ] **Step 1: Set `AGENT_SERVICE_URL` and `AGENT_SERVICE_KEY`** on the Railway `web`
  service. `AGENT_SERVICE_KEY` must be the identical value the `agent` service holds — this
  is the variable flagged during agent Task 8.

- [ ] **Step 2: Verify live** — a real utterance through the deployed bridge, asserting the
  browser-facing stream contains `assistant` frames, no `control`, and no bearer.

- [ ] **Step 3: Mark Task 3 done** in `PLAN_M4_STOREFRONT.txt`, recording the two-secret
  rule and the chunk-boundary hazard.

---

## Self-Review

**Spec coverage.** The three MUST PROVEs map to `refuses an unauthenticated caller`, `never
lets the bearer reach the browser`, and `a dropped connection`. The fourth property — never
forwarding `control` — is not in the plan's list and is the one this route is most likely to
get wrong, because that frame looks like ordinary content.

**Placeholders.** 3.2 step 3 and 3.4 step 3 describe rather than transcribe: the parser is a
buffer-and-split loop fully pinned by eight tests, and the route is glue over three units
tested above it. Every obligation is enumerated.

**Type consistency.** `SseParser.push(chunk) -> {event, data}[]` is one signature across the
module, its tests, and the route. `rememberTurn/recallTurn/forgetTurn/sweepTurns` likewise.
`mintBearer(session, secret, ttl)` is used identically by `/refresh` and the bridge.

**Carried, not solved.** The turn store is per-process, like the agent's `TurnRegistry`, the
approval nonce set, and both rate limiters. Every one of those is already documented as
single-replica; this adds a fourth rather than a new class of problem.
