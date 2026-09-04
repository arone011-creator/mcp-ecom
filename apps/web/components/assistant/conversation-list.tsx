'use client';

// components/assistant/conversation-list.tsx
//
// The history view: every chat this customer has had, newest first.
//
// PRESENTATIONAL. It is handed the chats and three callbacks and owns
// exactly one piece of state -- which row is armed for deletion -- because
// that state is about this rendering and nothing outside it needs to know.
//
// `now` is a prop so the relative times are testable without mocking the
// clock, and defaults so callers do not have to care.

import { useState } from 'react';
import { Trash2 } from 'lucide-react';

import type { ListedChat } from './assistant-provider';
import { relativeTime } from '@/lib/assistant/relative-time';

interface ConversationListProps {
  conversations: ListedChat[];
  /** The chat currently in the panel, if any. */
  openId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  now?: Date;
}

export function ConversationList({
  conversations,
  openId,
  onOpen,
  onDelete,
  now = new Date(),
}: ConversationListProps) {
  // ONE row at a time. Two armed rows would leave two live confirm
  // buttons on screen, either of which destroys something.
  const [arming, setArming] = useState<string | null>(null);

  if (conversations.length === 0) {
    return (
      <p className="px-3 py-3 text-sm text-slate-500">
        No chats yet. Ask something and it will appear here.
      </p>
    );
  }

  return (
    <ul className="divide-y">
      {conversations.map((chat) => (
        <li key={chat.id} className="flex items-center gap-1 px-1">
          <button
            type="button"
            onClick={() => onOpen(chat.id)}
            // Named for what it does. Without this its accessible name is
            // the chat's name plus its timestamp, which both reads oddly
            // and collides with the delete button beside it.
            aria-label={`Open ${chat.name}`}
            // aria-current rather than colour alone: which chat you are in
            // has to be available to a screen reader too.
            aria-current={chat.id === openId ? 'true' : undefined}
            className={`flex-1 truncate px-2 py-2 text-left text-sm hover:bg-slate-50 ${
              chat.id === openId
                ? 'font-medium text-slate-900'
                : 'text-slate-700'
            }`}
          >
            {/* Rendered as text. A name is the customer's own words today
                and a model-written title tomorrow; neither is markup. */}
            <span className="block truncate">{chat.name}</span>
            <span className="block text-xs text-slate-400">
              {relativeTime(new Date(chat.lastTurnAt), now)}
            </span>
          </button>

          {arming === chat.id ? (
            <span className="flex shrink-0 items-center gap-1 pr-1">
              <button
                type="button"
                aria-label={`Confirm deleting ${chat.name}`}
                onClick={() => {
                  setArming(null);
                  onDelete(chat.id);
                }}
                className="rounded px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
              >
                Delete
              </button>
              <button
                type="button"
                aria-label={`Keep ${chat.name}`}
                onClick={() => setArming(null)}
                className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              aria-label={`Delete ${chat.name}`}
              // The first click ARMS. Deleting a conversation on one stray
              // click is not recoverable -- there is no undo, by decision.
              onClick={() => setArming(chat.id)}
              className="shrink-0 rounded p-2 text-slate-400 hover:bg-slate-100 hover:text-rose-700"
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
