'use client';

// components/assistant/assistant-provider.tsx
//
// The conversation and the connection that fills it, mounted once in
// app/layout.tsx so a client-side navigation re-renders the page beneath
// it and leaves both alone.
//
// IT STORES EVENTS, NOT MESSAGES. The conversation is derived by
// replay() on every render. Pushing a message onto a list as each event
// arrives is the obvious alternative and it is a trap: it would be a
// second implementation of the reducer, living in the UI, untested
// against the golden stream -- and then the contract the agent and the
// storefront both agree on would describe something the screen does not
// show. Deriving costs a reduce over a few dozen items and buys the
// guarantee the whole contract exists for.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

import {
  type AssistantEvent,
  type Conversation,
  parseEvent,
  replay,
} from '@/lib/assistant/events';
import { SseParser } from '@/lib/assistant/sse';

export type AssistantStatus = 'idle' | 'streaming' | 'error';

/**
 * What this browser has done about a pending approval.
 *
 * LOCAL ONLY, and deliberately not part of the conversation. It says what
 * the customer clicked, never what the shop did -- 'approved' means "the
 * answer was delivered", and whether the order was actually cancelled is
 * reported by the tool_completed event like every other tool result. A
 * high-risk action never renders optimistically.
 */
export type DecisionState = 'sending' | 'approved' | 'declined' | 'failed';

export interface Turn {
  utterance: string;
  /**
   * The events this turn produced.
   *
   * GROUPED, not flat. A single array for the whole conversation cannot
   * say which reply answered which question, so a two-turn transcript
   * cannot be ordered however well the reducer sorts one turn. This is
   * also the shape a persisted ConversationTurn takes.
   */
  events: AssistantEvent[];
}

/** One row of the history list. Shaped by the list route, not by Prisma. */
export interface ListedChat {
  id: string;
  name: string;
  lastTurnAt: string;
}

export interface TranscriptEntry {
  utterance: string;
  conversation: Conversation;
}

/**
 * Tools that change something the rest of the site renders.
 *
 * Used to decide whether the page around the panel is now stale. Not a
 * list of write tools in general -- a write nobody renders needs no
 * refresh, and refreshing anyway would cost a re-render of every server
 * component on the page for nothing.
 */
const CHANGING_TOOLS = new Set(['add_to_cart', 'remove_from_cart', 'cancel_order']);

interface AssistantContextValue {
  /** The conversation being had, or null before the first message. */
  conversationId: string | null;
  /** Every chat this customer has had, most recently active first. */
  conversations: ListedChat[];
  /** Clear the panel for a fresh chat. Stores nothing. */
  newChat: () => void;
  /** Replace the panel with a stored chat. */
  openConversation: (id: string) => Promise<void>;
  /** Remove a chat. Clears the panel if it was the open one. */
  deleteConversation: (id: string) => Promise<void>;
  events: AssistantEvent[];
  conversation: Conversation;
  turns: Turn[];
  /** What the panel renders: one entry per turn, in order. */
  transcript: TranscriptEntry[];
  status: AssistantStatus;
  send: (utterance: string) => Promise<void>;
  /** Ask the last question again, after a tool call failed. */
  retry: () => void;
  approve: (callId: string, approved: boolean) => Promise<void>;
  answered: Record<string, DecisionState>;
}

