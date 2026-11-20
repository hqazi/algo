/**
 * The Library's chat pane (T24, SPEC §15.5, §15.6): this article's threads
 * (title, passage snippet, last message date) and the open thread below,
 * with rename and **New chat** (reset, SPEC §7.4). A passage chosen in the
 * reader opens a new question; its thread is created when it is sent. The
 * first message on any article shows a one-time notice that the passage and
 * outline go to the tutor's provider. Messages render through the chat's
 * `MessageView` (the chat allowlist: never an image).
 */
import { useEffect, useState } from 'react';
import { MessageSquare, Pencil, Sparkles, SquarePen, X } from 'lucide-react';
import { Composer } from '../../chat/Composer';
import { MessageList } from '../../chat/MessageList';
import { useChatStore, useThread, useTutorStatus } from '../../chat/store';
import { PaneHeader } from '../../components/PaneHeader';
import { Badge, Button, IconButton } from '../../components/ui';
import { invoke } from '../../ipc';
import { errorText, useApp } from '../../lib/app-context';
import { fullDate, relativeDate } from '../../lib/format';
import { navigate } from '../../lib/router';
import { snippet, type ArticleChats } from './useArticleChats';
import '../../chat/chat.css';
import './article-chat.css';

const MAX_TEXT = 20_000;
/** What **Make a problem from this** sends (core's `PASSAGE_PROBLEM_REQUEST`). */
export const PASSAGE_PROBLEM_REQUEST = 'Make a practice problem from this passage.';
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ArticleChatPaneProps {
  chats: ArticleChats;
  /** The article's file is gone (the reader shows a banner). */
  missing: boolean;
}

/** A thread's last activity: relative, with the full date in the tooltip. */
function Ago({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={fullDate(iso)}>
      {relativeDate(iso)}
    </time>
  );
}

