/**
 * What crosses from the main process to a language harness and back.
 *
 * The request carries only the inputs (as JSON text, so 64-bit integers stay
 * exact; D-11), never expected values. The harness answers per test with the
 * solution's return value as JSON text, its stdout and its time, or an error;
 * `gradeRun` turns that into a `RunReport`.
 */
import { stringifyJson } from '../types/json';
import { parseType, type NeutralType } from '../types/neutral';
import type { RunJob } from './types';

/** Longest stdout kept per test; the rest is dropped (the end is kept). */
export const STDOUT_LIMIT = 2000;
/** Longest error message kept per test. */
export const MESSAGE_LIMIT = 500;
/** Largest return value, as JSON text, a harness may report. */
export const ACTUAL_LIMIT = 16 * 1024 * 1024;

export interface HarnessRequest {
  language: RunJob['language'];
  code: string;
  function: string;
  params: { name: string; type: NeutralType }[];
  returns: NeutralType;
  /** One entry per test, in order: `{ name: value }` as JSON text. */
  inputs: string[];
  timeLimitMs: number;
  memoryLimitMb: number;
}

/** Outcome of one test inside the harness. */
export type HarnessCaseResult =
  | {
      status: 'ok';
      actualJson: string;
      timeMs: number;
      stdout: string;
      /** Characters printed before the kept tail of `stdout`. */
      stdoutDropped?: number | undefined;
    }
  | {
      status: 'error';
      errorType: string;
      message: string;
      line?: number | undefined;
      timeMs?: number | undefined;
      stdout: string;
      stdoutDropped?: number | undefined;
    }
  | { status: 'timeout'; stdout?: string | undefined }
  /** Not reached: the job was cancelled or the harness failed first. */
  | { status: 'skipped' };

export type HarnessOutput =
  | { kind: 'ran'; cases: HarnessCaseResult[] }
  /** The solution failed to load (syntax error, missing function, error at import). */
  | {
      kind: 'load-error';
      errorType: string;
      message: string;
      line?: number | undefined;
      stdout?: string | undefined;
      stdoutDropped?: number | undefined;
    }
  /** The executor itself failed, or the job was cancelled. */
  | {
      kind: 'failed';
      error: { kind: 'harness' | 'runtime-missing' | 'cancelled'; message: string };
      /** Results for the tests that did run, if any. */
      cases?: HarnessCaseResult[] | undefined;
    };

/** The request a harness needs for `job`: inputs only, types parsed. */
export function toHarnessRequest(job: RunJob): HarnessRequest {
  return {
    language: job.language,
    code: job.code,
    function: job.signature.function,
    params: job.signature.params.map((p) => ({ name: p.name, type: parseType(p.type) })),
    returns: parseType(job.signature.returns),
    inputs: job.tests.map((t) => stringifyJson(t.input)),
    timeLimitMs: job.timeLimitMs,
    memoryLimitMb: job.memoryLimitMb,
  };
}

/**
 * Keep the end of `text` within `limit` characters, saying how much was
 * dropped (`alreadyDropped`: characters the harness discarded before `text`).
 */
export function clipTail(text: string, limit: number, alreadyDropped = 0): string {
  const dropped = alreadyDropped + Math.max(0, text.length - limit);
  if (dropped === 0) return text;
  return `[… ${dropped} earlier characters not shown]\n${text.slice(-limit)}`;
}

/** Keep the start of `text` within `limit` characters. */
export function clipHead(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)} […]`;
}
