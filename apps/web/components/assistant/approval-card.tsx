'use client';

// components/assistant/approval-card.tsx
//
// The confirmation for an irreversible action.
//
// EVERY WORD ON THIS CARD COMES FROM THE SERVER'S OWN LOOKUP of the order,
// never from the agent's prose and never from the event's payload. That is
// the rule the whole risk-tier design rests on: product descriptions and
// reviews are written by strangers and reach the agent's context, so if
// the agent wrote the words next to the button, an injected review could
// write them too.
//
// Two smaller rules that are easy to lose in a refactor:
//
//   - No buttons until the details have loaded. Never ask someone to
//     confirm something you could not describe.
//   - Approving does NOT say the order was cancelled. It says the answer
//     was sent. The agent is only now resuming the call, and the
//     tool_completed event is what reports whether it worked. A high-risk
//     action never renders optimistically.

import { useEffect, useState } from 'react';

import { useAssistant } from './assistant-provider';

interface OrderFacts {
  orderNumber: string;
  status: string;
  total: string | number;
  currency: string;
  items: { name: string; quantity: number }[];
}

// Customer-facing wording, chosen so the buttons say what happens rather
// than "OK" and "Cancel" -- which, on a card about cancelling an order,
// would be genuinely ambiguous.
const WORDING: Record<
  string,
  { title: string; confirm: string; decline: string }
> = {
  cancel_order: {
    title: 'Cancel this order?',
    confirm: 'Cancel the order',
    decline: 'Keep the order',
  },
};

export function ApprovalCard({ callId, tool }: { callId: string; tool: string }) {
  const { approve, answered } = useAssistant();
  const [facts, setFacts] = useState<OrderFacts | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const state = answered[callId];
  const words = WORDING[tool] ?? {
    title: 'Confirm this action?',
    confirm: 'Go ahead',
    decline: 'Do not',
  };

  useEffect(() => {
    let live = true;

    fetch(`/api/assistant/approval/${encodeURIComponent(callId)}`, {
      headers: { accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then((body) => {
        if (live) setFacts(body?.data?.order ?? null);
      })
      .catch(() => {
        if (live) setUnavailable(true);
      });

    return () => {
      live = false;
    };
  }, [callId]);

  if (unavailable) {
    return (
      <div
        role="alert"
        className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
      >
        The assistant asked for confirmation, but the details could not be
        loaded. Nothing has been changed.
      </div>
    );
  }

  if (!facts) {
    return (
      <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        Loading the details of what the assistant wants to do...
      </div>
    );
  }

  return (
    <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
      <p className="font-medium">{words.title}</p>

      <dl className="mt-1 space-y-0.5">
        <div className="flex gap-1">
          <dt className="text-amber-800">Order</dt>
          <dd className="font-medium">{facts.orderNumber}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-amber-800">Status</dt>
          <dd>{facts.status}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-amber-800">Total</dt>
          <dd>
            {facts.currency} {String(facts.total)}
          </dd>
        </div>
      </dl>

      {/*
        Item names are written by shop administrators. Rendered as plain
        text for the same reason agent prose is: React escapes it, and
        nothing here turns a string into something clickable.
      */}
      <ul className="mt-1 list-disc pl-4">
        {facts.items.map((item, index) => (
          <li key={index} className="break-words">
            {item.quantity} x {item.name}
          </li>
        ))}
      </ul>

      {state === undefined ? (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => approve(callId, true)}
            className="rounded bg-rose-700 px-2 py-1 font-medium text-white hover:bg-rose-800"
          >
            {words.confirm}
          </button>
          <button
            type="button"
            onClick={() => approve(callId, false)}
            className="rounded border border-amber-400 px-2 py-1 font-medium hover:bg-amber-100"
          >
            {words.decline}
          </button>
        </div>
      ) : (
        <p className="mt-2 text-amber-800" role="status">
          {state === 'failed'
            ? 'That could not be sent. Nothing has been changed.'
            : state === 'declined'
              ? 'You said no. Nothing was sent.'
              : // NOT "cancelled". The answer has been delivered; whether
                // the shop accepted it is the tool_completed event's news.
                'Waiting for the shop to confirm...'}
        </p>
      )}
    </div>
  );
}
