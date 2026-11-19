/**
 * Chat state, one entry per thread, kept outside React so a reply keeps
 * streaming (and its UI events keep arriving) when the learner navigates:
 * the tutor opening a problem must not cut its own reply off. Ported from
 * `dsa-tutor/web/src/chat/store.ts`; the HTTP/SSE client is replaced by the
 * `chat:send` IPC stream, whose cancel stops the turn in main.
 *
 * Components read a thread with `useThread()`; app-level effects subscribe
 * to UI events with `onUi()`.
 */
import { createContext, useContext, useSyncExternalStore } from 'react';
import type {
  ChatActionView,
  ChatEventView,
  ChatMessageView,
  ToolChipView,
  TutorStatusView,
  UiEventView,
} from '../../../shared/tutor';
import { invoke, IpcError, stream, type Stream } from '../ipc';

export const HOME = 'home';
export const ACTION_TEXT: Record<ChatActionView, string> = {
  hint: 'Give me the next hint for this problem.',
  review: 'Please review my current solution.',
  explain: 'Please explain this problem and its solution.',
};

export type Part = { kind: 'text'; text: string } | { kind: 'tool'; chip: ToolChipView };

export interface ViewMessage {
  id: string;
  role: 'user' | 'assistant';
  /** User messages: the text sent. Assistant messages use `parts`. */
  text: string;
  /** Assistant text and tool chips in the order they happened. */
  parts: Part[];
  action?: string;
  /** True while the reply is streaming. */
  pending?: boolean;
  stop?: string;
  error?: { kind: string; message: string } | null;
}

export interface Notice {
  code: string;
  message: string;
}

export interface ThreadView {
  thread: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  loadError: string | null;
  messages: ViewMessage[];
  /** A reply this window is streaming. */
  streaming: boolean;
  stopping: boolean;
  /** A message was refused or a reset failed. */
  notice: Notice | null;
}

export interface SendBody {
  text: string;
  action?: ChatActionView;
}

const EMPTY: Omit<ThreadView, 'thread'> = {
  status: 'idle',
  loadError: null,
  messages: [],
  streaming: false,
  stopping: false,
  notice: null,
};

let localId = 0;
const nextId = (p: string): string => `local-${p}-${++localId}`;

/** Apply one non-UI event to the reply being streamed (pure). */
export function applyEvent(msg: ViewMessage, ev: ChatEventView): ViewMessage {
  switch (ev.type) {
    case 'text_delta': {
      if (!ev.text) return msg;
      const parts = [...msg.parts];
      const last = parts[parts.length - 1];
      if (last?.kind === 'text')
        parts[parts.length - 1] = { kind: 'text', text: last.text + ev.text };
      else parts.push({ kind: 'text', text: ev.text });
      return { ...msg, parts };
    }
    case 'tool_start':
      return {
        ...msg,
        parts: [
          ...msg.parts,
          { kind: 'tool', chip: { id: ev.id, name: ev.name, summary: ev.summary, ok: null } },
        ],
      };
    case 'tool_end':
      return {
        ...msg,
        parts: msg.parts.map((p) =>
          p.kind === 'tool' && p.chip.id === ev.id
            ? {
                kind: 'tool',
                chip: { ...p.chip, ok: ev.ok, summary: ev.summary || p.chip.summary },
              }
            : p,
        ),
      };
    case 'done':
      return { ...msg, stop: ev.stop, pending: false };
    case 'error':
      return { ...msg, error: { kind: ev.kind, message: ev.message }, pending: false };
    default:
      return msg;
  }
}

/** A stored message as a view message (tool chips first: the transcript keeps no order). */
export function fromTranscript(m: ChatMessageView): ViewMessage {
  const parts: Part[] = (m.tools ?? []).map((chip) => ({ kind: 'tool', chip }));
  if (m.role === 'assistant' && m.text) parts.push({ kind: 'text', text: m.text });
  const out: ViewMessage = {
    id: `m-${m.seq}`,
    role: m.role,
    text: m.role === 'user' ? m.text : '',
    parts,
    error: m.error ?? null,
  };
  if (m.action) out.action = m.action;
  if (m.stop) out.stop = m.stop;
  return out;
}

export function userText(body: SendBody): string {
  const text = body.text.trim();
  if (!body.action) return text;
  return ACTION_TEXT[body.action] + (text ? `\n\n${text}` : '');
}

type UiListener = (event: UiEventView, thread: string) => void;

export class ChatStore {
  /** After the tutor opens problem `to` from thread `from`, the pane there keeps showing `from`. */
  follow: { from: string; to: string } | null = null;
  status: TutorStatusView | null = null;
  private views = new Map<string, ThreadView>();
  private listeners = new Set<() => void>();
  private uiListeners = new Set<UiListener>();
  private streams = new Map<string, Stream<unknown>>();
  private lastSent = new Map<string, SendBody>();

  // ------------------------------------------------------------ subscriptions

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  onUi(fn: UiListener): () => void {
    this.uiListeners.add(fn);
    return () => {
      this.uiListeners.delete(fn);
    };
  }

  get(thread: string): ThreadView {
    let v = this.views.get(thread);
    if (!v) {
      v = { thread, ...EMPTY };
      this.views.set(thread, v);
    }
    return v;
  }

  getStatus = (): TutorStatusView | null => this.status;

  private changed(): void {
    this.listeners.forEach((l) => l());
  }

