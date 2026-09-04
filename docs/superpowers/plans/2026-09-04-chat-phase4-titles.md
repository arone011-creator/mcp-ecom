# Chat Phase 4: Titles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a chat names itself after its first exchange, so the history list reads as a list of subjects rather than four rows of "what did I order recently?".

**Architecture:** after the first turn lands, the browser POSTs to `/api/assistant/conversations/{id}/title` — a bare request with **no body**. The route reads that conversation's first turn out of the database, asks the agent's new `POST /title` for a name, sanitises what comes back, and writes it **only if `title` is still null**, in one `updateMany` filtered by owner. Idempotent by construction, and the browser never supplies the text the model is shown.

**Tech Stack:** Python 3 / Starlette / pytest (agent repo); Next.js App Router / Prisma / Jest (storefront repo).

**Not in this phase:** renaming a chat by hand (not in the roadmap, not being added), re-titling a chat as it grows, titles for chats that already exist (they keep their fallback until they get a new first turn — which they never will; see below).

---

## Decisions this plan is built on

From `2026-09-03-chat-persistence-roadmap.md`:

| Decision | Consequence here |
|---|---|
| Titles are model-generated after the first exchange | One call, once, per conversation. Not on every turn. |
| Falls back to the truncated first message so a failed title call never blocks a chat | `listConversations` already renders `row.title ?? fallbackName(...)`. This phase fills the field and changes **no UI at all**. |
| Ownership answers 404, never 403 | The new route answers the same 404 as the others. |
| The title is rendered as plain text, never as markup | Already true and already tested in `assistant-conversation-list.test.tsx`; this phase adds the case where the text is *model-written* rather than customer-written. |

### Two things this phase must prove

1. **A failed title call leaves the chat usable under its fallback name.** Every failure path — agent down, agent slow, agent returns nonsense — ends with the row untouched and the list still rendering (Tasks 3 and 5).
2. **The title is rendered as plain text, never as markup.** Covered by the existing list test; this phase adds a title-shaped payload to it (Task 5).

### Four decisions this plan makes that the roadmap did not cover

**1. The request carries no body, and the model is shown text read from the database.** The obvious design has the browser POST the exchange it just watched. That would make the title endpoint a way to put arbitrary attacker-chosen text in front of the model on this project's account, and to write an arbitrary-ish string into a row. Reading turn 0 server-side costs one query and removes the whole class.

**2. The write is one `updateMany`, not read-then-write.** `where: { id, userId, title: null }` makes "only if unnamed" and "only if yours" the same atomic condition. Two tabs racing, or a double-fired request, cannot produce two model calls' worth of writes — the second matches nothing. A read followed by a conditional write would have a window between them.

**3. A title may not contain a URL, and is capped at 60 characters.** A title is model-written text derived from an exchange that may have contained untrusted product copy. It is rendered in a narrow list where a long string is truncated anyway, and a link in a chat name is never something the customer asked for. URLs are stripped rather than the title rejected, so one bad link does not cost the name. 60 matches `NAME_LIMIT`, so titles and fallbacks truncate at the same width.

**4. The browser fires it once, after the first turn, and ignores the outcome.** Not from the bridge: the bridge is holding the customer's stream open, and a model call for a cosmetic string does not belong on that critical path. Fire-and-forget is safe precisely because the route is idempotent — the worst a retry, a double-click or a reload can do is match zero rows.

### What happens to the chats that already exist

Nothing, and deliberately. A conversation only asks for a title after its *first* turn, so the four chats already in the demo account keep their fallback names forever. Backfilling them would mean a script that spends model tokens on old rows to change a string that already reads acceptably. If it ever matters, the fallback is doing its job in the meantime — which is the whole reason it exists.

---

## File Structure

### `mcp-ecom-agent-layer`

| File | Responsibility | Change |
|---|---|---|
| `agent/titles.py` | the prompt, and what a title may contain | create |
| `tests/test_agent_titles.py` | its tests | create |
| `agent_server.py` | `POST /title` | modify |
| `tests/test_agent_server.py` | route tests | add |

### `mcp-ecom-web-app/apps/web`

| File | Responsibility | Change |
|---|---|---|
| `lib/assistant/conversation-store.ts` | every chat database access | add `firstExchange`, `nameConversation` |
| `tests/integration/assistant-conversation-store.test.ts` | store tests | add |
| `app/api/assistant/conversations/[id]/title/route.ts` | `POST` a title | create |
| `tests/integration/api-assistant-title.test.ts` | route tests | create |
| `components/assistant/assistant-provider.tsx` | ask for a title after turn 1 | modify |
| `tests/unit/assistant-provider.test.tsx` | provider tests | add |
| `tests/unit/assistant-conversation-list.test.tsx` | markup test for a model-written title | add |

**Why `agent/titles.py` is its own module.** Same reason as `history.py`: the sanitising is the part worth reading closely, it is pure, and its tests are a table of inputs. The prompt lives next to the rule that cleans up after it.

