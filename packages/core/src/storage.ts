/**
 * The storage interface core logic is written against (SPEC §4.2). The
 * desktop app implements it with SQLite in the main process
 * (`apps/desktop/src/main/storage/`); tests can implement it in memory.
 *
 * Reads are synchronous and see committed state. Writes are serialised: every
 * `write` and `serial` task runs one at a time, in the order they were
 * queued, so a state-changing tool call and a UI action never interleave
 * (as in `dsa-tutor`). A `write` applies its whole function atomically.
 *
 * Storage holds records as they are; validation, defaults and time belong to
 * the caller (timestamps are ISO 8601 strings the caller supplies).
 */
import type { Difficulty, ProblemSource } from './problems/schema';
import type { JsonValue } from './types/json';
import type { Language } from './types/signature';

export const TOPIC_LEVELS = ['new', 'learning', 'comfortable'] as const;
export type TopicLevel = (typeof TOPIC_LEVELS)[number];

export const ATTEMPT_OUTCOMES = ['unaided', 'with_hints', 'gave_up'] as const;
/** How an attempt ended; `null` while it is open. */
export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];

export const TEST_RUN_KINDS = ['run', 'submit'] as const;
export type TestRunKind = (typeof TEST_RUN_KINDS)[number];

export const MESSAGE_ROLES = ['user', 'assistant'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

/** The learner's profile: one row. Choices are validated by the teaching logic (T06). */
export interface ProfileRecord {
  goal: string;
  interviewDate: string | null;
  experience: string;
  /** Comfort per topic group, e.g. `{ "linear": "some" }`. */
  comfort: Record<string, string>;
  hintPreference: string;
  focusTopic: string | null;
  language: Language;
  onboarded: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TopicProgressRecord {
  topic: string;
  level: TopicLevel;
  unaidedSolves: number;
  updatedAt: string;
}

/** The index of known problems; the files themselves live at `path`. */
export interface ProblemRecord {
  slug: string;
  source: ProblemSource;
  topic: string;
  difficulty: Difficulty;
  title: string;
  /** Where the problem's folder is: relative to `content/` for curated, to the data folder otherwise. */
  path: string;
  contentVersion: number;
  createdAt: string;
}

export interface AttemptRecord {
  id: number;
  slug: string;
  language: Language;
  startedAt: string;
  finishedAt: string | null;
  /** Tests passed and total of the run that closed the attempt; `null` while open. */
  passed: number | null;
  total: number | null;
  outcome: AttemptOutcome | null;
  hintsUsed: number;
  explained: boolean;
  notes: string;
}

export type NewAttempt = Pick<AttemptRecord, 'slug' | 'language' | 'startedAt'>;
export type AttemptUpdate = Partial<Omit<AttemptRecord, 'id' | 'slug' | 'startedAt'>>;

export interface HintRecord {
  attemptId: number;
  level: number;
  givenAt: string;
}

export interface ThreadRecord {
  /** `home`, or the slug of the problem the thread is about. */
  id: string;
  backend: string;
  /** Whatever the backend needs to resume (e.g. a session id). */
  backendState: JsonValue;
  createdAt: string;
  archivedAt: string | null;
}

export interface MessageRecord {
  threadId: string;
  /** 1, 2, 3… within the thread; assigned by storage. */
  seq: number;
  role: MessageRole;
  /** Text and tool events. */
  content: JsonValue;
  createdAt: string;
}

export interface TestRunRecord {
  id: number;
  attemptId: number;
  kind: TestRunKind;
  /** The run report, already redacted (SPEC §6.1): no hidden inputs or expected values. */
  report: JsonValue;
  createdAt: string;
}

export interface StorageReader {
  getMeta(key: string): string | null;
  getProfile(): ProfileRecord | null;

  getTopicProgress(topic: string): TopicProgressRecord | null;
  listTopicProgress(): TopicProgressRecord[];

  getProblem(slug: string): ProblemRecord | null;
  listProblems(filter?: { source?: ProblemSource; topic?: string }): ProblemRecord[];

  getAttempt(id: number): AttemptRecord | null;
  /** The newest attempt on `slug` that has no outcome yet. */
  getOpenAttempt(slug: string): AttemptRecord | null;
  /** Oldest first; with `last`, only the newest `last` of them (still oldest first). */
  listAttempts(filter?: { slug?: string; open?: boolean; last?: number }): AttemptRecord[];

  listHints(attemptId: number): HintRecord[];

  getThread(id: string): ThreadRecord | null;
  listThreads(filter?: { archived?: boolean }): ThreadRecord[];
  /** In order of `seq`; with `afterSeq`, only later ones. */
  listMessages(threadId: string, filter?: { afterSeq?: number }): MessageRecord[];

  listTestRuns(attemptId: number): TestRunRecord[];
}

export interface StorageWriter extends StorageReader {
  setMeta(key: string, value: string): void;
  saveProfile(profile: ProfileRecord): void;

  saveTopicProgress(progress: TopicProgressRecord): void;

  /** Insert or replace by slug. */
  saveProblem(problem: ProblemRecord): void;
  deleteProblem(slug: string): void;

  createAttempt(attempt: NewAttempt): AttemptRecord;
  /** Throws if there is no such attempt. */
  updateAttempt(id: number, update: AttemptUpdate): AttemptRecord;

  addHint(hint: HintRecord): void;

  /** Insert or replace by id (replacing keeps its messages). */
  saveThread(thread: ThreadRecord): void;
  /** Appends at the next `seq` and returns the stored message. */
  appendMessage(message: Omit<MessageRecord, 'seq'>): MessageRecord;
  /** Deletes the thread and its messages. */
  deleteThread(id: string): void;
  /**
   * Moves thread `id` and its messages to the new id `archivedId` with
   * `archivedAt` set ("Reset chat"); `id` is then free for a new thread.
   * Throws if `id` does not exist or `archivedId` does.
   */
  archiveThread(id: string, archivedId: string, archivedAt: string): void;

  addTestRun(run: Omit<TestRunRecord, 'id'>): TestRunRecord;

  /**
   * "Reset progress" (SPEC §4.5): deletes every attempt with its hints and
   * test runs, and every topic level. The profile, problems and chats stay.
   */
  resetProgress(): void;
}

export interface Storage {
  /** Reads committed state now. Must not be used to write. */
  read<T>(fn: (db: StorageReader) => T): T;

  /**
   * Queues `fn` behind every earlier task and applies it atomically: if it
   * throws, nothing it wrote is kept. `fn` must be synchronous.
   */
  write<T>(fn: (db: StorageWriter) => T): Promise<T>;

  /**
   * Queues an asynchronous task (e.g. run the tests, then record the attempt)
   * and holds the queue until it settles. Inside, write with the `write`
   * argument, which applies at once and atomically; do not call the
   * storage's own `write` or `serial` from inside (it would wait on itself).
   */
  serial<T>(task: (write: <U>(fn: (db: StorageWriter) => U) => U) => Promise<T>): Promise<T>;
}