function ThreadLog({ thread, canRetry }: { thread: string; canRetry: boolean }) {
  const store = useChatStore();
  const view = useThread(store, thread);
  useEffect(() => {
    void store.load(thread);
  }, [store, thread]);
  return (
    <MessageList
      view={view}
      scrollKey={thread}
      onReload={() => void store.load(thread, true)}
      {...(canRetry && store.canRetry(thread) ? { onRetry: () => void store.retry(thread) } : {})}
      empty="Ask about this passage. The tutor sees it and the article’s outline."
    />
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
  /** T25: problems made from a passage in this pane, by thread. */
  const [made, setMade] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);

  useEffect(
    () =>
      store.onUi((ev, thread) => {
        if (ev.action !== 'open_problem' || !thread.startsWith('article:')) return;
        if (SLUG_RE.test(ev.slug)) setMade((m) => ({ ...m, [thread]: ev.slug }));
      }),
    [store],
  );

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

  async function send(given?: string): Promise<void> {
    const body = (given ?? pending ?? text).trim();
    if (!canSend || !body) return;
    if (notice !== 'seen' && !confirming) {
      // A button's message waits for the notice like typed text.
      if (given) setPending(given);
      setConfirming(true);
      return;
    }
    setPending(null);
    try {
      if (confirming) {
        await invoke('library:chat-notice', { ack: true });
        setNotice('seen');
        setConfirming(false);
      }
      const thread = open ?? (await chats.createFromDraft());
      const typed = body === text.trim();
      if (typed) setText('');
      const ok = await store.send(thread, { text: body });
      if (!ok && typed) setText((d) => d || body);
      await chats.reload();
    } catch (e) {
      app.notify(errorText(e), 'error');
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
      <PaneHeader title="Chats" />
      {missing && (
        <p className="notice small" role="status" data-testid="chat-file-missing">
          The file is missing. Existing chats stay; the tutor sees only the passage each chat
          started from.
        </p>
      )}
      {chats.loaded && threads.length === 0 && !draft && (
        <div className="article-chats-empty" data-testid="no-chats">
          <MessageSquare size={20} aria-hidden="true" />
          <p className="muted small">
            Select text in the article and choose <strong>Ask about this</strong>, or use the{' '}
            <strong>Ask</strong> button beside a heading.
          </p>
        </div>
      )}
      {threads.length > 0 && (
        <ul className="article-threads" aria-label="Chats on this article">
          {threads.map((t) => (
            <li key={t.id} className={t.id === open ? 'active' : undefined}>
              {renaming === t.id ? (
                <form
                  className="thread-rename"
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
                  aria-current={t.id === open ? 'true' : undefined}
                  onClick={() => chats.openThread(t.id)}
                >
                  <span className="thread-line">
                    <span className="thread-title">{t.title ?? 'New question'}</span>
                    <span className="thread-date">
                      <Ago iso={t.last_at ?? t.created_at} />
                    </span>
                  </span>
                  <span className="thread-snippet">
                    {states[t.id] === 'detached' && (
                      <Badge tone="warn" className="thread-detached-badge">
                        detached
                      </Badge>
                    )}
                    {snippet(t.anchor)}
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {(open || draft) && (
        <section className="article-thread" aria-label="Open chat">
          <div className="thread-head">
            <strong className="thread-open-title">
              {draft ? 'New question' : (current?.title ?? 'New question')}
            </strong>
            {open && (
              <>
                <IconButton
                  aria-label="Rename"
                  title="Rename this chat"
                  size="sm"
                  icon={<Pencil aria-hidden="true" />}
                  onClick={() => setRenaming(open)}
                />
                <IconButton
                  aria-label="New chat"
                  title="New chat: archive this conversation and start afresh"
                  size="sm"
                  icon={<SquarePen aria-hidden="true" />}
                  onClick={() => void reset()}
                  disabled={busy || view.messages.length === 0}
                />
              </>
            )}
            <IconButton
              aria-label="Close"
              title="Close this chat"
              size="sm"
              icon={<X aria-hidden="true" />}
              onClick={() => chats.openThread(null)}
            />
          </div>
          {passage && (
            <blockquote className="passage-quote" data-testid="passage-quote">
              {passage.quote || `Section: ${passage.heading.join(' › ') || 'the opening'}`}
            </blockquote>
          )}
          {detached && (
            <p className="muted small thread-note" data-testid="thread-detached">
              This passage is no longer in the article. The chat is kept; the tutor sees the passage
              as it was.
            </p>
          )}
          {open ? (
            <ThreadLog thread={open} canRetry={!unavailable} />
          ) : (
            <div className="chat-log" aria-hidden="true" />
          )}
          {open && made[open] && (
            <p className="notice small passage-problem" role="status" data-testid="passage-problem">
              <span>
                The problem <code>{made[open]}</code> passed the self-check.
              </span>
              <Button variant="primary" size="sm" onClick={() => navigate(`/p/${made[open]}`)}>
                Open in Practice
              </Button>
            </p>
          )}
          {open && view.notice && (
            <div className="chat-notice" role="alert" data-testid="chat-notice">
              <span>{view.notice.message}</span>
              <IconButton
                aria-label="Dismiss"
                size="sm"
                icon={<X aria-hidden="true" />}
                onClick={() => store.dismissNotice(open)}
              />
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
              <div className="provider-notice-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setConfirming(false);
                    setPending(null);
                  }}
                >
                  Cancel
                </Button>
                <Button variant="primary" size="sm" onClick={() => void send()}>
                  Send
                </Button>
              </div>
            </div>
          )}
          <div className="chat-bottom">
            <div className="chat-quick" role="group" aria-label="Ask the tutor">
              <button
                type="button"
                className="chat-chip"
                onClick={() => void send(PASSAGE_PROBLEM_REQUEST)}
                disabled={!canSend}
                title="The tutor writes a practice problem from this passage; it appears only if it passes the self-check"
                data-testid="make-problem"
              >
                <Sparkles size={14} aria-hidden="true" />
                Make a problem from this
              </button>
            </div>
            <Composer
              value={text}
              onChange={setText}
              onSend={() => void send()}
              busy={busy && !!open}
              onStop={open ? () => store.stop(open) : undefined}
              stopping={view.stopping}
              canSend={canSend}
              disabled={unavailable}
              maxLength={MAX_TEXT}
              placeholder={unavailable ? 'The tutor is not set up' : 'Ask about this passage…'}
            />
          </div>
        </section>
      )}
    </div>
  );
}