const AssistantContext = createContext<AssistantContextValue | undefined>(
  undefined
);

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<AssistantStatus>('idle');
  // How a change made in the panel reaches the pages around it. See the
  // refresh in send() for why this is needed at all.
  const router = useRouter();
  // Named apart from the panel's own `status`, which is the turn's
  // lifecycle and a completely different thing.
  const { status: signedIn } = useSession();
  const [answered, setAnswered] = useState<Record<string, DecisionState>>({});
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ListedChat[]>([]);

  // Quiet on failure, like the resume. A customer who cannot see the list
  // of old chats can still have a new one, and an error banner over a
  // sidebar is worse than an empty sidebar.
  const refreshChats = useCallback(async () => {
    try {
      const response = await fetch('/api/assistant/conversations', {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) return;
      const body = await response.json();
      setConversations(body?.data?.conversations ?? []);
    } catch {
      // Nothing to show. The panel still works.
    }
  }, []);

  // RESUME ON MOUNT. Mounted once in the root layout, so this runs once
  // per page load rather than once per navigation.
  //
  // A failure here is deliberately quiet. Not being able to show
  // yesterday's chat is a disappointment; refusing to let the customer
  // start a new one over it would be a fault.
  useEffect(() => {
    // NOBODY SIGNED IN MEANS NOTHING TO RESUME. Both requests below need
    // a customer session, so without one they could only ever answer 401
    // -- two of them on every signed-out page load, which is what sent a
    // real investigation looking at the agent instead of at the session.
    if (signedIn !== 'authenticated') return;

    let live = true;

    void refreshChats();

    fetch('/api/assistant/conversations/latest', {
      headers: { accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then((body) => {
        const stored = body?.data?.conversation;
        if (!live || !stored) return;

        // NEVER CLOBBER A CONVERSATION ALREADY UNDER WAY. This response
        // can land after the customer has already sent their first
        // message -- they opened the panel and typed immediately, or the
        // network was slow. Hydrating unconditionally would delete the
        // turn they are watching and file their next message into the
        // wrong chat.
        setConversationId((current) => current ?? stored.id);
        setTurns((current) =>
          current.length > 0
            ? current
            : (stored.turns ?? []).map(
            (turn: { utterance: string; events: unknown[] }) => ({
              utterance: turn.utterance,
              // THE SAME DOOR AS THE LIVE STREAM. These rows were written
              // by the agent; a tampered or older-schema event must be
              // dropped, not rendered, and certainly not allowed to throw.
              events: (turn.events ?? [])
                .map(parseEvent)
                .filter((event): event is AssistantEvent => event !== null),
            })
              )
        );
      })
      .catch(() => {
        // Nothing to resume, or it could not be read. Either way the
        // panel opens empty and works.
      });

    return () => {
      live = false;
    };
    // signedIn, so a customer who signs in without a page load still
    // gets their history resumed rather than an empty panel until they
    // reload.
  }, [refreshChats, signedIn]);

  // A ref rather than the state value: two clicks in the same tick would
  // both read the same stale `status` and both fire.
  const inFlight = useRef(false);

  const send = useCallback(async (utterance: string) => {
    const asked = utterance.trim();
    if (!asked || inFlight.current) return;

    // Captured BEFORE anything is sent. By the time the stream ends this
    // turn is already in `turns`, so asking then would always say no.
    const wasFirstTurn = turns.length === 0;
    // Whether this turn changed something the pages around the panel
    // render. Tracked as the events arrive rather than read off state
    // afterwards, because state has not settled when the stream ends.
    let changedSomething = false;
    // The chat this turn belongs to, held in a local rather than read
    // back off state: setConversationId below has not settled by the time
    // the naming request goes out.
    let turnConversationId = conversationId;

    inFlight.current = true;
    setStatus('streaming');
    setTurns((previous) => [...previous, { utterance: asked, events: [] }]);

    try {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          conversationId ? { utterance: asked, conversationId } : { utterance: asked }
        ),
      });

      // The bridge creates the conversation on the first message and names
      // it here. Without adopting it, every message would start a new one.
      const named = response.headers.get('x-conversation-id');
      if (named) {
        setConversationId(named);
        turnConversationId = named;
      }

      if (!response.ok || !response.body) {
        setStatus('error');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = new SseParser();
      let received = 0;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        for (const item of parser.push(decoder.decode(value, { stream: true }))) {
          if (item.event !== 'assistant') continue;

          let raw: unknown;
          try {
            raw = JSON.parse(item.data);
          } catch {
            // A frame that is not JSON is a frame to drop. Never a
            // reason to end a conversation the customer is reading.
            continue;
          }

          const event = parseEvent(raw);
          if (event) {
            received += 1;

            if (
              event.type === 'tool_completed' &&
              event.data?.ok === true &&
              CHANGING_TOOLS.has(String(event.data?.tool))
            ) {
              changedSomething = true;
            }

            setTurns((previous) => {
              // The turn was appended before the request went out, so
              // there is always one to file under. Narrowed rather than
              // asserted: an event arriving with no open turn would mean
              // the stream outlived its own send(), and silently dropping
              // it is better than a crash mid-conversation.
              const current = previous[previous.length - 1];
              if (!current) return previous;

              return [
                ...previous.slice(0, -1),
                { ...current, events: [...current.events, event] },
              ];
            });
          }
        }
      }

      // A STREAM THAT ENDED WITH NOTHING IN IT IS A FAILURE, not an
      // answer. The connection opening successfully proves only that the
      // bridge route replied; a turn that died behind it closes just as
      // cleanly as one that finished. Reporting idle here leaves the
      // customer looking at their own question and no reply, with nothing
      // to act on -- which is exactly what a broken agent deploy looked
      // like from the outside.
      // A NAME, ONCE, AFTER THE FIRST TURN. Asked for from here rather
      // than from the bridge because the bridge is holding the customer's
      // stream open, and a model call for a cosmetic string does not
      // belong on that path.
      //
      // The outcome is ignored on purpose: the route is idempotent, and a
      // chat that fails to be named keeps the customer's own first
      // message. Awaited only so the list refresh below sees the new
      // title on its first try rather than the next one.
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

      // The chat may have just been created by this very message, and its
      // name comes from this utterance. Refreshed after the stream rather
      // than before, because the row does not exist until the turn lands.
      void refreshChats();

      // A CHANGE MADE HERE MUST BE VISIBLE EVERYWHERE. The write already
      // went through the same /api/v1 a manual action does -- what is
      // stale is the server-rendered page AROUND this panel. The cart
      // page fixes exactly this staleness for its own buttons with
      // router.refresh(); this is the same fix for the same problem.
      //
      // Only when something actually changed, and only when it
      // succeeded: a refresh re-renders every server component on the
      // page, and doing it after "what did I order?" would make every
      // question cost one for no change at all.
      if (changedSomething) router.refresh();

      setStatus(received === 0 ? 'error' : 'idle');
    } catch {
      setStatus('error');
    } finally {
      inFlight.current = false;
    }
    // conversationId is a dependency: without it the first message after a
    // resume would be sent with a stale null and strand the old chat.
  }, [conversationId, refreshChats, router, turns.length]);

  /**
   * Ask the last question again.
   *
   * A failed tool call leaves the customer looking at a red chip. The
   * design's MUST PROVE is that a failure offers a way forward rather
   * than a stalled spinner, and the simplest honest one is "ask again":
   * the failure may have been transient, and nobody should have to
   * retype a question to find out.
   *
   * A NEW turn, not a resumed one. Resuming would mean the agent
   * re-entering a graph it has already finished, and the failed turn is
   * already written down.
   */
  const retry = useCallback(() => {
    if (inFlight.current) return;

    const last = turns[turns.length - 1];
    if (!last) return;

    void send(last.utterance);
  }, [send, turns]);

  /**
   * Answer a pending approval.
   *
   * Sends a call_id and a yes or no. NOT the arguments, NOT the order --
   * the route recalls those from what the bridge watched go past, because
   * a token minted for arguments a browser supplied would certify
   * whatever the browser claimed. See lib/assistant/approvals.ts.
   *
   * Marked as 'sending' before the request so the buttons disappear on
   * the first click rather than the first response. The route refuses a
   * second decision anyway, and so does the agent; this is the third
   * guard, and the only one that stops the customer seeing two buttons
   * they think still work.
   */
  const approve = useCallback(async (callId: string, approved: boolean) => {
    setAnswered((previous) => {
      if (previous[callId]) return previous;
      return { ...previous, [callId]: 'sending' };
    });

    try {
      const response = await fetch(
        `/api/assistant/approval/${encodeURIComponent(callId)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ approved }),
        }
      );

      setAnswered((previous) => ({
        ...previous,
        [callId]: response.ok ? (approved ? 'approved' : 'declined') : 'failed',
      }));
    } catch {
      setAnswered((previous) => ({ ...previous, [callId]: 'failed' }));
    }
  }, []);

  /**
   * Clear the panel for a fresh chat.
   *
   * STORES NOTHING. The row is created by the bridge on the first message,
   * exactly as in Phase 2 -- a row created here would leave a phantom
   * empty chat in the list every time somebody pressed + and changed
   * their mind.
   */
  const newChat = useCallback(() => {
    // The stream in flight belongs to the chat that is open. Switching
    // out from under it would file its answer against the wrong
    // conversation. The header disables the button too; this is the
    // guard that does not depend on rendering.
    if (inFlight.current) return;

    setTurns([]);
    setConversationId(null);
    setAnswered({});
    setStatus('idle');
  }, []);

  /** Replace the panel with a stored chat. */
  const openConversation = useCallback(async (id: string) => {
    if (inFlight.current) return;

    try {
      const response = await fetch(
        `/api/assistant/conversations/${encodeURIComponent(id)}`,
        { headers: { accept: 'application/json' } }
      );
      if (!response.ok) return;

      const body = await response.json();
      const stored = body?.data?.conversation;
      if (!stored) return;

      setConversationId(stored.id);
      setAnswered({});
      setStatus('idle');
      setTurns(
        (stored.turns ?? []).map(
          (turn: { utterance: string; events: unknown[] }) => ({
            utterance: turn.utterance,
            // The same door as the live stream and the resume: these rows
            // were written by the agent.
            events: (turn.events ?? [])
              .map(parseEvent)
              .filter((event): event is AssistantEvent => event !== null),
          })
        )
      );
    } catch {
      // The chat stays as it was. Failing to open an old conversation
      // must not close the one being had.
    }
  }, []);

  /**
   * Remove a chat.
   *
   * Clears the panel when the deleted chat is the open one. Leaving the
   * transcript up after its rows are gone would show a conversation that
   * no longer exists, and the next message would be posted against a
   * deleted id -- a 404 on a chat the customer is reading.
   */
  const deleteConversation = useCallback(async (id: string) => {
    try {
      const response = await fetch(
        `/api/assistant/conversations/${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );
      if (!response.ok) return;

      setConversations((previous) => previous.filter((chat) => chat.id !== id));
      setConversationId((previous) => {
        if (previous !== id) return previous;
        setTurns([]);
        setAnswered({});
        return null;
      });
    } catch {
      // Nothing removed, nothing changed on screen.
    }
  }, []);

  // Derived, so `turns` stays the single source of truth. `events` is kept
  // flat for callers that want the raw stream and for the gap report.
  const events = useMemo(() => turns.flatMap((turn) => turn.events), [turns]);

  // What the panel renders. replay() remains the ONLY reducer -- run once
  // per turn now rather than once per conversation.
  const transcript = useMemo(
    () =>
      turns.map((turn) => ({
        utterance: turn.utterance,
        conversation: replay(turn.events),
      })),
    [turns]
  );

  const conversation = useMemo(() => replay(events), [events]);

  const value = useMemo(
    () => ({
      conversationId,
      conversations,
      newChat,
      openConversation,
      deleteConversation,
      events,
      conversation,
      transcript,
      turns,
      status,
      send,
      retry,
      approve,
      answered,
    }),
    [
      conversationId,
      conversations,
      newChat,
      openConversation,
      deleteConversation,
      events,
      conversation,
      transcript,
      turns,
      status,
      send,
      retry,
      approve,
      answered,
    ]
  );

  return (
    <AssistantContext.Provider value={value}>
      {children}
    </AssistantContext.Provider>
  );
}

export function useAssistant(): AssistantContextValue {
  const value = useContext(AssistantContext);
  if (!value) {
    throw new Error('useAssistant must be used inside an AssistantProvider');
  }
  return value;
}
