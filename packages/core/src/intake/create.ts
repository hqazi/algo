/**
 * Create a problem from a spec (SPEC §5.1, §6.3). Ported from
 * `dsa-tutor/dsa_tutor/core/problems.py` (`create`), with the format v2
 * rules (neutral types, `languages`, `time_limit_ms`).
 *
 * 1. Check the spec's shape (the rules of `content/references/problem_spec.md`).
 * 2. Fill missing expected values by running `brute_force`.
 * 3. Self-check: `reference_solution` must pass every test within the time
 *    limit (tests marked `expected_by: "reference"` take its answer).
 * 4. Build the folder's files and load them with the same loader the
 *    catalog uses, so a problem that is saved always loads.
 * 5. Write it (`problems/generated/<slug>/` or `problems/imported/<slug>/`).
 *
 * Model-written code (references, brute forces) runs **only** in the Pyodide
 * executor (SPEC §6.3): `executors('pyodide')` is the only executor asked
 * for, and one that is not Pyodide is refused. Nothing is written unless
 * every step passes; on failure the output says what to fix. Failures carry
 * the test data: they go to the model that wrote it, never to the UI
 * (`publicFailure` in `jobs.ts` is what the UI sees).
 */
import {
  compareSpecSchema,
  MIN_HIDDEN_TESTS,
  MIN_VISIBLE_TESTS,
  SLUG_RE,
} from '../problems/schema';
import type { ProblemOrigin, TestCase } from '../problems/schema';
import { DIFFICULTIES, SCHEMA_VERSION } from '../problems/schema';
import { loadProblem } from '../problems/loader';
import { languageSupports, languagesWithHarness } from '../problems/validate';
import { clipHead } from '../exec/harness';
import { timeLimitFromReference, MIN_TIME_LIMIT_MS } from '../exec/time-limit';
import type { Executor, ExecutorId, RunReport, TestResult } from '../exec/types';
import type { CompareSpec } from '../compare';
import type { Topic } from '../teaching/topics';
import type { ToolOutput } from '../tools/registry';
import { parseType } from '../types/neutral';
import { stringifyJson } from '../types/json';
import { signatureSchema, type Signature } from '../types/signature';
import { checkValue } from '../types/values';
import { renderStatement } from './render';

/** Per test, for the brute force (it may be slow; it only fills expected values). */
export const BRUTE_TIME_LIMIT_MS = 10_000;
/** Per test, for the reference in the self-check (SPEC §6.2: the problem's base limit). */
export const SELF_CHECK_TIME_LIMIT_MS = MIN_TIME_LIMIT_MS;
export const MAX_VISIBLE_INPUT_CHARS = 1500;
export const MAX_TESTS_CHARS = 400_000;
export const MAX_ORIGIN_TEXT_CHARS = 100_000;
export const MAX_TITLE_CHARS = 120;
const MEMORY_LIMIT_MB = 512;
const CLIP = 300;

const REQUIRED = [
  'slug',
  'title',
  'topic',
  'difficulty',
  'statement',
  'signature',
  'expected_complexity',
  'tests',
  'reference_solution',
] as const;
const OPTIONAL = ['constraints', 'notes', 'compare', 'brute_force'] as const;
/** Set by the app, never by the spec (`create_problem` drops them before this runs). */
export const APP_ONLY_KEYS = ['source', 'origin', 'origin_text'] as const;
const TEST_KEYS = new Set([
  'id',
  'visibility',
  'category',
  'input',
  'expected',
  'explanation',
  'expected_by',
]);

export type ProblemKind = 'generated' | 'imported';

/** Writes a new problem folder atomically. */
export interface ProblemWriter {
  write(kind: ProblemKind, slug: string, files: Record<string, string>): Promise<void>;
}

export interface CreateDeps {
  topics: () => readonly Topic[];
  /** True if a problem (any source) already uses the slug. */
  taken: (slug: string) => boolean;
  /** Only `'pyodide'` is ever asked for. */
  executors: (id: ExecutorId) => Executor | null;
  writer: ProblemWriter;
  now: () => string;
  /** After a problem is written (e.g. reload the catalog). */
  created?: (slug: string) => Promise<void>;
}

