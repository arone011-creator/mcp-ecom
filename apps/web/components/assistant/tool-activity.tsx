'use client';

// components/assistant/tool-activity.tsx
//
// What the assistant is doing, as it does it. Rendered from the
// conversation's structured tool list, never from anything the model
// wrote -- the same rule the approval card will follow in Task 5, for
// the same reason: prose next to an action can be written by whoever
// wrote the product description.
//
// Every started tool is guaranteed a completion by the event contract,
// INCLUDING one the agent refused to run, so a chip cannot spin forever.
// That guarantee is the agent's; this is the half that shows it.

import type { ToolActivity as Activity } from '@/lib/assistant/events';

// Customer-facing wording. The tool's own name is an implementation
// detail, and "get_orders" is not something to show a shopper.
const LABELS: Record<string, string> = {
  search_products: 'Searching products',
  get_product: 'Looking up a product',
  check_inventory: 'Checking stock',
  get_orders: 'Looking up your orders',
  get_order: 'Opening an order',
  get_cart: 'Checking your cart',
  add_to_cart: 'Adding to your cart',
  remove_from_cart: 'Removing from your cart',
  cancel_order: 'Cancelling an order',
};

function label(tool: string): string {
  // An unfamiliar tool is shown honestly rather than hidden: the agent
  // gaining a capability nobody labelled should be visible, not silent.
  return LABELS[tool] ?? tool.replace(/_/g, ' ');
}

function state(activity: Activity): { text: string; className: string } {
  if (activity.awaiting_approval) {
    // Task 5 brings the button. Until then this says what is true --
    // waiting on you -- rather than offering a control that does nothing.
    return {
      text: 'waiting for your approval',
      className: 'bg-amber-50 text-amber-800 border-amber-200',
    };
  }
  if (activity.ok === undefined) {
    return {
      text: 'working',
      className: 'bg-slate-50 text-slate-600 border-slate-200',
    };
  }
  if (activity.ok) {
    return {
      text: 'done',
      className: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    };
  }
  return {
    text: 'could not be completed',
    className: 'bg-rose-50 text-rose-800 border-rose-200',
  };
}

export function ToolActivityList({ tools }: { tools: Activity[] }) {
  if (tools.length === 0) return null;

  return (
    <ul className="flex flex-col gap-1" aria-label="Assistant activity">
      {tools.map((activity) => {
        const shown = state(activity);

        return (
          <li
            key={activity.call_id}
            className={`rounded border px-2 py-1 text-xs ${shown.className}`}
          >
            <span className="font-medium">{label(activity.tool)}</span>
            <span> - {shown.text}</span>
            {activity.ok === false && activity.error ? (
              // The storefront's own message, passed through every layer
              // verbatim: it carries the number that IS available.
              <span className="mt-0.5 block break-words opacity-80">
                {activity.error}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
