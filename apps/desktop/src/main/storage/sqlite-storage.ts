/**
 * `Storage` (packages/core) on SQLite, for the main process. All writes go
 * through one queue (SPEC §4.2): `write` and `serial` tasks run one at a
 * time in the order they were queued, each `write` in one transaction.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  parseJson,
  stringifyJson,
  type AttemptRecord,
  type AttemptUpdate,
  type HintRecord,
  type JsonValue,
  type MessageRecord,
  type NewAttempt,
  type ProblemRecord,
  type ProfileRecord,
  type Storage,
  type StorageReader,
  type StorageWriter,
  type TestRunRecord,
  type ThreadRecord,
  type TopicProgressRecord,
} from '@algorithm-tutor/core';
import type { SQLInputValue, StatementSync } from 'node:sqlite';
import { transaction, type Db } from './database';

type Row = Record<string, unknown>;
type Params = Record<string, unknown> | unknown[];

const str = (v: unknown): string => v as string;
const strOrNull = (v: unknown): string | null => (v === null ? null : (v as string));
const num = (v: unknown): number => v as number;
const numOrNull = (v: unknown): number | null => (v === null ? null : (v as number));
const bool = (v: unknown): boolean => v === 1;
const json = (v: unknown): JsonValue => parseJson(v as string);

const toProfile = (r: Row): ProfileRecord => ({
  goal: str(r.goal),
  interviewDate: strOrNull(r.interview_date),
  experience: str(r.experience),
  comfort: json(r.comfort) as Record<string, string>,
  hintPreference: str(r.hint_preference),
  focusTopic: strOrNull(r.focus_topic),
  language: str(r.language) as ProfileRecord['language'],
  onboarded: bool(r.onboarded),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
});

const toTopicProgress = (r: Row): TopicProgressRecord => ({
  topic: str(r.topic),
  level: str(r.level) as TopicProgressRecord['level'],
  unaidedSolves: num(r.unaided_solves),
  updatedAt: str(r.updated_at),
});

const toProblem = (r: Row): ProblemRecord => ({
  slug: str(r.slug),
  source: str(r.source) as ProblemRecord['source'],
  topic: str(r.topic),
  difficulty: str(r.difficulty) as ProblemRecord['difficulty'],
  title: str(r.title),
  path: str(r.path),
  contentVersion: num(r.content_version),
  createdAt: str(r.created_at),
});

const toAttempt = (r: Row): AttemptRecord => ({
  id: num(r.id),
  slug: str(r.slug),
  language: str(r.language) as AttemptRecord['language'],
  startedAt: str(r.started_at),
  finishedAt: strOrNull(r.finished_at),
  passed: numOrNull(r.passed),
  total: numOrNull(r.total),
  outcome: strOrNull(r.outcome) as AttemptRecord['outcome'],
  hintsUsed: num(r.hints_used),
  explained: bool(r.explained),
  notes: str(r.notes),
});

const toHint = (r: Row): HintRecord => ({
  attemptId: num(r.attempt_id),
  level: num(r.level),
  givenAt: str(r.given_at),
});

const toThread = (r: Row): ThreadRecord => ({
  id: str(r.id),
  backend: str(r.backend),
  backendState: json(r.backend_state),
  createdAt: str(r.created_at),
  archivedAt: strOrNull(r.archived_at),
});

const toMessage = (r: Row): MessageRecord => ({
  threadId: str(r.thread_id),
  seq: num(r.seq),
  role: str(r.role) as MessageRecord['role'],
  content: json(r.content),
  createdAt: str(r.created_at),
});

const toTestRun = (r: Row): TestRunRecord => ({
  id: num(r.id),
  attemptId: num(r.attempt_id),
  kind: str(r.kind) as TestRunRecord['kind'],
  report: json(r.report),
  createdAt: str(r.created_at),
});

type Named = Record<string, SQLInputValue>;

/** Splits `params` into node:sqlite's named object and positional values. */
function bind<T>(params: Params, call: (named: Named, anon: SQLInputValue[]) => T): T {
  return Array.isArray(params) ? call({}, params as SQLInputValue[]) : call(params as Named, []);
}

