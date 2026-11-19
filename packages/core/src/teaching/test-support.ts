/**
 * Test helpers (Vitest only: uses Vite's `import.meta.glob`; not exported
 * from the package). The real curated content in an in-memory catalog, and a
 * scripted executor that grades through core's own `gradeRun`, so redaction
 * and comparison are the real code paths.
 */
import { gradeRun } from '../exec/grade';
import type { HarnessCaseResult, HarnessOutput } from '../exec/harness';
import type { Executor, RunJob, RunReport } from '../exec/types';
import { loadProblem, type Problem } from '../problems/loader';
import { stringifyJson } from '../types/json';
import { memoryCatalog } from './catalog';
import { parseTopics, type Topic } from './topics';

const files = import.meta.glob<string>(
  ['../../../../content/problems/*/*/*', '../../../../content/references/topics.md'],
  { query: '?raw', import: 'default', eager: true },
);
const ROOT = '../../../../content/';

export const TOPICS: Topic[] = parseTopics(files[`${ROOT}references/topics.md`]!);

let curated: Problem[] | undefined;

/** Every curated problem in `content/problems/`, validated. */
export async function curatedProblems(): Promise<Problem[]> {
  if (curated) return curated;
  const dirs = new Set(
    Object.keys(files)
      .filter((k) => k.startsWith(`${ROOT}problems/`))
      .map((k) => k.slice(0, k.lastIndexOf('/'))),
  );
  const reader = { readText: (p: string) => Promise.resolve(files[p] ?? null) };
  const out: Problem[] = [];
  for (const dir of [...dirs].sort()) {
    const r = await loadProblem(reader, dir, { topics: new Set(TOPICS.map((t) => t.id)) });
    if (!r.ok) throw new Error(`${dir}: ${r.errors.join('; ')}`);
    out.push(r.problem);
  }
  curated = out;
  return out;
}

export async function curatedCatalog(): Promise<ReturnType<typeof memoryCatalog>> {
  return memoryCatalog(TOPICS, await curatedProblems());
}

/**
 * Pretends to run Python. Behaviour is chosen by the code:
 * - a known reference solution returns every expected value (passes);
 * - `# ECHO`: returns its inputs and prints them (fails, leaks into stdout);
 * - `# RAISE`: raises `ValueError` with its inputs in the message;
 * - `# SYNTAX`: does not load;
 * - `# SLOW`: waits for `release()` before answering (busy tests);
 * - anything else raises `NotImplementedError` (the starter code).
 */
export class ScriptedExecutor implements Executor {
  readonly id = 'pyodide' as const;
  readonly jobs: RunJob[] = [];
  private references = new Set<string>();
  private waiting: (() => void)[] = [];

  constructor(problems: readonly Problem[]) {
    for (const p of problems) this.references.add(p.reference);
  }

  status(): Promise<{ available: true }> {
    return Promise.resolve({ available: true });
  }

  /** Lets every `# SLOW` run finish. */
  release(): void {
    for (const w of this.waiting.splice(0)) w();
  }

  async run(job: RunJob): Promise<RunReport> {
    this.jobs.push(job);
    if (job.code.includes('# SLOW')) await new Promise<void>((r) => this.waiting.push(r));
    let output: HarnessOutput;
    if (job.code.includes('# SYNTAX')) {
      output = {
        kind: 'load-error',
        errorType: 'SyntaxError',
        message: "'(' was never closed",
        line: 2,
      };
    } else {
      const cases = job.tests.map((t): HarnessCaseResult => {
        const input = stringifyJson(t.input);
        if (this.references.has(job.code))
          return { status: 'ok', actualJson: stringifyJson(t.expected), timeMs: 1, stdout: '' };
        if (job.code.includes('# ECHO'))
          return { status: 'ok', actualJson: `[${input}]`, timeMs: 1, stdout: `${input}\n` };
        if (job.code.includes('# RAISE'))
          return { status: 'error', errorType: 'ValueError', message: input, line: 2, stdout: '' };
        return {
          status: 'error',
          errorType: 'NotImplementedError',
          message: '',
          line: 3,
          stdout: '',
        };
      });
      output = { kind: 'ran', cases };
    }
    return gradeRun(job, output, 5);
  }
}

/** A clock that ticks one second per call. */
export function tickingClock(start = Date.UTC(2026, 10, 19, 9, 0, 0)): () => string {
  let t = start;
  return () => {
    const s = new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
    t += 1000;
    return s;
  };
}