**Why the store grows again rather than splitting.** Ownership-in-the-query is the module's entire reason for existing, and `nameConversation` is the function where getting that wrong would let one customer name another's chat.

---

## Task 1: what a title may be

**Files:**
- Create: `mcp-ecom-agent-layer/agent/titles.py`
- Test: `mcp-ecom-agent-layer/tests/test_agent_titles.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_agent_titles.py`:

```python
# tests/test_agent_titles.py
#
# A chat name is model-written text derived from an exchange that may
# have carried untrusted product copy, rendered into a narrow list. What
# it may contain is a smaller question than what it should say, and it is
# the one worth testing exhaustively.

from agent.titles import TITLE_LIMIT, clean_title


def test_a_plain_title_survives():
    assert clean_title("Recent order history") == "Recent order history"


def test_surrounding_quotes_are_removed():
    # Models like to answer a naming question in quotes.
    assert clean_title('"Recent order history"') == "Recent order history"
    assert clean_title("'Recent order history'") == "Recent order history"


def test_a_trailing_full_stop_is_removed():
    # A title is a label, not a sentence.
    assert clean_title("Recent order history.") == "Recent order history"


def test_newlines_become_spaces():
    # The list renders one line. A newline would silently truncate it.
    assert clean_title("Recent\norder\nhistory") == "Recent order history"


def test_runs_of_whitespace_collapse():
    assert clean_title("Recent    order   history") == "Recent order history"


def test_a_url_is_stripped_out():
    # THE MUST NOT. The exchange this was derived from may have contained
    # untrusted product copy. A link in a chat name is never something the
    # customer asked for, and a name is rendered somewhere a message is
    # not.
    assert "http" not in clean_title("Deal at https://evil.example.com now")


def test_stripping_a_url_keeps_the_rest_of_the_title():
    # Stripped, not rejected: one bad link must not cost the name.
    assert clean_title("Lamp deal https://evil.example.com") == "Lamp deal"


def test_a_long_title_is_cut_to_the_limit():
    assert len(clean_title("x" * 200)) <= TITLE_LIMIT


def test_a_title_that_is_only_a_url_is_refused():
    # Nothing left after stripping is not a name.
    assert clean_title("https://evil.example.com") is None


def test_an_empty_answer_is_refused():
    assert clean_title("") is None
    assert clean_title("   ") is None
    assert clean_title(None) is None


def test_a_non_string_is_refused():
    assert clean_title(["Recent order history"]) is None


def test_control_characters_are_removed():
    # A name goes into a list, a tab title and a log line.
    assert clean_title("Recent  order history") == "Recent order history"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_agent_titles.py -q`
Expected: collection error, `No module named 'agent.titles'`

- [ ] **Step 3: Write the implementation**

Create `agent/titles.py`:

```python
"""Naming a conversation, and what a name may contain.

Phase 4 of the chat-persistence roadmap. One model call, once, after a
chat's first exchange. The storefront falls back to the customer's own
first message whenever this fails, so nothing here is allowed to be
load-bearing -- a refusal returns None and the chat keeps a usable name.

WHAT A NAME MAY CONTAIN IS THE PART WORTH READING. It is model-written
text derived from an exchange that may have carried untrusted product
copy, and it is rendered in a list, not in a message bubble. So: no URLs,
no control characters, one line, and short enough that the list truncates
titles and fallbacks at the same width.
"""

import re

# The same 60 the storefront truncates a fallback name at, so a title and
# a fallback are cut to the same width and the list stays even.
TITLE_LIMIT = 60

_URL = re.compile(r"https?://\S+|www\.\S+")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")

SYSTEM_PROMPT = """\
You name conversations. You are given the first thing a customer asked a \
shopping assistant and the assistant's reply.

Answer with a short label for that conversation - at most six words, no \
quotes, no full stop, no URLs. Describe the SUBJECT, not the assistant: \
"Recent order history", not "Assistant explains orders".

Answer with the label and nothing else."""


def clean_title(raw: object) -> str | None:
    """A usable name, or None if there is not one in here.

    None on anything doubtful rather than a best effort: the storefront
    has a perfectly good fallback -- the customer's own words -- and a
    mangled model answer is worse than that, not better.
    """
    if not isinstance(raw, str):
        return None

    # URLs first: stripping them can empty the string, and everything
    # after this treats an empty string as "no title".
    title = _URL.sub(" ", raw)
    title = _CONTROL.sub(" ", title)
    # One line. A newline in a single-line list silently loses the rest.
    title = " ".join(title.split())
    # Models answer a naming question in quotes, and a label is not a
    # sentence.
    title = title.strip("\"'").strip().rstrip(".").strip()

    if not title:
        return None

    return title[:TITLE_LIMIT]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_agent_titles.py -q`
Expected: 13 passed

- [ ] **Step 5: Commit**

