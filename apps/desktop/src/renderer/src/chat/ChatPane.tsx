/**
 * The tutor chat pane (SPEC §7, §8): one thread per problem plus the general
 * `home` thread, streaming replies, tool chips, Hint / Review / Explain,
 * stop, new chat, error and not-configured states. Each message carries the
 * editor's current code; main adds the problem, language and last report.
 * Ported from `dsa-tutor/web/src/chat/ChatPane.tsx`.
 */
import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import type { ChatActionView } from '../../../shared/tutor';
import { MessageView } from './MessageView';
import { HOME, useChatStore, useThread, useTutorStatus } from './store';
import './chat.css';

export interface ChatPaneProps {
  /** The problem on screen; null on pages without one (the pane then shows the general thread). */
  slug: string | null;
  /** The editor's code to send with a message; may save the editor first. */
  getCode?: () => Promise<string | undefined>;
  className?: string;
}

const NOTICE_TEXT: Record<string, string> = {
  busy: 'The tutor is already replying in this chat.',
};

const MAX_TEXT = 20_000;

export const ChatPane = forwardRef<HTMLTextAreaElement, ChatPaneProps>(function ChatPane(
  { slug, getCode, className },
  ref,
) {
  const store = useChatStore();
  const status = useTutorStatus(store);
  const [chosen, setChosen] = useState<{ on: string | null; thread: string } | null>(null);
  const follow = store.follow && store.follow.to === slug ? store.follow.from : null;
  const thread = chosen && chosen.on === slug ? chosen.thread : (follow ?? slug ?? HOME);
  const view = useThread(store, thread);
  const [draft, setDraft] = useState('');
  const log = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  useEffect(() => {
    if (store.follow && store.follow.to !== slug) store.follow = null;
  }, [store, slug]);
  useEffect(() => {
    void store.load(thread);
  }, [store, thread]);
  useEffect(() => {
    if (!store.status) void store.refreshStatus();
  }, [store]);

  useLayoutEffect(() => {
    const el = log.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [view.messages, thread]);

  const unavailable = !!status && !status.available;
  const busy = view.streaming;
  const canSend = !!status && !unavailable && !busy;
  const isProblem = thread !== HOME;

  function pick(t: string): void {
    setChosen({ on: slug, thread: t });
    store.follow = null;
  }

  async function codeFor(): Promise<string | undefined> {
    // Only the problem on screen has editor code; another thread's problem
    // is read from its saved file in main.
    if (thread === HOME || thread !== slug || !getCode) return undefined;
    try {
      return await getCode();
    } catch {
      return undefined;
    }
  }

  async function send(text: string, action?: ChatActionView): Promise<void> {
    if (!canSend) return;
    if (!action && !text.trim()) return;
    if (!action) setDraft('');
    const code = await codeFor();
    const ok = await store.send(thread, { text, ...(action ? { action } : {}) }, code);
    if (!ok && !action) setDraft((d) => d || text);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (
      e.key === 'Enter' &&
      !e.shiftKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.nativeEvent.isComposing
    ) {
      e.preventDefault();
      void send(draft);
    }
  }

  async function reset(): Promise<void> {
    if (
      !window.confirm('Start a new chat? This conversation is archived and the tutor forgets it.')
    )
      return;
    await store.reset(thread);
  }

  const threads = [...new Set([slug, HOME, thread].filter((t): t is string => !!t))];
  const threadLabel = (t: string): string =>
    t === HOME ? 'General' : t === slug ? 'This problem' : t;
  const last = view.messages[view.messages.length - 1];

  return (
    <div
      className={className ? `chat ${className}` : 'chat'}
      aria-label="Tutor chat"
      data-testid="tutor-pane"
    >
      <div className="chat-head">
        <h2>Tutor</h2>
        {threads.length > 1 && (
          <div className="chat-threads" role="group" aria-label="Chat thread">
            {threads.map((t) => (
              <button
                key={t}
                type="button"
                className={t === thread ? 'thread active' : 'thread'}
                aria-pressed={t === thread}
                onClick={() => pick(t)}
              >
                {threadLabel(t)}
              </button>
            ))}
          </div>
        )}
        <span className="spacer" />
        <button
          type="button"
          className="small-button"
          onClick={() => void reset()}
          disabled={busy || view.messages.length === 0}
          title="Archive this conversation and start afresh"
        >
          New chat
        </button>
      </div>

      {unavailable && (
        <div className="chat-unavailable" role="status" data-testid="ai-unavailable">
          <p>
            <strong>The tutor is not set up.</strong>
          </p>
          {status.reason && <p className="muted">{status.reason}</p>}
          <p className="muted small">
            You can practise without it: Run checks the visible examples, Submit runs every test and
            records your attempt when they all pass.
          </p>
        </div>
      )}

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
          <p className="muted">Loading the conversation…</p>
        )}
        {view.status === 'error' && (
          <p className="error-text small" role="alert">
            Could not load the conversation: {view.loadError}{' '}
            <button
              type="button"
              className="small-button"
              onClick={() => void store.load(thread, true)}
            >
              Retry
            </button>
          </p>
        )}
        {view.status === 'ready' && view.messages.length === 0 && !unavailable && (
          <p className="muted chat-empty">
            {isProblem
              ? 'Ask about this problem, or use Hint, Review or Explain. The tutor sees your current code and last test results.'
              : 'Ask what to practise next, about a topic, or about your progress.'}
          </p>
        )}
        {view.messages.map((m) => (
          <MessageView
            key={m.id}
            message={m}
            {...(m === last &&
            m.error &&
            m.error.kind !== 'cancelled' &&
            canSend &&
            store.canRetry(thread)
              ? { onRetry: () => void codeFor().then((c) => store.retry(thread, c)) }
              : {})}
          />
        ))}
      </div>

      {view.notice && (
        <div className="chat-notice" role="alert" data-testid="chat-notice">
          <span>{NOTICE_TEXT[view.notice.code] ?? view.notice.message}</span>
          <button type="button" aria-label="Dismiss" onClick={() => store.dismissNotice(thread)}>
            ×
          </button>
        </div>
      )}

      <div className="chat-actions">
        {isProblem ? (
          (['hint', 'review', 'explain'] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => void send('', a)}
              disabled={!canSend}
              title={unavailable ? 'The tutor is not set up' : undefined}
            >
              {a === 'hint' ? 'Hint' : a === 'review' ? 'Review' : 'Explain'}
            </button>
          ))
        ) : (
          <button
            type="button"
            onClick={() => void send('What should I practise next?')}
            disabled={!canSend}
          >
            What next?
          </button>
        )}
      </div>

      <form
        className="chat-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <textarea
          ref={ref}
          value={draft}
          rows={2}
          maxLength={MAX_TEXT}
          placeholder={unavailable ? 'The tutor is not set up' : 'Ask the tutor…'}
          aria-label="Message the tutor"
          disabled={unavailable}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {busy ? (
          <button
            type="button"
            className="danger"
            onClick={() => store.stop(thread)}
            disabled={view.stopping}
          >
            {view.stopping ? 'Stopping…' : 'Stop'}
          </button>
        ) : (
          <button type="submit" className="primary" disabled={!canSend || !draft.trim()}>
            Send
          </button>
        )}
      </form>
    </div>
  );
});