export interface CreateOptions {
  /** Pasted or imported problems only (SPEC §5.1). */
  origin?: ProblemOrigin;
  /** A pasted problem's original text, kept beside it as `origin.md`. */
  originText?: string;
  /** An imported problem's licence and attribution, kept beside it as `NOTICE.md`. */
  notice?: string;
}

interface SpecTest {
  id?: string;
  visibility: 'visible' | 'hidden';
  category?: string;
  input: Record<string, unknown>;
  expected?: unknown;
  explanation?: string;
  expected_by?: 'reference';
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
/** A copy of plain JSON data (bigints kept; no `structuredClone` in core's ES lib). */
function copy<T>(v: T): T {
  if (Array.isArray(v)) return v.map(copy) as T;
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copy(x)])) as T;
  return v;
}
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

function invalid(problems: string[]): ToolOutput {
  return { ok: false, error: 'invalid spec', problems: problems.slice(0, 40) };
}

/** The spec's shape. Empty when it can be run. */
export function specProblems(
  spec: Record<string, unknown>,
  topics: ReadonlySet<string>,
  options: CreateOptions = {},
): string[] {
  const errors: string[] = [];
  for (const key of REQUIRED) if (!(key in spec)) errors.push(`missing field "${key}"`);
  const known = new Set<string>([...REQUIRED, ...OPTIONAL]);
  for (const key of Object.keys(spec)) if (!known.has(key)) errors.push(`unknown field "${key}"`);
  if (errors.length) return errors;

  if (typeof spec.slug !== 'string' || !SLUG_RE.test(spec.slug) || spec.slug.length > 80)
    errors.push('slug must be lowercase words joined by hyphens (at most 80 characters)');
  if (!nonEmpty(spec.title) || spec.title.length > MAX_TITLE_CHARS)
    errors.push(`title must be text of at most ${MAX_TITLE_CHARS} characters`);
  if (typeof spec.topic !== 'string' || !topics.has(spec.topic))
    errors.push(`unknown topic ${JSON.stringify(spec.topic)}; use an id from the topics guide`);
  if (!(DIFFICULTIES as readonly unknown[]).includes(spec.difficulty))
    errors.push(`difficulty must be one of ${DIFFICULTIES.join(', ')}`);
  if (!nonEmpty(spec.statement)) errors.push('statement is empty');
  if (
    spec.constraints !== undefined &&
    !(Array.isArray(spec.constraints) && spec.constraints.every((c) => typeof c === 'string'))
  )
    errors.push('constraints must be a list of strings');
  if (spec.notes !== undefined && typeof spec.notes !== 'string') errors.push('notes must be text');
  if (!nonEmpty(spec.reference_solution)) errors.push('reference_solution is empty');
  if (spec.brute_force !== undefined && typeof spec.brute_force !== 'string')
    errors.push('brute_force must be Python source text');
  const ec = spec.expected_complexity;
  if (!isObj(ec) || !nonEmpty(ec.time) || !nonEmpty(ec.space) || Object.keys(ec).length !== 2)
    errors.push(
      'expected_complexity needs exactly time and space, e.g. {"time": "O(n)", "space": "O(1)"}',
    );
  if (spec.compare !== undefined) {
    const c = compareSpecSchema.safeParse(spec.compare);
    if (!c.success)
      errors.push(
        'compare must be {"mode": "exact" | "unordered" | "unordered_deep"} or {"mode": "float", "tolerance"?: number}',
      );
  }
  if (options.originText !== undefined) {
    if (options.origin?.kind !== 'paste') errors.push('origin text is only for pasted problems');
    else if (!options.originText.trim()) errors.push('origin text must not be empty');
    else if (options.originText.length > MAX_ORIGIN_TEXT_CHARS)
      errors.push(`origin text is longer than ${MAX_ORIGIN_TEXT_CHARS} characters`);
  }

  const sig = signatureSchema.safeParse(spec.signature);
  if (!sig.success) {
    for (const issue of sig.error.issues.slice(0, 10))
      errors.push(`signature${issue.path.map((p) => `.${String(p)}`).join('')}: ${issue.message}`);
    return errors;
  }
  const signature = sig.data;
  if (!languagesWithHarness().some((l) => languageSupports(l, signature)))
    errors.push('no language can run this signature');
  errors.push(...testProblems(spec.tests, signature));
  return errors;
}

