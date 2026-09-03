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
  useMemo,
  useRef,
  useState,
} from 'react';

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
}

interface AssistantContextValue {
  events: AssistantEvent[];
  conversation: Conversation;
  turns: Turn[];
  status: AssistantStatus;
  send: (utterance: string) => Promise<void>;
  approve: (callId: string, approved: boolean) => Promise<void>;
  answered: Record<string, DecisionState>;
}

const AssistantContext = createContext<AssistantContextValue | undefined>(
  undefined
);

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const [events, setEvents] = useState<AssistantEvent[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<AssistantStatus>('idle');
  const [answered, setAnswered] = useState<Record<string, DecisionState>>({});

  // A ref rather than the state value: two clicks in the same tick would
  // both read the same stale `status` and both fire.
  const inFlight = useRef(false);

  const send = useCallback(async (utterance: string) => {
    const asked = utterance.trim();
    if (!asked || inFlight.current) return;

    inFlight.current = true;
    setStatus('streaming');
    setTurns((previous) => [...previous, { utterance: asked }]);

    try {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ utterance: asked }),
      });

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
            setEvents((previous) => [...previous, event]);
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
      setStatus(received === 0 ? 'error' : 'idle');
    } catch {
      setStatus('error');
    } finally {
      inFlight.current = false;
    }
  }, []);

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

  // The single source of truth for what is on screen.
  const conversation = useMemo(() => replay(events), [events]);

  const value = useMemo(
    () => ({ events, conversation, turns, status, send, approve, answered }),
    [events, conversation, turns, status, send, approve, answered]
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