  private set(
    thread: string,
    patch: Partial<ThreadView> | ((v: ThreadView) => Partial<ThreadView>),
  ): void {
    const cur = this.get(thread);
    this.views.set(thread, { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) });
    this.changed();
  }

  private emitUi(event: UiEventView, thread: string): void {
    for (const l of [...this.uiListeners]) {
      try {
        l(event, thread);
      } catch (err) {
        console.error('chat ui handler failed', err);
      }
    }
  }

  // ------------------------------------------------------------ status

  async refreshStatus(): Promise<TutorStatusView | null> {
    try {
      this.status = await invoke('tutor:status');
    } catch {
      this.status = null;
    }
    this.changed();
    return this.status;
  }

  // ------------------------------------------------------------ transcript

  async load(thread: string, force = false): Promise<void> {
    const cur = this.get(thread);
    if (!force && (cur.status === 'loading' || cur.status === 'ready')) return;
    this.set(thread, { status: 'loading', loadError: null });
    try {
      const r = await invoke('chat:thread', { thread });
      if (this.get(thread).streaming) {
        // Our own reply started meanwhile: it is newer.
        this.set(thread, { status: 'ready' });
        return;
      }
      this.set(thread, { status: 'ready', messages: r.messages.map(fromTranscript) });
    } catch (err) {
      this.set(thread, { status: 'error', loadError: (err as Error).message });
    }
  }

  // ------------------------------------------------------------ turns

  /**
   * Send a message and stream the reply. `code` is the editor's current code
   * for the thread's problem. Resolves false if the message was refused.
   */
  async send(thread: string, body: SendBody, code?: string): Promise<boolean> {
    const cur = this.get(thread);
    if (cur.streaming) return false;
    this.lastSent.set(thread, body);
    const user: ViewMessage = { id: nextId('u'), role: 'user', text: userText(body), parts: [] };
    if (body.action) user.action = body.action;
    let reply: ViewMessage = {
      id: nextId('a'),
      role: 'assistant',
      text: '',
      parts: [],
      pending: true,
    };
    const setReply = (next: ViewMessage): void => {
      const id = reply.id;
      reply = next;
      this.set(thread, (v) => ({ messages: v.messages.map((m) => (m.id === id ? next : m)) }));
    };
    this.set(thread, (v) => ({
      messages: [...v.messages, user, reply],
      streaming: true,
      stopping: false,
      notice: null,
      status: v.status === 'idle' ? 'ready' : v.status,
    }));
    let got = false;
    let ended = false;
    let refused = false;
    const request: { thread: string; text: string; action?: ChatActionView; code?: string } = {
      thread,
      text: body.text,
    };
    if (body.action) request.action = body.action;
    if (code !== undefined) request.code = code;
    const s = stream('chat:send', request, (ev) => {
      got = true;
      if (ev.type === 'ui_event') {
        this.emitUi(ev.event, thread);
        return;
      }
      setReply(applyEvent(reply, ev));
      if (ev.type === 'done' || ev.type === 'error') ended = true;
    });
    this.streams.set(thread, s);
    try {
      const { message } = await s.result;
      // Main stores every reply; if an event went missing, show what it stored.
      if (!ended) setReply({ ...fromTranscript(message), id: reply.id, pending: false });
    } catch (err) {
      if (err instanceof IpcError && err.code === 'cancelled') {
        if (!ended)
          setReply(applyEvent(reply, { type: 'error', kind: 'cancelled', message: 'Stopped.' }));
      } else if (err instanceof IpcError && err.code === 'refused' && !got) {
        refused = true;
        this.set(thread, (v) => ({
          messages: v.messages.filter((m) => m.id !== user.id && m.id !== reply.id),
          notice: { code: err.reason ?? 'refused', message: err.message },
        }));
        if (err.reason === 'unavailable') void this.refreshStatus();
      } else if (!ended) {
        setReply(
          applyEvent(reply, {
            type: 'error',
            kind: 'other',
            message: (err as Error).message || 'The tutor failed unexpectedly.',
          }),
        );
      }
    } finally {
      if (this.streams.get(thread) === s) this.streams.delete(thread);
      this.set(thread, { streaming: false, stopping: false });
    }
    return !refused;
  }

  /** Send the last message again (after an error). */
  retry(thread: string, code?: string): Promise<boolean> {
    const body = this.lastSent.get(thread);
    return body ? this.send(thread, body, code) : Promise.resolve(false);
  }

  canRetry(thread: string): boolean {
    return this.lastSent.has(thread);
  }

  /** Stop the reply: cancels the stream, which stops the turn in main. */
  stop(thread: string): void {
    const s = this.streams.get(thread);
    if (!s || !this.get(thread).streaming) return;
    this.set(thread, { stopping: true });
    s.cancel();
  }

  /** Start a new chat; main archives the old one. */
  async reset(thread: string): Promise<boolean> {
    if (this.get(thread).streaming) return false;
    try {
      await invoke('chat:reset', { thread });
      this.lastSent.delete(thread);
      this.set(thread, { messages: [], notice: null, status: 'ready' });
      return true;
    } catch (err) {
      this.set(thread, {
        notice: {
          code: err instanceof IpcError ? (err.reason ?? err.code) : 'error',
          message: (err as Error).message,
        },
      });
      return false;
    }
  }

  dismissNotice(thread: string): void {
    this.set(thread, { notice: null });
  }
}

export const chatStore = new ChatStore();
export const ChatStoreContext = createContext<ChatStore>(chatStore);

export function useChatStore(): ChatStore {
  return useContext(ChatStoreContext);
}

export function useThread(store: ChatStore, thread: string): ThreadView {
  return useSyncExternalStore(store.subscribe, () => store.get(thread));
}

export function useTutorStatus(store: ChatStore): TutorStatusView | null {
  return useSyncExternalStore(store.subscribe, store.getStatus);
}