function testProblems(tests: unknown, sig: Signature): string[] {
  const errors: string[] = [];
  if (!Array.isArray(tests) || tests.length === 0) return ['tests must be a non-empty list'];
  const names = sig.params.map((p) => p.name);
  const types = new Map(sig.params.map((p) => [p.name, parseType(p.type)]));
  const counts = { visible: 0, hidden: 0 };
  let size = 0;
  tests.forEach((t: unknown, i) => {
    const where = `tests[${i}]`;
    if (!isObj(t)) {
      errors.push(`${where}: must be an object`);
      return;
    }
    for (const key of Object.keys(t))
      if (!TEST_KEYS.has(key)) errors.push(`${where}: unknown field "${key}"`);
    const vis = t.visibility;
    if (vis !== 'visible' && vis !== 'hidden') {
      errors.push(`${where}: visibility must be "visible" or "hidden"`);
      return;
    }
    counts[vis] += 1;
    if (t.id !== undefined && (typeof t.id !== 'string' || !SLUG_RE.test(t.id)))
      errors.push(`${where}: id must be lowercase words joined by hyphens, or left out`);
    const input = t.input;
    if (!isObj(input) || Object.keys(input).sort().join(',') !== [...names].sort().join(',')) {
      errors.push(
        `${where}: input must be an object with exactly the keys ${names.join(', ') || '(none)'}`,
      );
    } else {
      for (const name of names)
        for (const e of checkValue(input[name], types.get(name)!, `input.${name}`))
          errors.push(`${where}: ${e}`);
    }
    if (vis === 'hidden' && !nonEmpty(t.category))
      errors.push(`${where}: hidden tests need a category such as "empty input"`);
    if (t.explanation !== undefined && typeof t.explanation !== 'string')
      errors.push(`${where}: explanation must be text`);
    const by = t.expected_by;
    if (by !== undefined && by !== 'reference')
      errors.push(`${where}: expected_by can only be "reference"`);
    // A missing expected value without a brute force is reported by `createProblem`.
    if (!('expected' in t)) {
      if (by === 'reference' && vis === 'visible')
        errors.push(`${where}: visible tests need an explicit or brute-force expected value`);
    } else if (by === 'reference') {
      errors.push(`${where}: give expected or expected_by, not both`);
    }
    if (vis === 'visible' && stringifyJson(input ?? null).length > MAX_VISIBLE_INPUT_CHARS)
      errors.push(`${where}: visible inputs must stay small (they are shown as examples)`);
    size += stringifyJson(t).length;
  });
  if (counts.visible < MIN_VISIBLE_TESTS)
    errors.push(`need at least ${MIN_VISIBLE_TESTS} visible tests`);
  if (counts.hidden < MIN_HIDDEN_TESTS)
    errors.push(`need at least ${MIN_HIDDEN_TESTS} hidden tests`);
  if (size > MAX_TESTS_CHARS)
    errors.push(
      `the tests are larger than ${MAX_TESTS_CHARS / 1000} KB; make the large inputs smaller`,
    );
  return errors;
}

/** Gives every test without an id `example-N` (visible) or `hidden-N`. */
export function assignIds(tests: SpecTest[]): void {
  const counters = { visible: 0, hidden: 0 };
  const used = new Set(tests.filter((t) => t.id).map((t) => t.id));
  for (const t of tests) {
    if (t.id) continue;
    const prefix = t.visibility === 'visible' ? 'example' : 'hidden';
    let candidate: string;
    do {
      counters[t.visibility] += 1;
      candidate = `${prefix}-${counters[t.visibility]}`;
    } while (used.has(candidate));
    t.id = candidate;
    used.add(candidate);
  }
}

function clip(value: unknown): unknown {
  let text: string;
  try {
    text = stringifyJson(value);
  } catch {
    return String(value);
  }
  return text.length <= CLIP ? value : `${text.slice(0, CLIP)}...(truncated)`;
}

/** One failing test as the model sees it (test data included: the model wrote it). */
function failure(test: SpecTest, r: TestResult, expected?: unknown): Record<string, unknown> {
  const status = r.status === 'pass' || r.status === 'fail' ? 'wrong_answer' : r.status;
  const item: Record<string, unknown> = {
    id: test.id,
    category: test.category ?? '',
    status,
    input: clip(test.input),
  };
  if (expected !== undefined) item.expected = clip(expected);
  if (r.status === 'pass' || r.status === 'fail') item.actual = clip(r.actual);
  if (r.errorType) item.error_type = r.errorType;
  if (r.message) item.message = clipHead(r.message, CLIP);
  if (r.line !== undefined) item.line = r.line;
  if (r.timeMs !== undefined) item.time_ms = Math.round(r.timeMs);
  return item;
}