export class StorageClosedError extends Error {
  constructor() {
    super('storage is closed');
    this.name = 'StorageClosedError';
  }
}

export class SqliteStorage implements Storage {
  private readonly statements = new Map<string, StatementSync>();
  private readonly reader: StorageReader;
  private readonly writer: StorageWriter;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly insideSerial = new AsyncLocalStorage<true>();
  private closed = false;

  constructor(private readonly db: Db) {
    this.reader = this.makeReader();
    this.writer = { ...this.reader, ...this.makeWriter() };
  }

  read<T>(fn: (db: StorageReader) => T): T {
    this.checkOpen();
    return fn(this.reader);
  }

  write<T>(fn: (db: StorageWriter) => T): Promise<T> {
    this.checkReentry('write');
    return this.enqueue(() => this.transaction(fn));
  }

  serial<T>(task: (write: <U>(fn: (db: StorageWriter) => U) => U) => Promise<T>): Promise<T> {
    this.checkReentry('serial');
    return this.enqueue(() =>
      this.insideSerial.run(true, () => task((fn) => this.transaction(fn))),
    );
  }

  /** Waits for queued tasks, then closes the database. */
  async close(): Promise<void> {
    if (this.closed) return;
    await this.tail;
    this.closed = true;
    this.db.close();
  }

  private checkOpen(): void {
    if (this.closed) throw new StorageClosedError();
  }

  private checkReentry(what: string): void {
    this.checkOpen();
    if (this.insideSerial.getStore()) {
      throw new Error(
        `storage.${what}() called from inside a serial task would wait on itself; ` +
          'use the write function the task was given',
      );
    }
  }

  private enqueue<T>(task: () => T | Promise<T>): Promise<T> {
    const run = this.tail.then(() => {
      this.checkOpen();
      return task();
    });
    this.tail = run.catch(() => undefined);
    return run;
  }

  private transaction<T>(fn: (db: StorageWriter) => T): T {
    this.checkOpen();
    return transaction(this.db, () => {
      const result = fn(this.writer);
      if (result instanceof Promise) {
        throw new Error('a storage write function must be synchronous');
      }
      return result;
    });
  }

