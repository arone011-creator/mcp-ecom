'use client';

// components/assistant/assistant-widget.tsx
//
// The floating entry point and the panel it opens. Rendered on every
// page from app/layout.tsx, collapsed by default -- a thing available
// everywhere, not a destination you navigate to.
//
// Closing HIDES the panel. It does not unmount the conversation, which
// lives in the provider above this component; that is what lets a
// customer close the chat, keep shopping, and reopen it mid-thought.

import { useEffect, useRef, useState } from 'react';
import { History, Plus, Send, X } from 'lucide-react';

import { animateScrollTop } from '@/lib/assistant/smooth-scroll';
import { AssistantText } from './assistant-text';
import { ConversationList } from './conversation-list';
import { useAssistant } from './assistant-provider';
import { ToolActivityChip } from './tool-activity';
import { PlanSteps } from './plan-steps';
import { ResultCards } from './result-cards';
import { describeResult } from '@/lib/assistant/tool-results';

/**
 * The breathing room left above the newest question when it is scrolled
 * up. Flush against the header's rule reads as clipped rather than as
 * placed.
 */
const TOP_GAP = 12;

export function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [showingHistory, setShowingHistory] = useState(false);
  // Which failure notices the customer has waved away. LOCAL: it is about
  // this rendering and nothing outside it needs to know -- the same call
  // ConversationList makes about which row is armed for deletion.
  const [dismissed, setDismissed] = useState<Record<string, true>>({});
  const [draft, setDraft] = useState('');
  const {
    transcript,
    status,
    send,
    retry,
    conversations,
    conversationId,
    newChat,
    openConversation,
    deleteConversation,
  } = useAssistant();

  const busy = status === 'streaming';

  // WHERE THE VIEW SITS AFTER A QUESTION IS ASKED.
  //
  // The panel used to leave the scroll exactly where it was, so a new
  // question and the answer streaming under it both arrived below the
  // fold: the customer pressed send and watched an unchanged screen.
  //
  // Keyed on the NUMBER of turns, not on their content. Re-running this
  // for every message_delta would drag the view back on every fragment
  // and fight anyone who had scrolled up to re-read something.
  const lastTurn = useRef<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || transcript.length === 0) return;

    const block = lastTurn.current;
    const view = scroller.current;
    if (!block || !view) return;

    // Measured from the two rectangles rather than read off offsetTop:
    // offsetTop is relative to the nearest POSITIONED ancestor, which is
    // not necessarily this container, and quietly gives a different
    // number the day someone adds `relative` to a wrapper.
    const offset =
      block.getBoundingClientRect().top - view.getBoundingClientRect().top;

    // Animated by hand rather than by the browser. scrollIntoView with
    // behavior:'smooth', scrollTo with behavior:'smooth' and CSS
    // scroll-behavior:smooth were each measured against the deployed
    // build in Chrome and moved this container by nothing at all.
    animateScrollTop(view, view.scrollTop + offset - TOP_GAP);
  }, [open, transcript.length]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const asked = draft.trim();
    if (!asked || busy) return;
    setDraft('');
    await send(asked);
  }

  if (!open) {
    return (
      <button
        type="button"
        aria-label="Open the shopping assistant"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-50 rounded-full bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-lg hover:bg-slate-800"
      >
        Assistant
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Shopping assistant"
      className="fixed bottom-4 right-4 z-50 flex h-[32rem] w-[22rem] max-w-[calc(100vw-2rem)] flex-col rounded-lg border bg-white shadow-xl"
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-medium">Assistant</span>
        <div className="flex items-center gap-1">
          {/*
            BOTH DISABLED WHILE STREAMING. The stream in flight belongs to
            the chat that is open; switching under it would file the answer
            against the wrong conversation. The provider refuses regardless
            -- this is so the buttons do not look live while it does.
          */}
          <button
            type="button"
            aria-label="Start a new chat"
            disabled={busy}
            onClick={() => {
              newChat();
              setShowingHistory(false);
            }}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
          </button>

          <button
            type="button"
            aria-label={
              showingHistory ? 'Back to the conversation' : 'Show chat history'
            }
            disabled={busy}
            onClick={() => setShowingHistory((previous) => !previous)}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
          >
            <History aria-hidden="true" className="h-4 w-4" />
          </button>

          <button
            type="button"
            aria-label="Close the shopping assistant"
            onClick={() => setOpen(false)}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      </div>

      {showingHistory ? (
        <div className="flex-1 overflow-y-auto">
          <ConversationList
            conversations={conversations}
            openId={conversationId}
            onOpen={(id) => {
              void openConversation(id);
              setShowingHistory(false);
            }}
            onDelete={(id) => void deleteConversation(id)}
          />
        </div>
      ) : (
        <>
        <div
          ref={scroller}
          className="flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm"
        >
          {transcript.length === 0 ? (
            <p className="text-slate-500">
              Ask about your orders, or find something in the shop.
            </p>
          ) : null}

          {/*
            ONE BLOCK PER TURN, in order: the customer's message, then what
            the assistant did about it. The panel used to render every
            utterance, then every tool chip, then every message -- grouped by
            kind rather than by when, which reads correctly for exactly one
            exchange and wrongly for two.
          */}
          {transcript.map((entry, turnIndex) => {
            const newest = turnIndex === transcript.length - 1;

            return (
            <div
              key={turnIndex}
              data-turn=""
              ref={newest ? lastTurn : null}
              // The last block reserves a container's worth of height, because
              // a turn cannot scroll to the TOP of its container unless there
              // is that much space beneath it. Only the last one: giving every
              // block the same would turn the transcript into a slideshow.
              //
              // `full`, not a calc that subtracts the padding. A percentage
              // height resolves against the CONTENT box, which has already had
              // the container's py-3 taken off it -- subtracting it again left
              // the reservation 24px short of the view, measured in Chrome.
              className={`flex flex-col gap-2 ${newest ? 'min-h-full' : ''}`}
            >
              <p className="max-w-[85%] self-end rounded-2xl bg-slate-900 px-3 py-2 text-white">
                {entry.utterance}
              </p>

              {/* Only for the turn in progress. A plan for a finished
                  turn from last week is history, not progress. */}
              {newest ? (
                <div className="max-w-[85%] self-start">
                  <PlanSteps tools={entry.conversation.tools} />
                </div>
              ) : null}

              {entry.conversation.timeline.map((item, itemIndex) => {
                if (item.kind === 'text') {
                  return (
                    <div
                      key={itemIndex}
                      className="max-w-[85%] self-start rounded-2xl bg-slate-100 px-3 py-2"
                    >
                      <AssistantText text={item.text} />
                    </div>
                  );
                }

                if (item.kind === 'tool') {
                  const activity = entry.conversation.tools.find(
                    (candidate) => candidate.call_id === item.call_id
                  );
                  // The timeline names a tool; `tools` says what became of
                  // it. A timeline entry with no matching activity would
                  // mean the reducer disagreed with itself.
                  if (!activity) return null;
                  // Waved away. The turn is unchanged and still stored --
                  // this hides a notice, it does not edit the record.
                  if (activity.ok === false && dismissed[activity.call_id]) {
                    return null;
                  }

                  // Rendered from the tool's own structured answer, never
                  // from the model's prose -- and only for a call that
                  // succeeded, because a failed call's result is an error
                  // message, not data.
                  const card =
                    activity.ok === true
                      ? describeResult(activity.tool, activity.result)
                      : null;

                  return (
                    <div key={itemIndex} className="max-w-[85%] self-start">
                      <ToolActivityChip
                        activity={activity}
                        // Offered on the NEWEST turn only. A transcript
                        // from last week shows its failures without
                        // inviting the customer to re-run them.
                        onRetry={newest ? retry : undefined}
                        onDismiss={
                          newest
                            ? () => setDismissed((was) => ({ ...was, [activity.call_id]: true }))
                            : undefined
                        }
                      />
                      {card ? <ResultCards card={card} /> : null}
                    </div>
                  );
                }

                return (
                  <p
                    key={itemIndex}
                    role="alert"
                    className="max-w-[85%] self-start text-rose-700"
                  >
                    {String(item.message ?? 'The assistant could not finish that.')}
                  </p>
                );
              })}
            </div>
            );
          })}

          {status === 'error' ? (
            <p role="alert" className="text-rose-700">
              Something went wrong reaching the assistant. Try again.
            </p>
          ) : null}

          {busy ? <p className="text-slate-500">Working...</p> : null}
        </div>

        <form onSubmit={submit} className="flex gap-2 border-t p-2">
          <label className="sr-only" htmlFor="assistant-input">
            Message the assistant
          </label>
          <input
            id="assistant-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask something"
            disabled={busy}
            className="flex-1 rounded border px-2 py-1 text-sm"
          />
          <button
            type="submit"
            aria-label="Send message"
            disabled={busy || !draft.trim()}
            className="rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-40"
          >
            <Send aria-hidden="true" className="h-4 w-4" />
          </button>
        </form>
        </>
      )}
    </div>
  );
}