```bash
git add agent/titles.py tests/test_agent_titles.py
git commit -m "$(cat <<'EOF'
feat: what a conversation name may contain

Model-written text derived from an exchange that may have carried
untrusted product copy, rendered in a list rather than a bubble: no URLs,
no control characters, one line, capped at the same 60 the storefront
truncates a fallback name at.

None on anything doubtful. The storefront's fallback is the customer's
own words, which beats a mangled model answer.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: the agent names a conversation

**Files:**
- Modify: `mcp-ecom-agent-layer/agent_server.py`
- Test: `mcp-ecom-agent-layer/tests/test_agent_server.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_agent_server.py`:

```python
# --- POST /title ---------------------------------------------------------
#
# Phase 4. A cheap, tool-less model call: no MCP session, no customer
# bearer, no approval surface. It reads two strings and answers one.


def test_a_title_without_the_service_key_is_refused(monkeypatch):
    # The same gate as /turn, for the same reason: this spends money.
    monkeypatch.setattr(config, "AGENT_SERVICE_KEY", "k")

    with TestClient(app) as client:
        response = client.post("/title", json={"utterance": "hi", "answer": "hello"})

    assert response.status_code == 401


def test_a_title_needs_an_utterance(monkeypatch):
    monkeypatch.setattr(config, "AGENT_SERVICE_KEY", "k")

    with TestClient(app) as client:
        response = client.post(
            "/title", json={"answer": "hello"}, headers={"x-agent-key": "k"}
        )

    assert response.status_code == 400


def test_a_title_comes_back_cleaned(monkeypatch):
    monkeypatch.setattr(config, "AGENT_SERVICE_KEY", "k")

    import agent_server

    async def fake_name(utterance, answer):
        return '"Recent order history."'

    monkeypatch.setattr(agent_server, "name_conversation", fake_name)

    with TestClient(app) as client:
        response = client.post(
            "/title",
            json={"utterance": "what did I order?", "answer": "Two orders."},
            headers={"x-agent-key": "k"},
        )

    assert response.status_code == 200
    assert response.json() == {"title": "Recent order history"}


def test_a_title_the_model_could_not_produce_is_a_null_not_a_500(monkeypatch):
    # The storefront treats a null as "keep the fallback". A 500 would be
    # a failed request it has to special-case; a null is an answer.
    monkeypatch.setattr(config, "AGENT_SERVICE_KEY", "k")

    import agent_server

    async def fake_name(utterance, answer):
        return "   "

    monkeypatch.setattr(agent_server, "name_conversation", fake_name)

    with TestClient(app) as client:
        response = client.post(
            "/title",
            json={"utterance": "hi", "answer": "hello"},
            headers={"x-agent-key": "k"},
        )

    assert response.status_code == 200
    assert response.json() == {"title": None}


def test_a_model_that_falls_over_is_a_null_too(monkeypatch):
    # A NAME IS NEVER WORTH AN ERROR. The chat already has a usable one.
    monkeypatch.setattr(config, "AGENT_SERVICE_KEY", "k")

    import agent_server

    async def fake_name(utterance, answer):
        raise RuntimeError("the model fell over")

    monkeypatch.setattr(agent_server, "name_conversation", fake_name)

    with TestClient(app) as client:
        response = client.post(
            "/title",
            json={"utterance": "hi", "answer": "hello"},
            headers={"x-agent-key": "k"},
        )

    assert response.status_code == 200
    assert response.json() == {"title": None}


def test_naming_shows_the_model_both_halves_of_the_exchange(monkeypatch):
    # The subject of a chat is rarely in the question alone -- "and the
    # second one?" names nothing.
    import agent.titles as titles_module

    seen = {}

    class FakeMessage:
        content = "Recent order history"

    class FakeCompletions:
        async def create(self, **kwargs):
            seen.update(kwargs)

            class R:
                choices = [type("C", (), {"message": FakeMessage()})()]

            return R()

    class FakeClient:
        chat = type("Chat", (), {"completions": FakeCompletions()})()

    monkeypatch.setattr(titles_module, "_openai_client", lambda: FakeClient())

    import asyncio

    asyncio.get_event_loop().run_until_complete(
        titles_module.name_conversation("what did I order?", "Two orders.")
    )

    sent = json.dumps(seen["messages"])
    assert "what did I order?" in sent
    assert "Two orders." in sent
    # And no tools: naming a chat cannot call anything.
    assert not seen.get("tools")
```

Add `import json` to the top of the file if it is not already imported.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_agent_server.py -k title -q`
Expected: FAIL — 404 on `/title`, and `name_conversation` does not exist.

- [ ] **Step 3: Add the model call**

Append to `agent/titles.py`:

```python
def _openai_client():
    """Seam. Tests replace this rather than the SDK underneath it."""
    from openai import AsyncOpenAI

    return AsyncOpenAI(timeout=config.OPENAI_TIMEOUT_SECONDS)


async def name_conversation(utterance: str, answer: str) -> str | None:
    """Ask the model for a label. Raw -- the caller cleans it.

    BOTH HALVES OF THE EXCHANGE. The subject of a chat is often not in
    the question: "and the second one?" names nothing on its own, and the
    first question of a chat is frequently that vague.

    NO TOOLS, NO SESSION, NO CUSTOMER TOKEN. Naming a conversation is a
    text task. Giving this endpoint tools would put a second, quieter
    path to the customer's orders next to the one the approval design
    guards.
    """
    client = _openai_client()

    response = await client.chat.completions.create(
        model=config.OPENAI_MODEL,
        # A label. Room for the model to be a little verbose before the
        # cap trims it, and not a token more.
        max_completion_tokens=32,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"Customer asked: {utterance}\n\nAssistant replied: {answer}",
            },
        ],
    )

    return response.choices[0].message.content
```