/** Ran: the harness returned a value (graded pass or fail against a placeholder). */
const ran = (r: TestResult | undefined): r is TestResult =>
  r !== undefined && (r.status === 'pass' || r.status === 'fail');

function runFailure(report: RunReport, what: string): ToolOutput | null {
  if (report.ok || !report.error || report.error.kind === 'compile') return null;
  return {
    ok: false,
    error: `the self-check could not run the ${what} (${report.error.kind}): ${report.error.message}`,
  };
}

/** The Pyodide executor, or why there is none. Model-written code runs nowhere else. */
function pyodide(deps: CreateDeps): Executor | null {
  const executor = deps.executors('pyodide');
  return executor && executor.id === 'pyodide' ? executor : null;
}

/** Validate, self-check and save a problem spec. Resolves to the `create_problem` output. */
export async function createProblem(
  deps: CreateDeps,
  rawSpec: unknown,
  options: CreateOptions = {},
): Promise<ToolOutput> {
  if (!isObj(rawSpec)) return invalid(['spec must be a JSON object']);
  const spec: Record<string, unknown> = copy(rawSpec);
  for (const key of APP_ONLY_KEYS) delete spec[key];
  const topics = deps.topics();
  const errors = specProblems(spec, new Set(topics.map((t) => t.id)), options);
  if (errors.length) return invalid(errors);

  const slug = spec.slug as string;
  if (deps.taken(slug))
    return { ok: false, error: `slug "${slug}" already exists; choose another slug` };
  const signature = signatureSchema.parse(spec.signature);
  const compare = (spec.compare ?? { mode: 'exact' }) as CompareSpec;
  const tests = copy(spec.tests) as SpecTest[];
  assignIds(tests);
  const brute = typeof spec.brute_force === 'string' ? spec.brute_force.trimEnd() : '';
  const needBrute = tests.filter((t) => !('expected' in t) && t.expected_by !== 'reference');
  if (needBrute.length && !brute)
    return invalid(
      needBrute.map((t) => `${t.id}: no expected value and no brute_force to compute it`),
    );
  if (tests.some((t) => t.expected_by === 'reference') && !brute)
    return invalid(['expected_by "reference" needs a brute_force solution in the spec']);

  const executor = pyodide(deps);
  if (!executor)
    return { ok: false, error: 'the Python sandbox (Pyodide) is not available; try again later' };
  const job = (code: string, list: SpecTest[], timeLimitMs: number) =>
    executor.run({
      language: 'python',
      code: `${code}\n`,
      signature,
      compare,
      // Every test runs as visible so the report keeps each actual value:
      // this report never leaves the self-check.
      tests: list.map((t) => ({
        id: t.id!,
        visibility: 'visible' as const,
        input: t.input,
        expected: 'expected' in t ? t.expected : null,
      })),
      timeLimitMs,
      memoryLimitMb: MEMORY_LIMIT_MB,
    });

  // 1. Expected values from the brute force.
  if (needBrute.length) {
    const report = await job(brute, needBrute, BRUTE_TIME_LIMIT_MS);
    const broken = runFailure(report, 'brute force');
    if (broken) return broken;
    const bad = needBrute
      .map((t, i) => [t, report.results[i]] as const)
      .filter(([, r]) => !ran(r))
      .map(([t, r]) => failure(t, r ?? { id: t.id!, visibility: 'visible', status: 'error' }));
    if (bad.length) return { ok: false, error: 'brute_force failed on some tests', failures: bad };
    needBrute.forEach((t, i) => (t.expected = report.results[i]!.actual));
  }

  // 2. The self-check: the reference passes everything within the time limit.
  const report = await job(
    (spec.reference_solution as string).trimEnd(),
    tests,
    SELF_CHECK_TIME_LIMIT_MS,
  );
  const broken = runFailure(report, 'reference solution');
  if (broken) return broken;
  const failures: Record<string, unknown>[] = [];
  let slowest = 0;
  tests.forEach((t, i) => {
    const r = report.results[i] ?? { id: t.id!, visibility: 'visible', status: 'error' };
    slowest = Math.max(slowest, r.timeMs ?? 0);
    if (t.expected_by === 'reference') {
      if (ran(r)) t.expected = r.actual;
      else failures.push(failure(t, r));
    } else if (r.status !== 'pass') {
      failures.push(failure(t, r, t.expected));
    }
  });
  if (failures.length)
    return {
      ok: false,
      error:
        'self-check failed: the reference solution does not pass every test; fix the reference ' +
        'or the expected values and call create_problem again',
      failures: failures.slice(0, 30),
      ...(failures.length > 30 ? { more_failures: failures.length - 30 } : {}),
    };

  // 3. The folder, loaded back with the catalog's own loader.
  const files = buildFiles(spec, signature, compare, tests, {
    topicName: topics.find((t) => t.id === spec.topic)?.name ?? String(spec.topic),
    timeLimitMs: timeLimitFromReference(slowest),
    createdAt: deps.now(),
    options,
  });
  const loaded = await loadProblem(
    { readText: (p) => Promise.resolve(files[p.slice(p.lastIndexOf('/') + 1)] ?? null) },
    `new/${slug}`,
    { topics: new Set(topics.map((t) => t.id)) },
  );
  if (!loaded.ok) return invalid(loaded.errors);

  // 4. Save.
  if (deps.taken(slug))
    return { ok: false, error: `slug "${slug}" already exists; choose another slug` };
  const kind: ProblemKind = options.origin ? 'imported' : 'generated';
  await deps.writer.write(kind, slug, files);
  await deps.created?.(slug);
  const shown = loaded.problem.tests;
  const out: ToolOutput = {
    ok: true,
    slug,
    title: loaded.problem.meta.title,
    tests: {
      visible: shown.filter((t) => t.visibility === 'visible').length,
      hidden: shown.filter((t) => t.visibility === 'hidden').length,
    },
    self_check: 'passed',
  };
  if (options.origin) out.source = loaded.problem.meta.source;
  return out;
}

