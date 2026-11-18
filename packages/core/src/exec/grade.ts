/**
 * Turn what a harness reported into a `RunReport` (SPEC §6.1): compare each
 * returned value with the expected one, apply the time limit, clip stdout and
 * messages. Ported from `dsa-tutor/dsa_tutor/core/grading.py` (`grade`).
 *
 * The report still holds hidden tests' data; `redactReport` must run before it
 * leaves the main process.
 */
import { compareValues } from '../compare';
import { parseJson } from '../types/json';
import {
  clipHead,
  clipTail,
  MESSAGE_LIMIT,
  STDOUT_LIMIT,
  type HarnessCaseResult,
  type HarnessOutput,
} from './harness';
import type { RunJob, RunReport, TestResult } from './types';

export function gradeRun(job: RunJob, output: HarnessOutput, durationMs: number): RunReport {
  switch (output.kind) {
    case 'ran':
      return {
        ok: true,
        results: job.tests.map((_, i) => gradeCase(job, i, output.cases[i], 'not run')),
        durationMs,
      };
    case 'load-error': {
      const where = output.line ? ` (line ${output.line})` : '';
      const message = clipHead(`${output.errorType}${where}: ${output.message}`, MESSAGE_LIMIT);
      return {
        ok: false,
        error: { kind: 'compile', message },
        results: job.tests.map((_, i) => {
          const r = base(job, i, 'error');
          if (r.visibility === 'visible') {
            r.message = `the solution did not load: ${message}`;
            r.errorType = output.errorType;
            if (output.line) r.line = output.line;
            if (output.stdout)
              r.stdout = clipTail(output.stdout, STDOUT_LIMIT, output.stdoutDropped);
          }
          return r;
        }),
        durationMs,
      };
    }
    case 'failed': {
      const why = output.error.kind === 'cancelled' ? 'cancelled' : 'the executor failed';
      return {
        ok: false,
        error: { kind: output.error.kind, message: clipHead(output.error.message, MESSAGE_LIMIT) },
        results: job.tests.map((_, i) => gradeCase(job, i, output.cases?.[i], `not run: ${why}`)),
        durationMs,
      };
    }
  }
}

function base(job: RunJob, i: number, status: TestResult['status']): TestResult {
  const test = job.tests[i]!;
  const r: TestResult = { id: test.id, visibility: test.visibility, status };
  if (test.category !== undefined) r.category = test.category;
  if (test.visibility === 'visible') {
    r.input = test.input;
    r.expected = test.expected;
  }
  return r;
}

function gradeCase(
  job: RunJob,
  i: number,
  raw: HarnessCaseResult | undefined,
  notRun: string,
): TestResult {
  if (raw === undefined || raw.status === 'skipped') {
    const r = base(job, i, 'error');
    r.message = notRun;
    return r;
  }
  if (raw.status === 'timeout') {
    const r = base(job, i, 'timeout');
    r.message = `took longer than ${job.timeLimitMs} ms`;
    if (raw.stdout) r.stdout = clipTail(raw.stdout, STDOUT_LIMIT);
    return r;
  }
  if (raw.status === 'error') {
    const r = base(job, i, 'error');
    r.errorType = raw.errorType;
    r.message = clipHead(`${raw.errorType}: ${raw.message}`, MESSAGE_LIMIT);
    if (raw.line) r.line = raw.line;
    if (raw.timeMs !== undefined) r.timeMs = raw.timeMs;
    if (raw.stdout) r.stdout = clipTail(raw.stdout, STDOUT_LIMIT, raw.stdoutDropped);
    return r;
  }
  let actual: unknown;
  try {
    actual = parseJson(raw.actualJson);
  } catch {
    const r = base(job, i, 'error');
    r.errorType = 'HarnessError';
    r.message = 'the harness returned a value that is not valid JSON';
    return r;
  }
  const test = job.tests[i]!;
  const slow = raw.timeMs > job.timeLimitMs;
  const status = slow
    ? 'timeout'
    : compareValues(actual, test.expected, job.compare)
      ? 'pass'
      : 'fail';
  const r = base(job, i, status);
  r.timeMs = raw.timeMs;
  if (slow) r.message = `took ${Math.round(raw.timeMs)} ms; the limit is ${job.timeLimitMs} ms`;
  if (test.visibility === 'visible') r.actual = actual;
  if (raw.stdout) r.stdout = clipTail(raw.stdout, STDOUT_LIMIT, raw.stdoutDropped);
  return r;
}