And add `import config` at the top of `agent/titles.py`, below the `re` import.

- [ ] **Step 4: Add the route**

In `agent_server.py`, with the other `agent.` imports:

```python
from agent.titles import clean_title, name_conversation
```

Add the handler, after `decision`:

```python
async def title(request: Request) -> JSONResponse:
    """Name a conversation. One cheap model call, no tools, no session.

    ALWAYS 200 WITH A TITLE OR A NULL, never a 500 on a naming failure.
    The storefront's fallback is the customer's own first message, which
    is a perfectly good name -- so every way this can fail is an answer
    of "no title", not an error the caller has to special-case.
    """
    refusal = _check_service_key(request)
    if refusal is not None:
        return refusal

    body = await request.json()
    utterance = (body.get("utterance") or "").strip()
    if not utterance:
        return JSONResponse({"error": "An utterance is required"}, status_code=400)

    try:
        raw = await name_conversation(utterance, (body.get("answer") or "").strip())
    except Exception:
        # Logged, never returned. A stack trace means nothing to the
        # storefront, which is going to keep the fallback either way.
        traceback.print_exc()
        return JSONResponse({"title": None})

    return JSONResponse({"title": clean_title(raw)})
```

And register it:

```python
        Route("/title", title, methods=["POST"]),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_agent_server.py -q`
Expected: PASS

- [ ] **Step 6: Run the whole agent suite**

Run: `.venv/Scripts/python.exe -m pytest -q`
Expected: all green

- [ ] **Step 7: Commit**

```bash
git add agent/titles.py agent_server.py tests/test_agent_server.py
git commit -m "$(cat <<'EOF'
feat: POST /title names a conversation

One cheap model call over both halves of the first exchange -- the
subject is often not in the question, since "and the second one?" names
nothing on its own.

No tools, no MCP session, no customer bearer: naming is a text task, and
giving this endpoint tools would put a second, quieter path to the
customer's orders beside the one the approval design guards.

Always 200 with a title or a null. The storefront's fallback is the
customer's own words, so a naming failure is an answer, not an error.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: the store reads the first exchange and names a chat once

**Files:**
- Modify: `mcp-ecom-web-app/apps/web/lib/assistant/conversation-store.ts`
- Test: `mcp-ecom-web-app/apps/web/tests/integration/assistant-conversation-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/assistant-conversation-store.test.ts` (and add `firstExchange` and `nameConversation` to the import list at the top):

```typescript
describe('firstExchange', () => {
  it('reads turn zero of a chat the customer owns', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValue({
      title: null,
      turns: [{ utterance: 'what did I order?', events: [{ type: 'message' }] }],
    });

    expect(await firstExchange('user_a', 'conv_1')).toEqual({
      title: null,
      utterance: 'what did I order?',
      events: [{ type: 'message' }],
    });
    expect(mockPrisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'conv_1', userId: 'user_a' } })
    );
  });

  it('reads ONE turn, not the whole conversation', async () => {
    // Naming needs the first exchange. Reading a long chat to name it
    // would grow with the chat.
    mockPrisma.conversation.findFirst.mockResolvedValue({ title: null, turns: [] });

    await firstExchange('user_a', 'conv_1');

    const [args] = mockPrisma.conversation.findFirst.mock.calls[0];
    expect(args.select.turns.take).toBe(1);
    expect(args.select.turns.orderBy).toEqual({ seq: 'asc' });
  });

  it('finds nothing for another customer', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValue(null);

    expect(await firstExchange('user_b', 'conv_1')).toBeNull();
  });

  it('finds nothing for a chat with no turns yet', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValue({ title: null, turns: [] });

    expect(await firstExchange('user_a', 'conv_1')).toBeNull();
  });
});

describe('nameConversation', () => {
  it('names a chat that has no name yet', async () => {
    mockPrisma.conversation.updateMany.mockResolvedValue({ count: 1 });

    expect(await nameConversation('user_a', 'conv_1', 'Recent orders')).toBe(true);
  });

  it('will not rename a chat that already has a name', async () => {
    // THE MUST PROVE for idempotency, and it is ONE query: "unnamed" and
    // "yours" are the same atomic condition, so a double-fired request
    // matches nothing rather than racing a read.
    mockPrisma.conversation.updateMany.mockResolvedValue({ count: 0 });

    expect(await nameConversation('user_a', 'conv_1', 'Recent orders')).toBe(false);
    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'conv_1', userId: 'user_a', title: null },
      data: { title: 'Recent orders' },
    });
  });

  it('will not name another customer chat', async () => {
    mockPrisma.conversation.updateMany.mockResolvedValue({ count: 0 });

    expect(await nameConversation('user_b', 'conv_1', 'Recent orders')).toBe(false);
    const [args] = mockPrisma.conversation.updateMany.mock.calls[0];
    expect(args.where.userId).toBe('user_b');
  });
});
```

Add `updateMany: jest.fn(),` to the `conversation` block of `mockPrisma` at the top of the file, and `mockPrisma.conversation.updateMany.mockReset();` to `beforeEach`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest --selectProjects integration --testPathPattern "conversation-store"`
Expected: FAIL — `firstExchange is not a function`

