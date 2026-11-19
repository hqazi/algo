/**
 * Running a learner's solution against a problem's tests (SPEC §6.1), shared
 * by the `run_tests` and `record_attempt` tools and the app's Run and Submit
 * buttons (T08). The executor reports raw values; core grades; the report
 * is redacted before anything outside the main process sees it.
 */
import type { CompareSpec } from '../compare';
import { effectiveTimeLimitMs } from '../exec/time-limit';
import { redactReport } from '../exec/redact';
import type { Executor, RunReport, TestResult } from '../exec/types';
import type { Problem } from '../problems/loader';
import type { Language } from '../types/signature';
import { TutorError } from '../teaching/errors';

export const ONLY = ['visible', 'hidden'] as const;
export type Only = (typeof ONLY)[number];

/** Advisory (DECISIONS D-14, D-15). */
export const MEMORY_LIMIT_MB = 512;

export interface RunOptions {
  executorFor: (language: Language) => Executor | null;
  /** `execution.timeScale` (SPEC §4.3); 1 when omitted. */
  timeScale?: (() => number) | undefined;
}

/** Runs `code` and returns the report, **unredacted** (main process only). */
export async function runProblemTests(
  options: RunOptions,
  problem: Problem,
  code: string,
  language: Language,
  only?: Only,
): Promise<RunReport> {
  const executor = options.executorFor(language);
  if (!executor)
    throw new TutorError(`there is no way to run ${language} code here`, 'runtime_missing');
  const tests = only ? problem.tests.filter((t) => t.visibility === only) : problem.tests;
  return executor.run({
    language,
    slug: problem.meta.slug,
    code,
    signature: problem.meta.signature,
    compare: problem.meta.compare as CompareSpec,
    tests,
    timeLimitMs: effectiveTimeLimitMs(problem.meta.time_limit_ms, options.timeScale?.() ?? 1),
    memoryLimitMb: MEMORY_LIMIT_MB,
  });
}

/** The redacted report as tools return it. */
export interface RunView {
  passed: number;
  total: number;
  all_passed: boolean;
  /** Hidden cases: id, visibility, category, status and time only. */
  cases: TestResult[];
  /** Set when the solution did not load or the executor failed. */
  run_error?: { kind: string; message: string };
  duration_ms: number;
}

export function runView(report: RunReport): RunView {
  const redacted = redactReport(report);
  const passed = redacted.results.filter((r) => r.status === 'pass').length;
  const total = redacted.results.length;
  const out: RunView = {
    passed,
    total,
    all_passed: redacted.ok && total > 0 && passed === total,
    cases: redacted.results,
    duration_ms: Math.round(redacted.durationMs),
  };
  if (redacted.error) out.run_error = { ...redacted.error };
  return out;
}

/** The short form `record_attempt` returns: counts and the failing cases' ids and categories. */
export function compactView(view: RunView): {
  passed: number;
  total: number;
  all_passed: boolean;
  failing: { id: string; visibility: string; category: string; status: string }[];
} {
  return {
    passed: view.passed,
    total: view.total,
    all_passed: view.all_passed,
    failing: view.cases
      .filter((c) => c.status !== 'pass')
      .map((c) => ({
        id: c.id,
        visibility: c.visibility,
        category: c.category ?? '',
        status: c.status,
      })),
  };
}
