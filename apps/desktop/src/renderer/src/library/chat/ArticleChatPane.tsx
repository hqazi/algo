/**
 * The Library's chat pane (T24, SPEC §15.5, §15.6): this article's threads
 * (title, passage snippet, last message date) and the open thread below,
 * with rename and **New chat** (reset, SPEC §7.4). A passage chosen in the
 * reader opens a new question; its thread is created when it is sent. The
 * first message on any article shows a one-time notice that the passage and
 * outline go to the tutor's provider. Messages render through the chat's
 * `MessageView` (the chat allowlist: never an image).
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useChatStore, useThread, useTutorStatus } from '../../chat/store';
import { MessageView } from '../../chat/MessageView';
import { invoke } from '../../ipc';
import { errorText, useApp } from '../../lib/app-context';
import { when } from '../../lib/format';
import { snippet, type ArticleChats } from './useArticleChats';
import '../../chat/chat.css';
import './article-chat.css';

const MAX_TEXT = 20_000;

export interface ArticleChatPaneProps {
  chats: ArticleChats;
  /** The article's file is gone (the reader shows a banner). */
  missing: boolean;
}

function ThreadLog({ thread }: { thread: string }) {
  const store = useChatStore();
  const view = useThread(store, thread);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void store.load(thread);
  }, [store, thread]);
  useLayoutEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [view.messages]);
  const last = view.messages[view.messages.length - 1];
  return (
    <div className="chat-log" ref={log} aria-live="polite" data-testid="chat-log">
      {view.status === 'loading' && view.messages.length === 0 && (
        <p className="muted">Loading the conversation…</p>
      )}
      {view.status === 'error' && (
        <p className="error-text small" role="alert">
          Could not load the conversation: {view.loadError}
        </p>
      )}
      {view.status === 'ready' && view.messages.length === 0 && (
        <p className="muted chat-empty">
          Ask about this passage. The tutor sees it and the article’s outline.
        </p>
      )}
      {view.messages.map((m) => (
        <MessageView
          key={m.id}
          message={m}
          {...(m === last && m.error && m.error.kind !== 'cancelled' && store.canRetry(thread)
            ? { onRetry: () => void store.retry(thread) }
            : {})}
        />
      ))}
    </div>
  );
}

