/**
 * `Storage` in memory, for tests of core logic and of UI code that needs a
 * storage without SQLite. Same contract as the app's `SqliteStorage`
 * (`apps/desktop/src/main/storage/`): one queue for `write` and `serial`,
 * each `write` atomic (rolled back if it throws), records copied in and out.
 *
 * Not for production: nothing is persisted, and re-entry from inside a serial
 * task is detected only for the synchronous part (no AsyncLocalStorage here).
 */
import type {
  AttemptRecord,
  HintRecord,
  MessageRecord,
  ProblemRecord,
  ProfileRecord,
  Storage,
  StorageReader,
  StorageWriter,
  TestRunRecord,
  ThreadRecord,
  TopicProgressRecord,
} from '../storage';

interface State {
  meta: Map<string, string>;
  profile: ProfileRecord | null;
  topics: Map<string, TopicProgressRecord>;
  problems: Map<string, ProblemRecord>;
  attempts: AttemptRecord[];
  hints: HintRecord[];
  threads: Map<string, ThreadRecord>;
  messages: MessageRecord[];
  testRuns: TestRunRecord[];
  nextAttemptId: number;
  nextRunId: number;
}

const copy = <T>(v: T): T => structuredCloneish(v);

/** Deep copy of plain records (JSON-like values and bigints). */
function structuredCloneish<T>(v: T): T {
  if (Array.isArray(v)) return v.map(structuredCloneish) as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = structuredCloneish(x);
    return out as T;
  }
  return v;
}

function cloneState(s: State): State {
  return {
    meta: new Map(s.meta),
    profile: copy(s.profile),
    topics: new Map([...s.topics].map(([k, v]) => [k, copy(v)])),
    problems: new Map([...s.problems].map(([k, v]) => [k, copy(v)])),
    attempts: s.attempts.map(copy),
    hints: s.hints.map(copy),
    threads: new Map([...s.threads].map(([k, v]) => [k, copy(v)])),
    messages: s.messages.map(copy),
    testRuns: s.testRuns.map(copy),
    nextAttemptId: s.nextAttemptId,
    nextRunId: s.nextRunId,
  };
}

export class MemoryStorage implements Storage {
  private s: State = {
    meta: new Map(),
    profile: null,
    topics: new Map(),
    problems: new Map(),
    attempts: [],
    hints: [],
    threads: new Map(),
    messages: [],
    testRuns: [],
    nextAttemptId: 1,
    nextRunId: 1,
  };
  private tail: Promise<unknown> = Promise.resolve();
  private inSerial = 0;
  private writing = false;

  read<T>(fn: (db: StorageReader) => T): T {
    return fn(this.writer());
  }

  write<T>(fn: (db: StorageWriter) => T): Promise<T> {
    this.checkReentry('write');
    return this.enqueue(() => this.transaction(fn));
  }

  serial<T>(task: (write: <U>(fn: (db: StorageWriter) => U) => U) => Promise<T>): Promise<T> {
    this.checkReentry('serial');
    return this.enqueue(async () => {
      this.inSerial++;
      try {
        return await task((fn) => this.transaction(fn));
      } finally {
        this.inSerial--;
      }
    });
  }

  /** Resolves once every queued task has settled. */
  async idle(): Promise<void> {
    await this.tail;
  }

  private checkReentry(what: string): void {
    if (this.inSerial || this.writing)
      throw new Error(
        `storage.${what}() called from inside a write or serial task would wait on itself`,
      );
  }

  private enqueue<T>(task: () => T | Promise<T>): Promise<T> {
    const run = this.tail.then(task);
    this.tail = run.catch(() => undefined);
    return run;
  }

  private transaction<T>(fn: (db: StorageWriter) => T): T {
    const saved = cloneState(this.s);
    this.writing = true;
    try {
      const result = fn(this.writer());
      if (result instanceof Promise)
        throw new Error('a storage write function must be synchronous');
      return result;
    } catch (e) {
      this.s = saved;
      throw e;
    } finally {
      this.writing = false;
    }
  }

