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

export interface Turn {
  utterance: string;
}

interface AssistantContextValue {
  events: AssistantEvent[];
  conversation: Conversation;
  turns: Turn[];
  status: AssistantStatus;
  send: (utterance: string) => Promise<void>;
}

const AssistantContext = createContext<AssistantContextValue | undefined>(
  undefined
);

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const [events, setEvents] = useState<AssistantEvent[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<AssistantStatus>('idle');

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
          if (event) setEvents((previous) => [...previous, event]);
        }
      }

      setStatus('idle');
    } catch {
      setStatus('error');
    } finally {
      inFlight.current = false;
    }
  }, []);

  // The single source of truth for what is on screen.
  const conversation = useMemo(() => replay(events), [events]);

  const value = useMemo(
    () => ({ events, conversation, turns, status, send }),
    [events, conversation, turns, status, send]
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