- [ ] **Step 3: Write the implementation**

Append to `lib/assistant/conversation-store.ts`:

```typescript
/** A chat's first turn, and whether it is already named. */
export interface FirstExchange {
  title: string | null;
  utterance: string;
  events: unknown[];
}

/**
 * Turn zero of one chat, for naming it.
 *
 * ONE turn, because that is what a name is made of, and reading the whole
 * conversation to write a sixty-character string would grow with the
 * conversation.
 *
 * The title comes back too so the caller can stop before spending a model
 * call on a chat that already has a name. The write is still guarded
 * independently -- see nameConversation -- because this read and that
 * write are not one transaction.
 */
export async function firstExchange(
  userId: string,
  id: string
): Promise<FirstExchange | null> {
  const conversation = await prisma.conversation.findFirst({
    where: { id, userId },
    select: {
      title: true,
      turns: {
        orderBy: { seq: 'asc' },
        take: 1,
        select: { utterance: true, events: true },
      },
    },
  });

  const turn = conversation?.turns[0];
  if (!conversation || !turn) return null;

  return {
    title: conversation.title,
    utterance: turn.utterance,
    events: (turn.events ?? []) as unknown[],
  };
}

/**
 * Name a chat, but only if it has no name and only if it is this
 * customer's. True if it was named, false if there was nothing to name.
 *
 * ONE updateMany, not a read then a write. `title: null` in the `where`
 * makes "still unnamed" part of the same atomic condition as "yours", so
 * two tabs racing -- or one request fired twice, which the browser is
 * allowed to do here -- cannot both write. The second matches zero rows
 * and says so.
 *
 * updateMany rather than update for the reason deleteConversation uses
 * deleteMany: update THROWS when nothing matches, and a throw is a
 * different observable answer from "not yours".
 */
export async function nameConversation(
  userId: string,
  id: string,
  title: string
): Promise<boolean> {
  const { count } = await prisma.conversation.updateMany({
    where: { id, userId, title: null },
    data: { title },
  });

  return count > 0;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest --selectProjects integration --testPathPattern "conversation-store"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/assistant/conversation-store.ts tests/integration/assistant-conversation-store.test.ts
git commit -m "$(cat <<'EOF'
feat: read a chat's first exchange, and name it exactly once

The write is one updateMany with title: null in the where clause, so
"still unnamed" and "yours" are the same atomic condition. A request
fired twice matches zero rows the second time rather than racing a read.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: the title route

**Files:**
- Create: `mcp-ecom-web-app/apps/web/app/api/assistant/conversations/[id]/title/route.ts`
- Test: `mcp-ecom-web-app/apps/web/tests/integration/api-assistant-title.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/api-assistant-title.test.ts`:

```typescript
// tests/integration/api-assistant-title.test.ts
//
// POST /api/assistant/conversations/{id}/title
//
// THE REQUEST CARRIES NO BODY. The obvious design has the browser send
// the exchange it just watched; that would make this endpoint a way to
// put attacker-chosen text in front of the model on this project's
// account, and a way to write a near-arbitrary string into a row. The
// route reads turn zero out of the database instead.

jest.mock('next-auth/jwt', () => ({
  ...jest.requireActual('next-auth/jwt'),
  getToken: jest.fn(),
}));

