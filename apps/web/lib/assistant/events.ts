// lib/assistant/events.ts
//
// The TypeScript half of the assistant event contract.
//
// THE CANONICAL DEFINITION LIVES ELSEWHERE:
// mcp-ecom-agent-layer/contracts/README.md, with agent/events.py as the
// other implementation and assistant-events.v1.json as the golden stream
// both are tested against. Change the shape there, not here, and expect
// both suites to go red until both sides are updated -- that is the
// contract working, not an inconvenience to route around.
//
// ONE DELIBERATE DIFFERENCE FROM THE PYTHON, recorded because it would
// otherwise read as drift a year from now. agent/events.py::replay
// THROWS on an event from a future schema version. That is right for a
// harness: a process handed events it does not understand should stop
// loudly. It is wrong for a UI -- a throw mid-stream leaves the customer
// with half a conversation and no way forward. So here the job is split:
// parseEvent returns null for anything malformed and the caller drops
// that frame and carries on, and replay only ever sees events parseEvent
// has already accepted.

import { z } from 'zod';

export const SCHEMA_VERSION = 1;

export const EVENT_TYPES = [
  'message',
  'message_delta',
  'tool_started',
  'tool_completed',
  'approval_required',
  'error',
] as const;

/**
 * The sequence number of an event that is NOT part of the numbered
 * record: a live rendering hint produced beside the turn rather than by
 * it. Two things carry it -- message_delta, and the approval_required the
 * agent's HTTP surface emits before the graph blocks on a human -- and
 * neither may consume a number the record needs.
 */
export const OUT_OF_BAND = -1;

export type KnownEventType = (typeof EVENT_TYPES)[number];

export interface AssistantEvent {
  v: number;
  seq: number;
  // Deliberately a string rather than KnownEventType: an unrecognised
  // type is a valid event this reader ignores, not a parse failure.
  type: string;
  data: Record<string, unknown>;
}

export interface ToolActivity {
  call_id: string;
  tool: string;
  arguments?: Record<string, unknown>;
  awaiting_approval?: boolean;
  ok?: boolean;
  result?: unknown;
  error?: string;
}

export interface Conversation {
  text: string[];
  tools: ToolActivity[];
  errors: Record<string, unknown>[];
  gaps: number[];
}

const envelope = z.object({
  v: z.literal(SCHEMA_VERSION),
  seq: z.number().int(),
  type: z.string().min(1),
  data: z.record(z.unknown()),
});

/**
 * One event, or null if it cannot be trusted.
 *
 * Never throws. A malformed frame is a frame to drop, not a reason to
 * take down the stream the customer is watching.
 */
export function parseEvent(raw: unknown): AssistantEvent | null {
  const result = envelope.safeParse(raw);
  return result.success ? (result.data as AssistantEvent) : null;
}

/**
 * Rebuild a conversation from its event stream.
 *
 * A line-for-line port of agent/events.py::replay. The golden stream is
 * what proves the two agree.
 */
export function replay(events: AssistantEvent[]): Conversation {
  const text: string[] = [];
  const tools = new Map<string, ToolActivity>();
  const order: string[] = [];
  const errors: Record<string, unknown>[] = [];
  const seen: number[] = [];
  // Prose that has arrived in fragments and has not yet been closed by the
  // authoritative message. Held apart from `text` so the message can
  // replace it rather than land beside it as a duplicate.
  let pending = '';

  for (const event of events) {
    // An out-of-band event is not part of the numbered record. Counted
    // here it would drag the low end of the range down and invent gaps
    // that never happened.
    if (event.seq !== OUT_OF_BAND) seen.push(event.seq);

    const data = (event.data ?? {}) as Record<string, any>;

    if (event.type === 'message_delta') {
      pending += data.text;
      continue;
    }

    if (event.type === 'message') {
      // The message wins. Its text is redacted over the whole answer and
      // may legitimately differ from the sum of the fragments -- a link
      // the agent repeated out of a product description is removed there
      // and only there -- so where they differ, this is the one that
      // stays on screen.
      text.push(data.text);
      pending = '';
      continue;
    }

    if (event.type === 'tool_started' || event.type === 'approval_required') {
      const callId = data.call_id as string;

      // One call, not two. An approved high-risk call emits
      // approval_required and then tool_started under the SAME call_id;
      // listing it twice drew two chips for one cancellation, which the
      // live approval gate caught in the Python reducer.
      if (!tools.has(callId)) {
        order.push(callId);
        tools.set(callId, {
          call_id: callId,
          tool: data.tool,
          arguments: data.arguments,
        });
      }

      const entry = tools.get(callId)!;
      if (event.type === 'approval_required') {
        entry.awaiting_approval = true;
      } else {
        // It started, so it is no longer waiting on anyone.
        delete entry.awaiting_approval;
      }
      continue;
    }

    if (event.type === 'tool_completed') {
      const callId = data.call_id as string;

      // A completion without its start still records: half a pair is a
      // symptom worth seeing, not one worth swallowing.
      if (!tools.has(callId)) {
        order.push(callId);
        tools.set(callId, { call_id: callId, tool: data.tool });
      }

      const entry = tools.get(callId)!;
      delete entry.awaiting_approval;
      entry.ok = data.ok;
      if (data.ok) {
        entry.result = data.result;
      } else {
        entry.error = data.error;
      }
      continue;
    }

    if (event.type === 'error') {
      errors.push(data);
      continue;
    }

    // Any other type is ignored on purpose. A newer agent must not be
    // able to break an older reader.
  }

  // A run of fragments no message ever closed: the turn is still in
  // flight, or it was cut off. Either way the words are already on the
  // customer's screen, and dropping them now would erase something they
  // read -- a worse lie than an unfinished sentence.
  if (pending) text.push(pending);

  const gaps: number[] = [];
  if (seen.length > 0) {
    const observed = new Set(seen);
    for (let n = Math.min(...seen); n <= Math.max(...seen); n += 1) {
      if (!observed.has(n)) gaps.push(n);
    }
  }

  return { text, tools: order.map((callId) => tools.get(callId)!), errors, gaps };
}
