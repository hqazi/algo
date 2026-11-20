/**
 * A chat's message list (T30, docs/design.md → Practice): the conversation
 * as `MessageView`s with its loading, error and empty states, kept scrolled to
 * the newest message while the reader is at the bottom. Shared by the tutor
 * pane and the Library's chats (T32).
 */
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { MessageView } from './MessageView';
import type { ThreadView } from './store';

export interface MessageListProps {
  view: Pick<ThreadView, 'messages' | 'status' | 'loadError'>;
  /** Shown when the conversation is loaded and empty. */
  empty?: ReactNode;
  /** Offered as **Retry** when the conversation could not load. */
  onReload?: (() => void) | undefined;
  /** Offered as **Try again** on the last message when its turn failed. */
  onRetry?: (() => void) | undefined;
  /** Scroll to the bottom when this changes (the thread shown). */
  scrollKey?: string | undefined;
}

export function MessageList({ view, empty, onReload, onRetry, scrollKey }: MessageListProps) {
  const log = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const shownKey = useRef(scrollKey);

  useLayoutEffect(() => {
    // Another thread starts at its newest message.
    if (shownKey.current !== scrollKey) {
      shownKey.current = scrollKey;
      atBottom.current = true;
    }
    const el = log.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [view.messages, scrollKey]);

  const last = view.messages[view.messages.length - 1];
  return (
    <div
      className="chat-log"
      ref={log}
      aria-live="polite"
      data-testid="chat-log"
      onScroll={(e) => {
        const el = e.currentTarget;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {view.status === 'loading' && view.messages.length === 0 && (
        <p className="muted chat-empty">Loading the conversation…</p>
      )}
      {view.status === 'error' && (
        <p className="error-text small" role="alert">
          Could not load the conversation: {view.loadError}{' '}
          {onReload && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onReload}>
              Retry
            </button>
          )}
        </p>
      )}
      {view.status === 'ready' && view.messages.length === 0 && empty && (
        <div className="muted chat-empty">{empty}</div>
      )}
      {view.messages.map((m) => (
        <MessageView
          key={m.id}
          message={m}
          {...(m === last && m.error && m.error.kind !== 'cancelled' && onRetry ? { onRetry } : {})}
        />
      ))}
    </div>
  );
}
