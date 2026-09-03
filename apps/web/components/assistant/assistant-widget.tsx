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

import { useState } from 'react';

import { AssistantText } from './assistant-text';
import { useAssistant } from './assistant-provider';
import { ToolActivityList } from './tool-activity';

export function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const { conversation, turns, status, send } = useAssistant();

  const busy = status === 'streaming';

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
        <button
          type="button"
          aria-label="Close the shopping assistant"
          onClick={() => setOpen(false)}
          className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
        >
          Close
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm">
        {turns.length === 0 ? (
          <p className="text-slate-500">
            Ask about your orders, or find something in the shop.
          </p>
        ) : null}

        {turns.map((turn, index) => (
          <div key={index} className="flex flex-col gap-2">
            <p className="self-end rounded-lg bg-slate-900 px-3 py-2 text-white">
              {turn.utterance}
            </p>
          </div>
        ))}

        <ToolActivityList tools={conversation.tools} />

        {conversation.text.map((text, index) => (
          <div key={index} className="rounded-lg bg-slate-100 px-3 py-2">
            <AssistantText text={text} />
          </div>
        ))}

        {/*
          A turn that FAILED, as distinct from a tool that failed. The
          agent reports these; before it did, a turn that died after the
          response had begun ended the stream cleanly with nothing in it,
          and the panel showed the question and then blank -- which reads
          as an assistant that had nothing to say. Rendered as plain text
          like everything else here, never as markup.
        */}
        {conversation.errors.map((failure, index) => (
          <p key={index} role="alert" className="text-rose-700">
            {String(failure.message ?? 'The assistant could not finish that.')}
          </p>
        ))}

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
          disabled={busy || !draft.trim()}
          className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
