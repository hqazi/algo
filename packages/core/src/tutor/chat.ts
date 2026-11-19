/**
 * The chat service (SPEC §7.3, §7.4): threads in storage and the turn runner.
 * Ported from `dsa-tutor/dsa_tutor/server/chat.py`, without HTTP.
 *
 * Threads: one per problem (its slug) plus `home`, in `threads` / `messages`.
 * A thread's `backendState` holds each backend's opaque state
 * (`{ <backend id>: state }`), so switching backends and back keeps both.
 * "Reset chat" archives the thread (it keeps its messages under a new id,
 * `<id>~<n>`, with `archivedAt` set) and the next message starts afresh.
 *
 * A turn: `send` checks the backend is available and the thread is idle,
 * stores the user message, runs the backend and passes its events on, then
 * stores the assistant message and the backend state, whatever the outcome.
 * Every turn ends with exactly one `done` or `error`; a cancelled turn ends
 * with `error` of kind `cancelled`. One turn per thread at a time.
 *
 * The per-turn context (problem, language, code, last redacted report) comes
 * from the injected `context` function in the main process, never from the
 * UI, except the editor's code, which is the user's own.
 */
import type { Storage } from '../storage';
import type { JsonValue } from '../types/json';
import { SLUG_RE } from '../problems/schema';
import type {
  ChatAction,
  NeutralMessage,
  SignalLike,
  ToolChip,
  TurnContext,
  TurnTools,
  TutorBackend,
} from './backend';
import { chatError, type ChatEvent } from './chat-events';

export const HOME_THREAD = 'home';
export const MAX_USER_TEXT = 20_000;
export const ACTION_TEXT: Record<ChatAction, string> = {
  hint: 'Give me the next hint for this problem.',
  review: 'Please review my current solution.',
  explain: 'Please explain this problem and its solution.',
};

/** Thrown when a message is refused before a turn starts. */
export class ChatRefusal extends Error {
  constructor(
    readonly reason: 'busy' | 'unavailable' | 'invalid_thread' | 'empty' | 'too_long',
    message: string,
  ) {
    super(message);
    this.name = 'ChatRefusal';
  }
}

export interface StoredMessage extends NeutralMessage {
  seq: number;
  createdAt: string;
}

export interface SendRequest {
  thread: string;
  text?: string;
  action?: ChatAction;
  /** The editor's current code, if the thread's problem is open in it. */
  code?: string;
}

export interface SendResult {
  /** The stored assistant message. */
  message: StoredMessage;
}

export interface ChatDeps {
  storage: Storage;
  /** The backend to use now (settings may change between turns). */
  backend: () => TutorBackend;
  tools: TurnTools;
  systemPrompt: string;
  /** Builds the turn's context for a thread; `code` is the editor's, if sent. */
  context: (thread: string, code: string | undefined) => Promise<TurnContext>;
  now: () => string;
  /** Turn failures (logged without message text or code). */
  log?: (message: string, error?: unknown) => void;
}

export function isThreadId(id: string): boolean {
  return id === HOME_THREAD || (id.length <= 80 && SLUG_RE.test(id));
}

function checkThread(id: string): void {
  if (!isThreadId(id))
    throw new ChatRefusal('invalid_thread', `thread must be "${HOME_THREAD}" or a problem slug`);
}

const isObj = (v: unknown): v is Record<string, JsonValue> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A stored `messages.content` as a neutral message (defensive: rows may come from older versions). */
function toNeutral(role: 'user' | 'assistant', content: JsonValue): NeutralMessage {
  const c = isObj(content) ? content : {};
  const out: NeutralMessage = { role, text: typeof c.text === 'string' ? c.text : '' };
  if (typeof c.action === 'string' && c.action in ACTION_TEXT) out.action = c.action as ChatAction;
  if (typeof c.slug === 'string') out.slug = c.slug;
  if (Array.isArray(c.tools)) {
    out.tools = c.tools.filter(isObj).map((t): ToolChip => ({
      id: String(t.id ?? ''),
      name: String(t.name ?? ''),
      summary: String(t.summary ?? ''),
      ok: typeof t.ok === 'boolean' ? t.ok : null,
    }));
  }
  if (typeof c.stop === 'string') out.stop = c.stop;
  if (isObj(c.error))
    out.error = { kind: String(c.error.kind ?? 'other'), message: String(c.error.message ?? '') };
  return out;
}

function toContent(m: NeutralMessage): JsonValue {
  const out: Record<string, JsonValue> = { text: m.text };
  if (m.action) out.action = m.action;
  if (m.slug) out.slug = m.slug;
  if (m.tools?.length) out.tools = m.tools.map((t) => ({ ...t }));
  if (m.stop) out.stop = m.stop;
  if (m.error) out.error = { ...m.error };
  return out;
}

