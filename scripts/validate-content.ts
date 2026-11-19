/**
 * `npm run validate:content` (SPEC §13): every curated problem validates and
 * its reference passes every test in Pyodide within its time limit.
 *
 * - `content/references/topics.md` parses; the five references exist and no
 *   longer point at `dsa-tutor`'s scripts.
 * - Each `content/problems/<topic>/<slug>/` loads through core's validator
 *   (schemas, signature/test cross-checks, known topic, folder = slug and
 *   topic).
 * - Each `reference.py` runs in Pyodide on Node worker threads, through the
 *   same pool, runtime and harness as the app's execution host (DECISIONS
 *   D-14), and must pass every test.
 * - `time_limit_ms` must be at least `timeLimitFromReference(slowest test)`
 *   (DECISIONS D-15).
 * - `content/open-sets/exercism/` (T12): the pinned index loads (known
 *   topics, difficulties and description files) and the licence is MIT.
 *
 *   npm run validate:content [-- <slug> ...]
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ExercismImporter,
  loadProblem,
  timeLimitFromReference,
  type Problem,
  type RunReport,
} from '../packages/core/src/index';
import { PyodidePool } from '../apps/desktop/src/exec-host/pool';
import { poolTransport } from '../apps/desktop/src/exec-host/pool-transport';
import { nodeWorkerFactory } from '../apps/desktop/src/exec-host/testing/node-factory';
import { PyodideExecutor } from '../apps/desktop/src/main/exec/pyodide-executor';
import { parseTopics } from './content/topics';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROBLEMS = join(ROOT, 'content', 'problems');
const REFERENCES = join(ROOT, 'content', 'references');
const REFERENCE_FILES = [
  'topics.md',
  'questionnaire.md',
  'hint_ladder.md',
  'review_rubric.md',
  'problem_spec.md',
];
/** The reference runs with this limit; the problem's own limit is checked against the measurement. */
const MEASURE_LIMIT_MS = 30_000;

const only = new Set(process.argv.slice(2).filter((a) => !a.startsWith('--')));
const errors: string[] = [];
const fail = (where: string, message: string): void => {
  errors.push(`${where}: ${message}`);
  console.log(`FAIL ${where}: ${message}`);
};

// ------------------------------------------------------------- references

const topicRows = parseTopics(await readFile(join(REFERENCES, 'topics.md'), 'utf8'));
const topics = new Set(topicRows.map((t) => t.id));
for (const file of REFERENCE_FILES) {
  const path = join(REFERENCES, file);
  if (!existsSync(path)) {
    fail(`references/${file}`, 'missing');
    continue;
  }
  const text = await readFile(path, 'utf8');
  for (const stale of ['scripts/', 'state.py', 'run_tests.py', 'workspace/'])
    if (text.includes(stale)) fail(`references/${file}`, `still mentions "${stale}"`);
}

// ---------------------------------------------------------------- problems

const reader = { readText: (p: string) => readFile(p, 'utf8').catch(() => null) };
const problems: Problem[] = [];
for (const topic of (await readdir(PROBLEMS)).sort()) {
  if (!topics.has(topic)) fail(`problems/${topic}`, 'folder is not a topic id from topics.md');
  for (const slug of (await readdir(join(PROBLEMS, topic))).sort()) {
    if (only.size && !only.has(slug)) continue;
    const where = `${topic}/${slug}`;
    const dir = join(PROBLEMS, topic, slug).replaceAll('\\', '/');
    const loaded = await loadProblem(reader, dir, { topics });
    if (!loaded.ok) {
      for (const e of loaded.errors) fail(where, e);
      continue;
    }
    if (loaded.problem.meta.topic !== topic)
      fail(where, `meta.json topic "${loaded.problem.meta.topic}" is not the folder "${topic}"`);
    if (loaded.problem.meta.source !== 'curated') fail(where, 'source must be "curated"');
    problems.push(loaded.problem);
  }
}
if (!only.size) {
  const covered = new Set(problems.map((p) => p.meta.topic));
  for (const t of topics) if (!covered.has(t)) fail(`topic ${t}`, 'has no curated problem');
}

// ---------------------------------------------------------------- open sets

try {
  const dir = join(ROOT, 'content', 'open-sets', 'exercism');
  const license = await readFile(join(dir, 'LICENSE.txt'), 'utf8');
  if (!license.startsWith('The MIT License')) fail('open-sets/exercism', 'LICENSE.txt is not MIT');
  const index = JSON.parse(
    await readFile(join(dir, 'index.json'), 'utf8'),
  ) as ConstructorParameters<typeof ExercismImporter>[0];
  const importer = new ExercismImporter(
    index,
    license,
    () => Promise.reject(new Error('offline')),
    topics,
  );
  if (!importer.list().length) fail('open-sets/exercism', 'index.json lists no entries');
} catch (e) {
  fail('open-sets/exercism', e instanceof Error ? e.message : String(e));
}

// ----------------------------------------------------- references in Pyodide

const pool = new PyodidePool(nodeWorkerFactory, { spares: 1 });
const executor = new PyodideExecutor(poolTransport(pool));
const started = performance.now();
try {
  const status = await executor.status();
  if (!status.available) throw new Error(`Pyodide unavailable: ${JSON.stringify(status)}`);
  for (const p of problems) {
    const where = `${p.meta.topic}/${p.meta.slug}`;
    const report: RunReport = await executor.run({
      language: 'python',
      code: p.reference,
      signature: p.meta.signature,
      compare: p.meta.compare,
      tests: p.tests,
      timeLimitMs: MEASURE_LIMIT_MS,
      memoryLimitMb: 512,
    });
    if (!report.ok) {
      fail(where, `reference did not run: ${report.error?.kind}: ${report.error?.message}`);
      continue;
    }
    const bad = report.results.filter((r) => r.status !== 'pass');
    for (const r of bad)
      fail(where, `reference ${r.status} on ${r.id}${r.message ? `: ${r.message}` : ''}`);
    const slowest = Math.max(0, ...report.results.map((r) => r.timeMs ?? 0));
    const needed = timeLimitFromReference(slowest);
    if (p.meta.time_limit_ms < needed)
      fail(
        where,
        `time_limit_ms ${p.meta.time_limit_ms} is below ${needed} (slowest test ${slowest.toFixed(1)} ms)`,
      );
    if (!bad.length)
      console.log(
        `ok   ${where} (${p.tests.length} tests, slowest ${slowest.toFixed(1)} ms, limit ${p.meta.time_limit_ms} ms)`,
      );
  }
} catch (e) {
  fail('pyodide', e instanceof Error ? e.message : String(e));
} finally {
  pool.dispose();
}

const seconds = ((performance.now() - started) / 1000).toFixed(1);
console.log(
  `\n${problems.length} problems checked in ${seconds} s; ${errors.length ? `${errors.length} error(s)` : 'all valid'}`,
);
process.exit(errors.length ? 1 : 0);