function buildFiles(
  spec: Record<string, unknown>,
  signature: Signature,
  compare: CompareSpec,
  tests: SpecTest[],
  extra: { topicName: string; timeLimitMs: number; createdAt: string; options: CreateOptions },
): Record<string, string> {
  const { options } = extra;
  const source = options.origin
    ? options.origin.kind === 'paste'
      ? 'pasted'
      : 'imported'
    : 'generated';
  const meta: Record<string, unknown> = {
    schema_version: SCHEMA_VERSION,
    slug: spec.slug,
    title: (spec.title as string).trim(),
    topic: spec.topic,
    difficulty: spec.difficulty,
    source,
    ...(options.origin ? { origin: options.origin } : {}),
    content_version: 1,
    created_at: extra.createdAt,
    expected_complexity: spec.expected_complexity,
    compare,
    time_limit_ms: extra.timeLimitMs,
    signature,
    languages: languagesWithHarness().filter((l) => languageSupports(l, signature)),
  };
  const clean: TestCase[] = tests.map((t) => {
    const item: TestCase = {
      id: t.id!,
      visibility: t.visibility,
      category: t.category?.trim() || (t.visibility === 'visible' ? 'example' : ''),
      input: t.input,
      expected: t.expected,
    };
    if (t.explanation?.trim()) item.explanation = t.explanation.trim();
    return item;
  });
  const files: Record<string, string> = {
    'meta.json': `${stringifyJson(meta, 2)}\n`,
    'tests.json': `${stringifyJson({ schema_version: SCHEMA_VERSION, tests: clean })}\n`,
    'problem.md': renderStatement({
      title: spec.title as string,
      topicName: extra.topicName,
      difficulty: spec.difficulty as string,
      statement: spec.statement as string,
      constraints: (spec.constraints as string[] | undefined) ?? [],
      notes: spec.notes as string | undefined,
      signature,
      compare,
      tests: clean,
    }),
    'reference.py': `${(spec.reference_solution as string).trimEnd()}\n`,
  };
  if (typeof spec.brute_force === 'string' && spec.brute_force.trim())
    files['brute_force.py'] = `${spec.brute_force.trimEnd()}\n`;
  if (options.originText) files['origin.md'] = `${options.originText.trimEnd()}\n`;
  if (options.notice) files['NOTICE.md'] = `${options.notice.trimEnd()}\n`;
  return files;
}
