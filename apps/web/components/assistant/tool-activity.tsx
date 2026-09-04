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

import { toolLabel } from '@/lib/assistant/tool-labels';

import { ApprovalCard } from './approval-card';

function state(activity: Activity): { text: string; className: string } {
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

/**
 * One tool, as the customer sees it.
 *
 * Rendered per timeline item rather than as one block at the end of the
 * conversation, so a call sits beside the question that caused it.
 */
interface ChipProps {
  activity: Activity;
  /**
   * Offered only on a FAILED call, and only when given.
   *
   * Optional because a chip also renders inside a stored transcript from
   * last week, where offering to re-run a turn would act on a
   * conversation the customer is only reading.
   */
  onRetry?: () => void;
  onDismiss?: () => void;
}

export function ToolActivityChip({ activity, onRetry, onDismiss }: ChipProps) {
  // A call waiting on a human is not a status chip; it is a decision. The
  // card renders from a fresh server-side lookup of what the action
  // affects -- never from these arguments, and never from agent prose.
  if (activity.awaiting_approval) {
    return <ApprovalCard callId={activity.call_id} tool={activity.tool} />;
  }

  const shown = state(activity);

  return (
    <div className={`rounded border px-2 py-1 text-xs ${shown.className}`}>
      <span className="font-medium">{toolLabel(activity.tool)}</span>
      <span> - {shown.text}</span>
      {activity.ok === false && activity.error ? (
        // The storefront's own message, passed through every layer
        // verbatim: it carries the number that IS available.
        <span className="mt-0.5 block break-words opacity-80">
          {activity.error}
        </span>
      ) : null}
      {/* A WAY FORWARD, NOT A DEAD CHIP. Shown only once the call has
          actually failed -- a working call always resolves to done or
          failed, so there is no state where the customer is left with
          nothing to press. */}
      {activity.ok === false && (onRetry || onDismiss) ? (
        <span className="mt-1 flex gap-2">
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="rounded border border-rose-300 px-1.5 py-0.5 font-medium hover:bg-rose-100"
            >
              Try again
            </button>
          ) : null}
          {onDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-100"
            >
              Dismiss
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

export function ToolActivityList({ tools }: { tools: Activity[] }) {
  if (tools.length === 0) return null;

  return (
    <ul className="flex flex-col gap-1" aria-label="Assistant activity">
      {tools.map((activity) => (
        <li key={activity.call_id}>
          <ToolActivityChip activity={activity} />
        </li>
      ))}
    </ul>
  );
}