  private stmt(sql: string) {
    let s = this.statements.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      // Records carry fields a statement does not use.
      s.setAllowUnknownNamedParameters(true);
      this.statements.set(sql, s);
    }
    return s;
  }

  private get(sql: string, params: Params = []): Row | undefined {
    return bind(params, (named, anon) => this.stmt(sql).get(named, ...anon)) as Row | undefined;
  }

  private all(sql: string, params: Params = []): Row[] {
    return bind(params, (named, anon) => this.stmt(sql).all(named, ...anon)) as Row[];
  }

  private run(sql: string, params: Params = []) {
    return bind(params, (named, anon) => this.stmt(sql).run(named, ...anon));
  }

  private makeReader(): StorageReader {
    return {
      getMeta: (key) => {
        const r = this.get('SELECT value FROM meta WHERE key = ?', [key]);
        return r ? str(r.value) : null;
      },
      getProfile: () => {
        const r = this.get('SELECT * FROM profile WHERE id = 1');
        return r ? toProfile(r) : null;
      },
      getTopicProgress: (topic) => {
        const r = this.get('SELECT * FROM topic_progress WHERE topic = ?', [topic]);
        return r ? toTopicProgress(r) : null;
      },
      listTopicProgress: () =>
        this.all('SELECT * FROM topic_progress ORDER BY topic').map(toTopicProgress),
      getProblem: (slug) => {
        const r = this.get('SELECT * FROM problems WHERE slug = ?', [slug]);
        return r ? toProblem(r) : null;
      },
      listProblems: (filter = {}) =>
        this.all(
          'SELECT * FROM problems WHERE (@source IS NULL OR source = @source) ' +
            'AND (@topic IS NULL OR topic = @topic) ORDER BY topic, slug',
          { source: filter.source ?? null, topic: filter.topic ?? null },
        ).map(toProblem),
      getAttempt: (id) => {
        const r = this.get('SELECT * FROM attempts WHERE id = ?', [id]);
        return r ? toAttempt(r) : null;
      },
      getOpenAttempt: (slug) => {
        const r = this.get(
          'SELECT * FROM attempts WHERE slug = ? AND outcome IS NULL ORDER BY id DESC LIMIT 1',
          [slug],
        );
        return r ? toAttempt(r) : null;
      },
      listAttempts: (filter = {}) => {
        const open = filter.open === undefined ? null : filter.open ? 1 : 0;
        const where =
          'WHERE (@slug IS NULL OR slug = @slug) ' +
          'AND (@open IS NULL OR (outcome IS NULL) = @open)';
        const params = { slug: filter.slug ?? null, open };
        if (filter.last === undefined) {
          return this.all(`SELECT * FROM attempts ${where} ORDER BY id`, params).map(toAttempt);
        }
        return this.all(
          `SELECT * FROM (SELECT * FROM attempts ${where} ORDER BY id DESC LIMIT @last) ORDER BY id`,
          { ...params, last: Math.max(0, Math.floor(filter.last)) },
        ).map(toAttempt);
      },
      listHints: (attemptId) =>
        this.all('SELECT * FROM hints WHERE attempt_id = ? ORDER BY rowid', [attemptId]).map(
          toHint,
        ),
      getThread: (id) => {
        const r = this.get('SELECT * FROM threads WHERE id = ?', [id]);
        return r ? toThread(r) : null;
      },
      listThreads: (filter = {}) => {
        const archived = filter.archived === undefined ? null : filter.archived ? 1 : 0;
        return this.all(
          'SELECT * FROM threads WHERE (@archived IS NULL OR (archived_at IS NOT NULL) = @archived) ' +
            'ORDER BY created_at, id',
          { archived },
        ).map(toThread);
      },
      listMessages: (threadId, filter = {}) =>
        this.all('SELECT * FROM messages WHERE thread_id = ? AND seq > ? ORDER BY seq', [
          threadId,
          filter.afterSeq ?? 0,
        ]).map(toMessage),
      listTestRuns: (attemptId) =>
        this.all('SELECT * FROM test_runs WHERE attempt_id = ? ORDER BY id', [attemptId]).map(
          toTestRun,
        ),
    };
  }

  private makeWriter(): Omit<StorageWriter, keyof StorageReader> {
    const getAttempt = (id: number): AttemptRecord | null => this.reader.getAttempt(id);
    return {
      setMeta: (key, value) => {
        this.run(
          'INSERT INTO meta (key, value) VALUES (?, ?) ' +
            'ON CONFLICT (key) DO UPDATE SET value = excluded.value',
          [key, value],
        );
      },
      saveProfile: (p) => {
        this.run(
          'INSERT INTO profile (id, goal, interview_date, experience, comfort, hint_preference, ' +
            'focus_topic, language, onboarded, created_at, updated_at) VALUES (1, @goal, ' +
            '@interviewDate, @experience, @comfort, @hintPreference, @focusTopic, @language, ' +
            '@onboarded, @createdAt, @updatedAt) ON CONFLICT (id) DO UPDATE SET ' +
            'goal = excluded.goal, interview_date = excluded.interview_date, ' +
            'experience = excluded.experience, comfort = excluded.comfort, ' +
            'hint_preference = excluded.hint_preference, focus_topic = excluded.focus_topic, ' +
            'language = excluded.language, onboarded = excluded.onboarded, ' +
            'created_at = excluded.created_at, updated_at = excluded.updated_at',
          {
            ...p,
            comfort: stringifyJson(p.comfort),
            onboarded: p.onboarded ? 1 : 0,
          },
        );
      },
      saveTopicProgress: (t) => {
        this.run(
          'INSERT INTO topic_progress (topic, level, unaided_solves, updated_at) ' +
            'VALUES (@topic, @level, @unaidedSolves, @updatedAt) ON CONFLICT (topic) DO UPDATE ' +
            'SET level = excluded.level, unaided_solves = excluded.unaided_solves, ' +
            'updated_at = excluded.updated_at',
          { ...t },
        );
      },
      saveProblem: (p) => {
        this.run(
          'INSERT INTO problems (slug, source, topic, difficulty, title, path, content_version, ' +
            'created_at) VALUES (@slug, @source, @topic, @difficulty, @title, @path, ' +
            '@contentVersion, @createdAt) ON CONFLICT (slug) DO UPDATE SET ' +
            'source = excluded.source, topic = excluded.topic, difficulty = excluded.difficulty, ' +
            'title = excluded.title, path = excluded.path, ' +
            'content_version = excluded.content_version, created_at = excluded.created_at',
          { ...p },
        );
      },
      deleteProblem: (slug) => {
        this.run('DELETE FROM problems WHERE slug = ?', [slug]);
      },
      createAttempt: (a: NewAttempt) => {
        const { lastInsertRowid } = this.run(
          'INSERT INTO attempts (slug, language, started_at) VALUES (?, ?, ?)',
          [a.slug, a.language, a.startedAt],
        );
        return getAttempt(Number(lastInsertRowid))!;
      },
      updateAttempt: (id, update: AttemptUpdate) => {
        const current = getAttempt(id);
        if (!current) throw new Error(`no attempt with id ${id}`);
        const next = { ...current, ...update };
        this.run(
          'UPDATE attempts SET language = @language, finished_at = @finishedAt, ' +
            'passed = @passed, total = @total, outcome = @outcome, hints_used = @hintsUsed, ' +
            'explained = @explained, notes = @notes WHERE id = @id',
          {
            id,
            language: next.language,
            finishedAt: next.finishedAt,
            passed: next.passed,
            total: next.total,
            outcome: next.outcome,
            hintsUsed: next.hintsUsed,
            explained: next.explained ? 1 : 0,
            notes: next.notes,
          },
        );
        return getAttempt(id)!;
      },
      addHint: (h) => {
        this.run('INSERT INTO hints (attempt_id, level, given_at) VALUES (?, ?, ?)', [
          h.attemptId,
          h.level,
          h.givenAt,
        ]);
      },
      saveThread: (t) => {
        this.run(
          'INSERT INTO threads (id, backend, backend_state, created_at, archived_at) ' +
            'VALUES (@id, @backend, @backendState, @createdAt, @archivedAt) ' +
            'ON CONFLICT (id) DO UPDATE SET backend = excluded.backend, ' +
            'backend_state = excluded.backend_state, created_at = excluded.created_at, ' +
            'archived_at = excluded.archived_at',
          { ...t, backendState: stringifyJson(t.backendState) },
        );
      },
      appendMessage: (m) => {
        const r = this.get(
          'SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM messages WHERE thread_id = ?',
          [m.threadId],
        )!;
        const message: MessageRecord = { ...m, seq: num(r.seq) };
        this.run(
          'INSERT INTO messages (thread_id, seq, role, content, created_at) ' +
            'VALUES (@threadId, @seq, @role, @content, @createdAt)',
          { ...message, content: stringifyJson(message.content) },
        );
        return message;
      },
      deleteThread: (id) => {
        this.run('DELETE FROM threads WHERE id = ?', [id]);
      },
      archiveThread: (id, archivedId, archivedAt) => {
        if (!this.get('SELECT 1 AS x FROM threads WHERE id = ?', [id]))
          throw new Error(`no thread ${id}`);
        // The new row first, so the messages' foreign key always has a parent.
        this.run(
          'INSERT INTO threads (id, backend, backend_state, created_at, archived_at) ' +
            'SELECT ?, backend, backend_state, created_at, ? FROM threads WHERE id = ?',
          [archivedId, archivedAt, id],
        );
        this.run('UPDATE messages SET thread_id = ? WHERE thread_id = ?', [archivedId, id]);
        this.run('DELETE FROM threads WHERE id = ?', [id]);
      },
      addTestRun: (t) => {
        const { lastInsertRowid } = this.run(
          'INSERT INTO test_runs (attempt_id, kind, report, created_at) VALUES (?, ?, ?, ?)',
          [t.attemptId, t.kind, stringifyJson(t.report), t.createdAt],
        );
        return { ...t, id: Number(lastInsertRowid) };
      },
    };
  }
}