  private writer(): StorageWriter {
    const s = (): State => this.s;
    const attempt = (id: number): AttemptRecord | undefined =>
      s().attempts.find((a) => a.id === id);
    return {
      getMeta: (key) => s().meta.get(key) ?? null,
      getProfile: () => copy(s().profile),
      getTopicProgress: (topic) => copy(s().topics.get(topic) ?? null),
      listTopicProgress: () =>
        [...s().topics.values()].sort((a, b) => (a.topic < b.topic ? -1 : 1)).map(copy),
      getProblem: (slug) => copy(s().problems.get(slug) ?? null),
      listProblems: (filter = {}) =>
        [...s().problems.values()]
          .filter(
            (p) =>
              (filter.source === undefined || p.source === filter.source) &&
              (filter.topic === undefined || p.topic === filter.topic),
          )
          .sort((a, b) => (a.topic + a.slug < b.topic + b.slug ? -1 : 1))
          .map(copy),
      getAttempt: (id) => copy(attempt(id) ?? null),
      getOpenAttempt: (slug) =>
        copy(
          [...s().attempts].reverse().find((a) => a.slug === slug && a.outcome === null) ?? null,
        ),
      listAttempts: (filter = {}) => {
        let out = s().attempts.filter(
          (a) =>
            (filter.slug === undefined || a.slug === filter.slug) &&
            (filter.open === undefined || (a.outcome === null) === filter.open),
        );
        if (filter.last !== undefined) out = out.slice(Math.max(0, out.length - filter.last));
        return out.map(copy);
      },
      listHints: (attemptId) =>
        s()
          .hints.filter((h) => h.attemptId === attemptId)
          .map(copy),
      getThread: (id) => copy(s().threads.get(id) ?? null),
      listThreads: (filter = {}) =>
        [...s().threads.values()]
          .filter(
            (t) => filter.archived === undefined || (t.archivedAt !== null) === filter.archived,
          )
          .map(copy),
      listMessages: (threadId, filter = {}) =>
        s()
          .messages.filter((m) => m.threadId === threadId && m.seq > (filter.afterSeq ?? 0))
          .map(copy),
      listTestRuns: (attemptId) =>
        s()
          .testRuns.filter((r) => r.attemptId === attemptId)
          .map(copy),

      setMeta: (key, value) => void s().meta.set(key, value),
      saveProfile: (p) => void (s().profile = copy(p)),
      saveTopicProgress: (t) => void s().topics.set(t.topic, copy(t)),
      saveProblem: (p) => void s().problems.set(p.slug, copy(p)),
      deleteProblem: (slug) => void s().problems.delete(slug),
      createAttempt: (a) => {
        const rec: AttemptRecord = {
          id: s().nextAttemptId++,
          slug: a.slug,
          language: a.language,
          startedAt: a.startedAt,
          finishedAt: null,
          passed: null,
          total: null,
          outcome: null,
          hintsUsed: 0,
          explained: false,
          notes: '',
        };
        s().attempts.push(rec);
        return copy(rec);
      },
      updateAttempt: (id, update) => {
        const a = attempt(id);
        if (!a) throw new Error(`no attempt with id ${id}`);
        Object.assign(a, copy(update));
        return copy(a);
      },
      addHint: (h) => {
        if (!attempt(h.attemptId)) throw new Error(`no attempt with id ${h.attemptId}`);
        s().hints.push(copy(h));
      },
      saveThread: (t) => void s().threads.set(t.id, copy(t)),
      appendMessage: (m) => {
        if (!s().threads.has(m.threadId)) throw new Error(`no thread ${m.threadId}`);
        const seq = s().messages.filter((x) => x.threadId === m.threadId).length + 1;
        const rec = { ...copy(m), seq };
        s().messages.push(rec);
        return copy(rec);
      },
      deleteThread: (id) => {
        s().threads.delete(id);
        s().messages = s().messages.filter((m) => m.threadId !== id);
      },
      archiveThread: (id, archivedId, archivedAt) => {
        const t = s().threads.get(id);
        if (!t) throw new Error(`no thread ${id}`);
        if (s().threads.has(archivedId)) throw new Error(`thread ${archivedId} exists`);
        s().threads.delete(id);
        s().threads.set(archivedId, { ...t, id: archivedId, archivedAt });
        for (const m of s().messages) if (m.threadId === id) m.threadId = archivedId;
      },
      resetProgress: () => {
        s().attempts = [];
        s().hints = [];
        s().testRuns = [];
        s().topics.clear();
      },
      addTestRun: (r) => {
        if (!attempt(r.attemptId)) throw new Error(`no attempt with id ${r.attemptId}`);
        const rec = { ...copy(r), id: s().nextRunId++ };
        s().testRuns.push(rec);
        return copy(rec);
      },
    };
  }
}
