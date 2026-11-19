/**
 * Test helpers for intake (Vitest only; not exported from the package): an
 * executor that "runs" the fixture specs' Python with JavaScript stand-ins,
 * grading through core's own `gradeRun`, and a problem writer in memory.
 */
import { gradeRun } from '../exec/grade';
import type { HarnessCaseResult } from '../exec/harness';
import type { Executor, ExecutorId, RunJob, RunReport } from '../exec/types';
import { stringifyJson } from '../types/json';
import type { ProblemKind, ProblemWriter } from './create';
import specs from './fixtures/specs.json';

export const GOOD = specs.good as Record<string, unknown>;
export const IMPORT_SPEC = specs.import as Record<string, unknown>;
export const BAD_REFERENCE = specs.bad_reference;
export const HIDDEN_NEEDLES = specs.hidden_needles;

type Fn = (input: Record<string, unknown>) => unknown;

const countEven: Fn = (i) => (i.readings as number[]).filter((r) => r % 2 === 0).length;
const find: Fn = (i) => (i.array as number[]).indexOf(i.value as number);

/** Python source (trimmed) -> what it computes. Anything else raises NameError. */
export const PROGRAMS = new Map<string, Fn>([
  [(GOOD.reference_solution as string).trim(), countEven],
  [(GOOD.brute_force as string).trim(), countEven],
  [BAD_REFERENCE.trim(), (i) => (i.readings as number[]).length],
  [(IMPORT_SPEC.reference_solution as string).trim(), find],
  [(IMPORT_SPEC.brute_force as string).trim(), find],
]);

export class FunctionExecutor implements Executor {
  readonly jobs: RunJob[] = [];

  constructor(readonly id: ExecutorId = 'pyodide') {}

  status(): Promise<{ available: true }> {
    return Promise.resolve({ available: true });
  }

  run(job: RunJob): Promise<RunReport> {
    this.jobs.push(job);
    const fn = PROGRAMS.get(job.code.trim());
    const cases = job.tests.map((t): HarnessCaseResult => {
      if (!fn)
        return { status: 'error', errorType: 'NameError', message: 'not defined', stdout: '' };
      return { status: 'ok', actualJson: stringifyJson(fn(t.input)), timeMs: 3, stdout: '' };
    });
    return Promise.resolve(gradeRun(job, { kind: 'ran', cases }, 5));
  }
}

export class MemoryWriter implements ProblemWriter {
  readonly written = new Map<string, { kind: ProblemKind; files: Record<string, string> }>();

  write(kind: ProblemKind, slug: string, files: Record<string, string>): Promise<void> {
    this.written.set(slug, { kind, files: { ...files } });
    return Promise.resolve();
  }
}

export function copyOf<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