export function ArticleChatPane({ chats, missing }: ArticleChatPaneProps) {
  const app = useApp();
  const store = useChatStore();
  const status = useTutorStatus(store);
  const { open, draft, threads, states } = chats;
  const view = useThread(store, open ?? '');
  const [text, setText] = useState('');
  const [notice, setNotice] = useState<'unknown' | 'seen' | 'unseen'>('unknown');
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);

  useEffect(() => {
    if (!store.status) void store.refreshStatus();
  }, [store]);
  useEffect(() => {
    void invoke('library:chat-notice', { ack: false }).then(
      (r) => setNotice(r.seen ? 'seen' : 'unseen'),
      () => setNotice('unseen'),
    );
  }, []);

  const current = threads.find((t) => t.id === open) ?? null;
  const unavailable = !!status && !status.available;
  const busy = open ? view.streaming : false;
  const canSend = !!status && !unavailable && !busy && (!!open || !!draft);

  async function send(): Promise<void> {
    const body = text.trim();
    if (!canSend || !body) return;
    if (notice !== 'seen' && !confirming) {
      setConfirming(true);
      return;
    }
    try {
      if (confirming) {
        await invoke('library:chat-notice', { ack: true });
        setNotice('seen');
        setConfirming(false);
      }
      const thread = open ?? (await chats.createFromDraft());
      setText('');
      const ok = await store.send(thread, { text: body });
      if (!ok) setText((d) => d || body);
      await chats.reload();
    } catch (e) {
      app.notify(errorText(e), 'error');
    }
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
      void send();
    }
  }

  async function reset(): Promise<void> {
    if (!open) return;
    if (
      !window.confirm(
        'Start a new chat on this passage? This conversation is archived and the tutor forgets it.',
      )
    )
      return;
    await store.reset(open);
    await chats.reload();
  }

  async function saveTitle(id: string, title: string): Promise<void> {
    setRenaming(null);
    if (!title.trim()) return;
    try {
      await chats.rename(id, title);
    } catch (e) {
      app.notify(errorText(e), 'error');
    }
  }

  const passage = draft ?? current?.anchor ?? null;
  const detached = open ? states[open] === 'detached' : false;

  return (
    <div
      className="chat article-chats"
      aria-label="Chats about this article"
      data-testid="article-chats"
    >
      <div className="chat-head">
        <h2>Chats</h2>
      </div>
      {missing && (
        <p className="notice small" role="status" data-testid="chat-file-missing">
          The file is missing. Existing chats stay; the tutor sees only the passage each chat
          started from.
        </p>
      )}
      {chats.loaded && threads.length === 0 && !draft && (
        <p className="muted small reader-pad" data-testid="no-chats">
          Select text in the article and choose <strong>Ask about this</strong>, or use the{' '}
          <strong>Ask</strong> button beside a heading.
        </p>
      )}
      {threads.length > 0 && (
        <ul className="article-threads" aria-label="Chats on this article">
          {threads.map((t) => (
            <li key={t.id} className={t.id === open ? 'active' : undefined}>
              {renaming === t.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const input = e.currentTarget.elements.namedItem('title') as HTMLInputElement;
                    void saveTitle(t.id, input.value);
                  }}
                >
                  <input
                    name="title"
                    aria-label="Chat title"
                    defaultValue={t.title ?? ''}
                    maxLength={200}
                    autoFocus
                    onBlur={(e) => void saveTitle(t.id, e.currentTarget.value)}
                    onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                  />
                </form>
              ) : (
                <button
                  type="button"
                  className="thread-item"
                  onClick={() => chats.openThread(t.id)}
                >
                  <span className="thread-title">{t.title ?? 'New question'}</span>
                  <span className="thread-snippet muted small">{snippet(t.anchor)}</span>
                  <span className="thread-date muted small">
                    {states[t.id] === 'detached' && <span className="pill">detached</span>}{' '}
                    {when(t.last_at ?? t.created_at)}
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {(open || draft) && (
        <section className="article-thread" aria-label="Open chat">
          <div className="chat-head">
            <strong className="thread-open-title">
              {draft ? 'New question' : (current?.title ?? 'New question')}
            </strong>
            <span className="spacer" />
            {open && (
              <>
                <button type="button" className="small-button" onClick={() => setRenaming(open)}>
                  Rename
                </button>
                <button
                  type="button"
                  className="small-button"
                  onClick={() => void reset()}
                  disabled={busy || view.messages.length === 0}
                  title="Archive this conversation and start afresh"
                >
                  New chat
                </button>
              </>
            )}
            <button type="button" className="small-button" onClick={() => chats.openThread(null)}>
              Close
            </button>
          </div>
          {passage && (
            <blockquote className="passage-quote small" data-testid="passage-quote">
              {passage.quote || `Section: ${passage.heading.join(' › ') || 'the opening'}`}
            </blockquote>
          )}
          {detached && (
            <p className="muted small" data-testid="thread-detached">
              This passage is no longer in the article. The chat is kept; the tutor sees the passage
              as it was.
            </p>
          )}
          {open && <ThreadLog thread={open} />}
          {open && view.notice && (
            <div className="chat-notice" role="alert" data-testid="chat-notice">
              <span>{view.notice.message}</span>
              <button type="button" aria-label="Dismiss" onClick={() => store.dismissNotice(open)}>
                ×
              </button>
            </div>
          )}
          {unavailable && (
            <div className="chat-unavailable" role="status" data-testid="ai-unavailable">
              <p>
                <strong>The tutor is not set up.</strong>
              </p>
              {status.reason && <p className="muted">{status.reason}</p>}
              <p className="muted small">You can still read, and read earlier chats.</p>
            </div>
          )}
          {confirming && (
            <div
              className="provider-notice"
              role="alertdialog"
              aria-label="Before you send"
              data-testid="provider-notice"
            >
              <p className="small">
                To answer, the tutor’s AI provider receives this passage, its section of the
                article, the article’s title, source and outline, and your message. Nothing is sent
                while you only read.
              </p>
              <button type="button" className="primary small-button" onClick={() => void send()}>
                Send
              </button>{' '}
              <button type="button" className="small-button" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          )}
          <form
            className="chat-compose"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <textarea
              value={text}
              rows={2}
              maxLength={MAX_TEXT}
              placeholder={unavailable ? 'The tutor is not set up' : 'Ask about this passage…'}
              aria-label="Message the tutor"
              disabled={unavailable}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
            />
            {busy && open ? (
              <button
                type="button"
                className="danger"
                onClick={() => store.stop(open)}
                disabled={view.stopping}
              >
                {view.stopping ? 'Stopping…' : 'Stop'}
              </button>
            ) : (
              <button type="submit" className="primary" disabled={!canSend || !text.trim()}>
                Send
              </button>
            )}
          </form>
        </section>
      )}
    </div>
  );
}