jest.mock('@/lib/assistant/conversation-store', () => ({
  firstExchange: jest.fn(),
  nameConversation: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import { POST } from '@/app/api/assistant/conversations/[id]/title/route';
import {
  firstExchange,
  nameConversation,
} from '@/lib/assistant/conversation-store';

const mockGetToken = getToken as unknown as jest.Mock;
const mockFirst = firstExchange as unknown as jest.Mock;
const mockName = nameConversation as unknown as jest.Mock;
const SIGNED_IN = { sub: 'user_1', email: 'c@example.com', role: 'USER' };

const EXCHANGE = {
  title: null,
  utterance: 'what did I order recently?',
  events: [
    { v: 1, seq: 0, type: 'message', data: { text: 'You have two orders.' } },
  ],
};

function ask(id = 'conv_1') {
  return {
    req: new NextRequest(
      `https://example.com/api/assistant/conversations/${id}/title`,
      { method: 'POST' }
    ),
    ctx: { params: Promise.resolve({ id }) },
  };
}

function agentSays(title: unknown, status = 200) {
  return jest.fn().mockResolvedValue(
    new Response(JSON.stringify({ title }), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  );
}

const originalFetch = global.fetch;

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = 'test-secret-value-for-the-title-route';
  process.env.AGENT_SERVICE_URL = 'https://agent.example.com';
  process.env.AGENT_SERVICE_KEY = 'agent-key';
  mockGetToken.mockReset().mockResolvedValue(SIGNED_IN);
  mockFirst.mockReset().mockResolvedValue(EXCHANGE);
  mockName.mockReset().mockResolvedValue(true);
  global.fetch = agentSays('Recent order history');
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('POST /api/assistant/conversations/{id}/title', () => {
  it('refuses an unauthenticated caller and spends nothing', async () => {
    mockGetToken.mockResolvedValue(null);
    const { req, ctx } = ask();

    expect((await POST(req, ctx)).status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('names the conversation from what the agent answered', async () => {
    const { req, ctx } = ask();
    const response = await POST(req, ctx);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { title: 'Recent order history' },
    });
    expect(mockName).toHaveBeenCalledWith(
      'user_1',
      'conv_1',
      'Recent order history'
    );
  });

  it('sends the agent the stored exchange, not anything the caller sent', async () => {
    const { req, ctx } = ask();
    await POST(req, ctx);

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    const sent = JSON.parse(init.body);

    expect(String(url)).toBe('https://agent.example.com/title');
    expect(sent.utterance).toBe('what did I order recently?');
    expect(sent.answer).toContain('You have two orders.');
  });

  it('answers 404 for a conversation that is not this customer', async () => {
    // The same answer as one that does not exist, like every other route
    // here: a distinguishable refusal confirms a stranger's id is real.
    mockFirst.mockResolvedValue(null);
    const { req, ctx } = ask();

    expect((await POST(req, ctx)).status).toBe(404);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does nothing at all for a chat that is already named', async () => {
    // Idempotent, and cheaply so: the model call never happens.
    mockFirst.mockResolvedValue({ ...EXCHANGE, title: 'Recent order history' });
    const { req, ctx } = ask();

    const response = await POST(req, ctx);

    expect(response.status).toBe(200);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockName).not.toHaveBeenCalled();
  });

  it('keeps the fallback when the agent is unreachable', async () => {
    // THE MUST PROVE. Every failure path leaves the row untouched, and
    // none of them is an error the browser has to handle -- the chat
    // already has a usable name.
    global.fetch = jest.fn().mockRejectedValue(new Error('agent is down'));
    const { req, ctx } = ask();

    const response = await POST(req, ctx);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { title: null } });
    expect(mockName).not.toHaveBeenCalled();
  });

  it('keeps the fallback when the agent answers an error', async () => {
    global.fetch = agentSays(null, 502);
    const { req, ctx } = ask();

    expect((await POST(req, ctx)).status).toBe(200);
    expect(mockName).not.toHaveBeenCalled();
  });

  it('keeps the fallback when the agent has no name to offer', async () => {
    global.fetch = agentSays(null);
    const { req, ctx } = ask();

    expect((await POST(req, ctx)).status).toBe(200);
    expect(mockName).not.toHaveBeenCalled();
  });

  it('refuses a title that is not a string', async () => {
    // The agent cleans its own output. This is the layer that does not
    // depend on that one being right.
    global.fetch = agentSays({ nested: 'nonsense' });
    const { req, ctx } = ask();

    expect((await POST(req, ctx)).status).toBe(200);
    expect(mockName).not.toHaveBeenCalled();
  });

  it('caps a title the agent did not cap', async () => {
    global.fetch = agentSays('x'.repeat(500));
    const { req, ctx } = ask();

    await POST(req, ctx);

    expect(mockName.mock.calls[0][2].length).toBeLessThanOrEqual(60);
  });

  it('never lets the service key reach the browser', async () => {
    const { req, ctx } = ask();
    const body = await (await POST(req, ctx)).text();

    expect(body).not.toContain('agent-key');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest --selectProjects integration --testPathPattern "assistant-title"`
Expected: FAIL — cannot find the route module.

- [ ] **Step 3: Write the route**

Create `app/api/assistant/conversations/[id]/title/route.ts`:

```typescript
// app/api/assistant/conversations/[id]/title/route.ts
//
// POST -- name a conversation after its first exchange.
//
// THE REQUEST CARRIES NO BODY, AND THAT IS THE DESIGN. The obvious
// version has the browser POST the exchange it just watched. That would
// make this endpoint two things it must not be: a way to put
// attacker-chosen text in front of the model on this project's account,
// and a way to write a near-arbitrary string into a row that is rendered
// in every future page load of the panel. Reading turn zero back out of
// the database costs one query and removes both.
//
// IT NEVER FAILS IN A WAY THE BROWSER HAS TO HANDLE. A chat always has a
// usable name -- the customer's own first message -- so every way this
// can go wrong answers 200 with a null title and leaves the row alone.
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import { fail, ok } from '../../../../v1/_lib/respond';
import { firstExchange, nameConversation } from '@/lib/assistant/conversation-store';
import { replay } from '@/lib/assistant/events';
import type { AssistantEvent } from '@/lib/assistant/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The same 60 the fallback name is truncated at, so the list stays even. */
const TITLE_LIMIT = 60;

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const secret = process.env.NEXTAUTH_SECRET;
  const agentUrl = process.env.AGENT_SERVICE_URL;
  const agentKey = process.env.AGENT_SERVICE_KEY;

  const session = secret ? await getToken({ req, secret }) : null;
  if (!session?.sub) return fail(401, 'Authentication required');

  const { id } = await params;

  const exchange = await firstExchange(session.sub as string, id);
  // The same 404 as a conversation that does not exist, and the same one
  // as a conversation with no turns: none of them is nameable, and a
  // distinguishable refusal confirms a stranger's id is real.
  if (!exchange) return fail(404, 'No such conversation');

  // Already named. Checked before the model call rather than only at the
  // write, so a re-fired request costs a query rather than a token.
  if (exchange.title) return ok({ title: exchange.title });

  if (!agentUrl || !agentKey) return ok({ title: null });

  // The answer the customer actually saw, rebuilt with the same reducer
  // the panel renders from. Never re-derived here: one mapping, one
  // implementation.
  const answer = replay(exchange.events as AssistantEvent[]).text.join('\n');

  let raw: unknown = null;
  try {
    const response = await fetch(`${agentUrl}/title`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agent-key': agentKey },
      body: JSON.stringify({ utterance: exchange.utterance, answer }),
    });

    if (response.ok) raw = (await response.json())?.title;
  } catch {
    // A name is never worth an error. The fallback is already on screen.
  }

  // The agent cleans its own output; this is the layer that does not
  // depend on that one being right, and it is two lines.
  if (typeof raw !== 'string' || !raw.trim()) return ok({ title: null });
  const title = raw.trim().slice(0, TITLE_LIMIT);

  await nameConversation(session.sub as string, id, title);

  return ok({ title });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest --selectProjects integration --testPathPattern "assistant-title"`
Expected: 11 passed

- [ ] **Step 5: Commit**

```bash
git add "app/api/assistant/conversations/[id]/title/route.ts" tests/integration/api-assistant-title.test.ts
git commit -m "$(cat <<'EOF'
feat: name a conversation from its own stored first exchange

The request carries no body. Letting the browser send the exchange would
make this a way to put attacker-chosen text in front of the model on this
project's account, and a way to write a near-arbitrary string into a row
rendered on every future page load. One query removes both.

Never fails in a way the browser must handle: a chat always has a usable
name already, so every failure answers 200 with a null and leaves the row
alone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: the panel asks for a name

**Files:**
- Modify: `mcp-ecom-web-app/apps/web/components/assistant/assistant-provider.tsx`
- Test: `mcp-ecom-web-app/apps/web/tests/unit/assistant-provider.test.tsx`, `tests/unit/assistant-conversation-list.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/assistant-provider.test.tsx`:

```typescript
describe('naming a conversation', () => {
  it('asks for a name after the first turn', async () => {
    // Once, after turn one. The row exists by now -- the bridge created
    // it -- and the panel knows its id from the response header.
    const { calls } = await sendOneTurn();

    const titleCalls = calls.filter((url) => url.endsWith('/title'));
    expect(titleCalls).toHaveLength(1);
    expect(titleCalls[0]).toContain('/api/assistant/conversations/');
  });

  it('does not ask again on later turns', async () => {
    // The route is idempotent anyway, so this is about not spending a
    // request per message for the life of a conversation.
    const { calls } = await sendTwoTurns();

    expect(calls.filter((url) => url.endsWith('/title'))).toHaveLength(1);
  });

  it('does not ask when the turn produced nothing', async () => {
    // A turn that errored has no answer to name, and the row may not
    // even have been written.
    const { calls } = await sendFailedTurn();

    expect(calls.filter((url) => url.endsWith('/title'))).toHaveLength(0);
  });

  it('leaves the chat working when naming fails', async () => {
    // THE MUST PROVE, on this side: the panel must not care.
    const { status, turns } = await sendOneTurnWithFailingTitle();

    expect(status).toBe('idle');
    expect(turns).toHaveLength(1);
  });
});
```

Write the four helpers against the file's existing harness — it already has a pattern for rendering the provider, dispatching `fetch` by URL and driving a turn to completion. Follow it exactly rather than inventing a second one; the existing tests in this file show the shape, including the `headers: { get: () => null }` stub every stand-in `Response` needs and the URL-dispatching mock introduced in Phase 2.

Append to `tests/unit/assistant-conversation-list.test.tsx`:

```typescript
  it('renders a MODEL-written name as text, never as markup', () => {
    // The existing case covers a name the customer typed. From Phase 4 a
    // name can be written by a model, out of an exchange that may have
    // carried untrusted product copy -- a different provenance, the same
    // rule.
    renderList({
      conversations: [
        {
          id: 'conv_x',
          name: '<script>alert(1)</script>Order help',
          lastTurnAt: NOW.toISOString(),
        },
      ],
    });

    expect(
      screen.getByText('<script>alert(1)</script>Order help')
    ).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest --selectProjects unit --testPathPattern "assistant-provider|conversation-list"`
Expected: FAIL — no `/title` request is made.

- [ ] **Step 3: Ask for the name**

In `components/assistant/assistant-provider.tsx`, add to `send()`, immediately before the existing `void refreshChats();`:

```typescript
      // A NAME, ONCE, AFTER THE FIRST TURN. Fired here rather than from
      // the bridge because the bridge is holding the customer's stream
      // open, and a model call for a cosmetic string does not belong on
      // that path.
      //
      // The outcome is ignored on purpose: the route is idempotent, and
      // a chat that fails to be named keeps the customer's own first
      // message as its name. Awaited only so the list refresh below sees
      // the new title on its first try rather than the next one.
      if (turnConversationId && wasFirstTurn && received > 0) {
        try {
          await fetch(
            `/api/assistant/conversations/${encodeURIComponent(
              turnConversationId
            )}/title`,
            { method: 'POST' }
          );
        } catch {
          // Nothing to do and nothing to say. The fallback name is
          // already on screen.
        }
      }
```

`wasFirstTurn` is captured **before** the stream is read, from the turn count at the time the message was sent:

```typescript
    const wasFirstTurn = turns.length === 0;
```

placed alongside the other locals at the top of `send()`. `turnConversationId` is the id this turn belongs to — the one already read from the `x-conversation-id` header — held in a local rather than read back off state, because state has not settled by the time this runs.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest --selectProjects unit --testPathPattern "assistant-provider|conversation-list"`
Expected: PASS

- [ ] **Step 5: Run the whole storefront suite, typecheck and build**

```bash
npx jest && npx tsc --noEmit && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add components/assistant/assistant-provider.tsx tests/unit/assistant-provider.test.tsx tests/unit/assistant-conversation-list.test.tsx
git commit -m "$(cat <<'EOF'
feat: the panel asks for a name after the first turn

From the browser rather than the bridge: the bridge is holding the
customer's stream open, and a model call for a cosmetic string does not
belong on that path.

The outcome is ignored. The route is idempotent, and a chat that fails to
be named keeps the customer's own first message.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: deploy, verify live, record

- [ ] **Step 1: Push the agent first, then the storefront**

Same order and the same reason as Phase 5: a new agent serves an old storefront unchanged, but a new storefront against an old agent would POST `/title` to a 404 on every first turn — harmless (it keeps the fallback) but pointlessly noisy.

Confirm the agent deploy carries the commit with `curl -s https://agent-production-79c8.up.railway.app/health` and check the `sha`.

- [ ] **Step 2: Verify live**

Signed in as the demo customer, using the app's own sign-in button:

1. Press `+`, ask something with a clear subject, wait for the answer, then open the history — the new row should carry a **model-written name**, not the question verbatim.
2. Send a second message in that chat and confirm **no second `/title` request** is made (wrap `window.fetch` and read the log — do not eyeball it).
3. Reload the page and confirm the name persisted.
4. Confirm the four **pre-existing chats still show their fallback names** and are unaffected.
5. Read the `/title` response in devtools and confirm it is `{"data":{"title":...}}` with no service key anywhere in it.

- [ ] **Step 3: Mutation-test**

| Mutation | Test that must catch it |
|---|---|
| `clean_title` stops stripping URLs | the URL tests, Task 1 |
| `nameConversation` drops `title: null` from the `where` | "will not rename a chat that already has a name", Task 3 |
| `nameConversation` drops `userId` from the `where` | "will not name another customer chat", Task 3 |
| the route reads the utterance from the request body instead of the store | "sends the agent the stored exchange", Task 4 |
| the route names the chat even when `raw` is not a string | "refuses a title that is not a string", Task 4 |
| the provider asks for a title on every turn | "does not ask again on later turns", Task 5 |

- [ ] **Step 4: Record it in both plan documents and push**

Append dated sections to `docs/PLAN_M4_STOREFRONT.txt` and `../../mcp-ecom-agent-layer/docs/PLAN_M4_AGENT.txt` in the established style, saying what was verified live and what was not. Record specifically: that existing chats are deliberately not backfilled; that the request carries no body and why; and any mutation that survived and what was done about it.

---

## Self-review notes

**Spec coverage.** The roadmap's Phase 4 asks for `POST /api/assistant/conversations/{id}/title`, idempotent, writing only when `title` is null (Tasks 3 and 4), and an agent `POST /title` (Task 2). Both MUST PROVEs have named tests: a failed title call leaving the chat usable (Task 4, four separate failure paths, plus Task 5) and the title rendered as plain text (Task 5).

**Type consistency.** `FirstExchange` is returned by `firstExchange` and consumed by the route. `TITLE_LIMIT` is 60 in both languages and matches the existing `NAME_LIMIT` in `conversation-store.ts` — three constants with one value, in three modules that must not import each other; the plan states the shared reason in each.

**Placeholders.** One, deliberately: Task 5's four test helpers are described rather than written out, because this file's harness already exists and inventing a second one beside it would be the mistake. Everything else shows its code.
