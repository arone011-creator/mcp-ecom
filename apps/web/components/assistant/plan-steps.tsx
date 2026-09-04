'use client';

// components/assistant/plan-steps.tsx
//
// What this turn is doing, for a turn that is doing more than one thing.
//
// DERIVED FROM THE TOOLS, NOT FROM REASONING. The design asks for
// visibility into what the assistant intends "without exposing raw
// reasoning", and this is what that distinction buys: the steps are the
// calls it is actually making, which is a fact about the turn, rather
// than the model's account of itself, which is prose -- and prose beside
// an action is the thing this codebase does not render.
//
// It appears only when there are two or more steps. For a single call the
// activity chip already says everything this would.

import type { ToolActivity } from '@/lib/assistant/events';
import { toolLabel } from '@/lib/assistant/tool-labels';

type StepState = 'done' | 'failed' | 'waiting' | 'working';

function stateOf(activity: ToolActivity): StepState {
  if (activity.awaiting_approval) return 'waiting';
  if (activity.ok === undefined) return 'working';

  return activity.ok ? 'done' : 'failed';
}

const WORDS: Record<StepState, string> = {
  done: 'done',
  failed: 'could not be completed',
  waiting: 'waiting for you',
  working: 'working',
};

const MARKS: Record<StepState, string> = {
  done: 'v',
  failed: 'x',
  waiting: '?',
  working: '.',
};

const TONES: Record<StepState, string> = {
  done: 'text-emerald-700',
  failed: 'text-rose-700',
  waiting: 'text-amber-700',
  working: 'text-slate-400',
};

export function PlanSteps({ tools }: { tools: ToolActivity[] }) {
  // One tool is not a plan.
  if (tools.length < 2) return null;

  const states = tools.map(stateOf);
  // An approval is a stop, not progress, so a waiting step is not
  // counted as done -- otherwise the count would claim the turn had got
  // further than it has.
  const finished = states.filter((state) => state === 'done').length;

  return (
    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs">
      <p className="mb-1 font-medium text-slate-600">
        Steps - {finished} of {tools.length} done
      </p>
      <ul className="flex flex-col gap-0.5">
        {tools.map((activity, index) => {
          const state = states[index]!;
          const name = toolLabel(activity.tool);

          return (
            <li
              key={activity.call_id}
              aria-label={`${name}: ${WORDS[state]}`}
              className={`flex items-center gap-1.5 ${TONES[state]}`}
            >
              <span aria-hidden="true" className="w-3 text-center font-mono">
                {MARKS[state]}
              </span>
              <span className="truncate">{name}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
