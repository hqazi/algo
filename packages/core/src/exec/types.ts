/**
 * The executor interface (SPEC §6.1).
 *
 * An executor runs a solution against test inputs and reports, per test, what
 * the solution returned. Grading (comparison with expected values) happens in
 * core (`grade.ts`), so every language and executor grades the same way, and
 * expected values never reach the code under test.
 */
import type { CompareSpec } from '../compare';
import type { TestCase } from '../problems/schema';
import type { Language, Signature } from '../types/signature';

export const EXECUTOR_IDS = ['pyodide', 'local', 'container'] as const;
export type ExecutorId = (typeof EXECUTOR_IDS)[number];

export interface ExecutorStatus {
  available: boolean;
  /** Why it is not available, in words for the user. */
  reason?: string;
  /** e.g. `{ pyodide: "314.0.7", python: "3.14.2" }`. */
  versions?: Record<string, string>;
}

/**
 * The part of `AbortSignal` executors use. Core has no DOM or Node types, so
 * it is declared structurally; a real `AbortSignal` satisfies it.
 */
export interface CancelSignal {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export interface Executor {
  id: ExecutorId;
  status(): Promise<ExecutorStatus>;
  run(job: RunJob, signal?: CancelSignal): Promise<RunReport>;
}

export interface RunJob {
  /** "python" in v1. */
  language: Language;
  /** The solution source. */
  code: string;
  signature: Signature;
  compare: CompareSpec;
  /** Inputs and expected values. Expected values never leave core. */
  tests: TestCase[];
  /** Per test, after `execution.timeScale`. */
  timeLimitMs: number;
  /** Advisory: not every executor can enforce it (see DECISIONS D-15). */
  memoryLimitMb: number;
}

export const RUN_ERROR_KINDS = ['compile', 'harness', 'runtime-missing', 'cancelled'] as const;
export type RunErrorKind = (typeof RUN_ERROR_KINDS)[number];

export interface RunReport {
  /** The harness ran (not: all passed). */
  ok: boolean;
  error?: { kind: RunErrorKind; message: string };
  results: TestResult[];
  durationMs: number;
}

export const TEST_STATUSES = ['pass', 'fail', 'error', 'timeout'] as const;
export type TestStatus = (typeof TEST_STATUSES)[number];

export interface TestResult {
  id: string;
  visibility: 'visible' | 'hidden';
  category?: string;
  status: TestStatus;
  // Visible tests only (removed by `redactReport` for hidden ones):
  input?: unknown;
  expected?: unknown;
  actual?: unknown;
  stdout?: string;
  message?: string;
  /** For errors: the exception type, e.g. "IndexError". */
  errorType?: string;
  /** For errors: the last line of the solution the error passed through. */
  line?: number;
  timeMs?: number;
}
