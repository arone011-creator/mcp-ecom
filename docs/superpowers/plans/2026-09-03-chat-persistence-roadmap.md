# Persistent Named Chat History — Roadmap

> **This is NOT an implementation plan.** It records the decisions taken in
> brainstorming on 2026-09-03 and the order the work lands in, so that each
> phase's own plan can be written without re-litigating them. Phase 1 has a
> full plan: `2026-09-03-chat-phase1-chronological-transcript.md`.

**Goal:** the assistant's conversations persist across closing the panel,
logging out and restarting the browser; they are listed, named, and
individually deletable; the agent remembers earlier turns of the chat it is
in; and the transcript reads chronologically like GPT or Claude.

## Decisions (do not redesign)

| Decision | Chosen | Why it was not the alternative |
|---|---|---|
| Agent memory | Full, within one conversation | Reopening a chat and asking a follow-up must work, or the panel lies about being a conversation |
| Where memory lives | Storefront database; agent stays stateless | The storefront already owns identity, the DB and cascade deletion. The agent holds the OpenAI key and must not also hold customer data or DB credentials |
| Representation | Both display `events` AND an opaque `agentContext` blob | The event contract is frozen and display-only. Deriving model messages from events would be a third implementation of a mapping that already has two |
| Titles | Model-generated after the first exchange | Matches the reference UI. Falls back to the truncated first message so a failed title call never blocks a chat |
| Retention | Indefinite, per-chat delete, inline confirm | A shop assistant holds order history; a customer must be able to remove a chat without deleting their account |
| Memory budget | Model summarisation **layered on a hard token budget** | Summarisation alone has no ceiling. The budget is honoured even when summarisation fails, by dropping oldest turns |
| conversationId to browser | `x-conversation-id` response header | A new event type would change a frozen, cross-repo contract for something that is not an event |
| Compaction timing | Lazily, at the start of a turn | No background job, nothing to schedule, directly testable |
| Empty chats | Row created lazily on the first message | Otherwise every `+` press leaves a phantom row in the history list |

## Security constraints that carry across every phase

1. **The agent must refuse any `system` role in replayed history.** Otherwise a
   stored blob becomes a way to rewrite the system prompt.
2. **A summary is agent-authored text, not an instruction.** Replayed as
   assistant-role content, never as a system message; URL-redacted through the
   existing `redact_untrusted_urls` before storage; length-capped so it cannot
   become a payload.
3. **Summarisation cannot cross the approval boundary.** A summary claiming
   cancellation was authorised still cannot cancel anything, because
   `cancel_order` needs a token minted by non-agent code after a human click.
   This is why the chosen memory design is acceptable at all, and it must stay
   true — there is a test for it.
4. **`agentContext` never reaches the browser.** It travels agent ↔ storefront
   over the service-key channel only, like the `control` frames.
5. **Ownership answers 404, never 403.** A distinguishable refusal confirms that
   a stranger's conversation id is real.

## Phases

Each phase ships something usable and gets its own plan document.

**Phase 1 — chronological transcript.** *(planned in full; independent of the
rest)* Add an ordered `timeline` to `replay()` in both languages, re-vendor the
golden fixture, group events by turn in the provider, and render user-right /
assistant-left. Fixes a bug that exists today: the panel renders all utterances,
then all tool chips, then all assistant text.

**Phase 2 — storage and resume.** `Conversation` and `ConversationTurn` tables;
persist each turn from the bridge; `x-conversation-id`; hydrate the most recent
conversation on load. After this phase the original ask is satisfied — chat
survives close, logout and browser restart.
MUST PROVE: stored events replay to the same conversation the live stream
produced; user B cannot read user A's conversation; deleting a user removes
their conversations.

**Phase 3 — history UI.** `+` and clock icons in the panel header, history list
with title and relative time, open, per-row delete with inline confirm. Both
icons disabled while streaming.
MUST PROVE: an empty chat is never stored; switching chats mid-stream is
impossible; delete requires a second, deliberate click.

**Phase 4 — titles.** `POST /api/assistant/conversations/{id}/title`, idempotent,
writes only when `title` is null; agent `POST /title`.
MUST PROVE: a failed title call leaves the chat usable under its fallback name;
the title is rendered as plain text, never as markup.

**Phase 5 — memory, with the hard budget.** Bridge loads prior turns newest-first
under a token budget and sends them as history; agent seeds the graph with them.
MUST PROVE: the model request for turn 2 contains turn 1's content; a long
conversation never exceeds the budget; replayed history containing a `system`
role is refused.

**Phase 6 — summarisation.** Agent `POST /summarise`; bridge compacts lazily when
the budget would be exceeded; `summary` and `summarisedThrough` on the
conversation.
MUST PROVE: when `/summarise` fails the budget is still honoured by dropping
oldest turns; a summary containing an instruction cannot cause a cancellation
without an approval token; the stored summary carries no URLs.
