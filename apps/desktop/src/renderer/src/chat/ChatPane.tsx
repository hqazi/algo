/**
 * The tutor chat pane (SPEC §7, §8): one thread per problem plus the general
 * `home` thread, streaming replies, tool chips, Hint / Review / Explain,
 * stop, new chat, error and not-configured states. Each message carries the
 * editor's current code; main adds the problem, language and last report.
 * Ported from `dsa-tutor/web/src/chat/ChatPane.tsx`; restyled in T30 with the
 * shared `MessageList` and `Composer`.
 */
import { forwardRef, useEffect, useState } from 'react';
import { BookOpen, Lightbulb, ScanSearch, SquarePen, X } from 'lucide-react';
import type { ChatActionView } from '../../../shared/tutor';
import { PaneHeader } from '../components/PaneHeader';
import { IconButton, Segmented } from '../components/ui';
import { Composer } from './Composer';
import { MessageList } from './MessageList';
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

const QUICK = [
  { action: 'hint', label: 'Hint', Icon: Lightbulb, title: 'The next hint, one level at a time' },
  {
    action: 'review',
    label: 'Review',
    Icon: ScanSearch,
    title: 'The tutor runs the tests and reviews your code',
  },
  {
    action: 'explain',
    label: 'Explain',
    Icon: BookOpen,
    title: 'A full explanation page (counts the attempt as solved with help)',
  },
] as const satisfies readonly {
  action: ChatActionView;
  label: string;
  Icon: typeof Lightbulb;
  title: string;
}[];

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

  useEffect(() => {
    if (store.follow && store.follow.to !== slug) store.follow = null;
  }, [store, slug]);
  useEffect(() => {
    void store.load(thread);
  }, [store, thread]);
  useEffect(() => {
    if (!store.status) void store.refreshStatus();
  }, [store]);

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

  return (
    <div
      className={className ? `chat ${className}` : 'chat'}
      aria-label="Tutor chat"
      data-testid="tutor-pane"
    >
      <PaneHeader title="Tutor">
        {threads.length > 1 && (
          <Segmented
            aria-label="Chat thread"
            className="chat-threads"
            value={thread}
            onChange={pick}
            options={threads.map((t) => ({
              value: t,
              label: threadLabel(t),
              title: t === HOME ? 'Your general conversation with the tutor' : `Chat about ${t}`,
            }))}
          />
        )}
        <span className="spacer" />
        <IconButton
          aria-label="New chat"
          title="New chat: archive this conversation and start afresh"
          size="sm"
          icon={<SquarePen aria-hidden="true" />}
          onClick={() => void reset()}
          disabled={busy || view.messages.length === 0}
        />
      </PaneHeader>

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

      <MessageList
        view={view}
        scrollKey={thread}
        onReload={() => void store.load(thread, true)}
        {...(canSend && store.canRetry(thread)
          ? { onRetry: () => void codeFor().then((c) => store.retry(thread, c)) }
          : {})}
        {...(unavailable
          ? {}
          : {
              empty: isProblem
                ? 'Ask about this problem, or use Hint, Review or Explain. The tutor sees your current code and last test results.'
                : 'Ask what to practise next, about a topic, or about your progress.',
            })}
      />

      {view.notice && (
        <div className="chat-notice" role="alert" data-testid="chat-notice">
          <span>{NOTICE_TEXT[view.notice.code] ?? view.notice.message}</span>
          <IconButton
            aria-label="Dismiss"
            size="sm"
            icon={<X aria-hidden="true" />}
            onClick={() => store.dismissNotice(thread)}
          />
        </div>
      )}

      <div className="chat-bottom">
        <div className="chat-quick" role="group" aria-label="Ask the tutor">
          {isProblem ? (
            QUICK.map(({ action, label, Icon, title }) => (
              <button
                key={action}
                type="button"
                className="chat-chip"
                onClick={() => void send('', action)}
                disabled={!canSend}
                title={unavailable ? 'The tutor is not set up' : title}
              >
                <Icon size={14} aria-hidden="true" />
                {label}
              </button>
            ))
          ) : (
            <button
              type="button"
              className="chat-chip"
              onClick={() => void send('What should I practise next?')}
              disabled={!canSend}
            >
              What next?
            </button>
          )}
        </div>
        <Composer
          textareaRef={ref}
          value={draft}
          onChange={setDraft}
          onSend={() => void send(draft)}
          busy={busy}
          onStop={() => store.stop(thread)}
          stopping={view.stopping}
          canSend={canSend}
          disabled={unavailable}
          maxLength={MAX_TEXT}
          placeholder={unavailable ? 'The tutor is not set up' : 'Ask the tutor…'}
        />
      </div>
    </div>
  );
});