export class ChatService {
  private readonly running = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: ChatDeps) {}

  isRunning(thread: string): boolean {
    return this.running.has(thread);
  }

  /** The current (not archived) transcript of a thread. */
  transcript(thread: string): StoredMessage[] {
    checkThread(thread);
    return this.deps.storage.read((db) => {
      const t = db.getThread(thread);
      if (!t || t.archivedAt) return [];
      return db.listMessages(thread).map((m) => ({
        ...toNeutral(m.role, m.content),
        seq: m.seq,
        createdAt: m.createdAt,
      }));
    });
  }

  /** Archive the thread; the next message starts a new one. Refused while a turn runs. */
  async reset(thread: string): Promise<{ archived: boolean }> {
    checkThread(thread);
    if (this.running.has(thread))
      throw new ChatRefusal('busy', 'the tutor is still replying in this chat; stop it first');
    const now = this.deps.now();
    return this.deps.storage.write((db) => {
      const t = db.getThread(thread);
      if (!t) return { archived: false };
      let n = db
        .listThreads({ archived: true })
        .filter((x) => x.id.startsWith(`${thread}~`)).length;
      while (db.getThread(`${thread}~${n + 1}`)) n++;
      db.archiveThread(thread, `${thread}~${n + 1}`, now);
      return { archived: true };
    });
  }

  /**
   * Run one turn. Resolves when the turn has ended and is stored; `emit` gets
   * every event, ending with one `done` or `error`. Rejects only with a
   * `ChatRefusal`, before anything is stored or emitted.
   */
  async send(
    req: SendRequest,
    signal: SignalLike,
    emit: (event: ChatEvent) => void,
  ): Promise<SendResult> {
    checkThread(req.thread);
    const typed = (req.text ?? '').trim();
    if (typed.length > MAX_USER_TEXT)
      throw new ChatRefusal('too_long', `messages are limited to ${MAX_USER_TEXT} characters`);
    const text = req.action ? ACTION_TEXT[req.action] + (typed ? `\n\n${typed}` : '') : typed;
    if (!text) throw new ChatRefusal('empty', 'send text or an action');
    if (this.running.has(req.thread))
      throw new ChatRefusal('busy', 'the tutor is already replying in this chat');

    const backend = this.deps.backend();
    // Claim the thread before the first await, so two sends cannot both start.
    let release!: () => void;
    this.running.set(req.thread, new Promise<void>((r) => (release = r)));
    try {
      const status = await backend.status();
      if (!status.available)
        throw new ChatRefusal('unavailable', status.reason ?? 'the tutor is not available');
      const context = await this.deps.context(req.thread, req.code);
      return await this.runTurn(req, text, context, backend, signal, emit);
    } finally {
      this.running.delete(req.thread);
      release();
    }
  }

  private async runTurn(
    req: SendRequest,
    text: string,
    context: TurnContext,
    backend: TutorBackend,
    signal: SignalLike,
    emit: (event: ChatEvent) => void,
  ): Promise<SendResult> {
    const { storage, now } = this.deps;
    const thread = req.thread;
    const user: NeutralMessage = { role: 'user', text };
    if (req.action) user.action = req.action;
    if (context.slug) user.slug = context.slug;

    // Store the user message and read what came before it, in one write.
    const { history, states } = await storage.write((db) => {
      let t = db.getThread(thread);
      if (t?.archivedAt) {
        db.deleteThread(thread); // cannot happen with `reset`, but never append to an archived thread
        t = null;
      }
      const prior = t
        ? db.listMessages(thread).map((m) => toNeutral(m.role, m.content))
        : ([] as NeutralMessage[]);
      const states = t && isObj(t.backendState) ? { ...t.backendState } : {};
      db.saveThread({
        id: thread,
        backend: backend.id,
        backendState: states,
        createdAt: t?.createdAt ?? now(),
        archivedAt: null,
      });
      db.appendMessage({
        threadId: thread,
        role: 'user',
        content: toContent(user),
        createdAt: now(),
      });
      return { history: prior, states };
    });

    const own = states[backend.id];
    const backendState: Record<string, JsonValue> = isObj(own) ? { ...own } : {};
    const reply: NeutralMessage = { role: 'assistant', text: '', tools: [] };
    const chips = new Map<string, ToolChip>();
    let finished = false;

    const pass = (event: ChatEvent): void => {
      switch (event.type) {
        case 'text_delta':
          reply.text += event.text;
          break;
        case 'tool_start': {
          const chip: ToolChip = {
            id: event.id,
            name: event.name,
            summary: event.summary,
            ok: null,
          };
          chips.set(event.id, chip);
          reply.tools!.push(chip);
          break;
        }
        case 'tool_end': {
          const chip = chips.get(event.id);
          if (chip) {
            chip.ok = event.ok;
            chip.summary = event.summary;
          }
          break;
        }
        case 'done':
          reply.stop = event.stop;
          finished = true;
          break;
        case 'error':
          reply.error = { kind: event.kind, message: event.message };
          finished = true;
          break;
        case 'ui_event':
          break;
      }
      try {
        emit(event);
      } catch (e) {
        this.deps.log?.('chat event listener failed', e);
      }
    };

    try {
      const turn = {
        threadId: thread,
        systemPrompt: this.deps.systemPrompt,
        history,
        userText: text,
        context,
        tools: this.deps.tools,
        backendState,
      };
      for await (const event of backend.runTurn(turn, signal)) {
        if (finished) break;
        if (signal.aborted && (event.type === 'done' || event.type === 'error')) break;
        pass(event);
        if (finished) break;
      }
      if (!finished)
        pass(
          signal.aborted
            ? chatError('cancelled', 'Stopped.')
            : chatError('other', 'The tutor stopped without finishing its reply.'),
        );
    } catch (e) {
      if (!finished) {
        if (signal.aborted) pass(chatError('cancelled', 'Stopped.'));
        else {
          this.deps.log?.(`chat turn in ${thread} failed`, e);
          pass(chatError('other', 'The tutor failed unexpectedly. Try again.'));
        }
      }
    }

    if (!reply.tools!.length) delete reply.tools;
    const message = await storage.write((db) => {
      const t = db.getThread(thread);
      const latest = t && isObj(t.backendState) ? { ...t.backendState } : {};
      latest[backend.id] = backendState;
      db.saveThread({
        id: thread,
        backend: backend.id,
        backendState: latest,
        createdAt: t?.createdAt ?? now(),
        archivedAt: null,
      });
      return db.appendMessage({
        threadId: thread,
        role: 'assistant',
        content: toContent(reply),
        createdAt: now(),
      });
    });
    return { message: { ...reply, seq: message.seq, createdAt: message.createdAt } };
  }
}
