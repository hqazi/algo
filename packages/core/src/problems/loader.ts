/**
 * Load and validate a problem folder (SPEC §5.1) through an injected file
 * reader, so core stays free of Node and Electron.
 *
 *   <problem>/problem.md, meta.json, tests.json, reference.py, brute_force.py?
 */
import type { z } from 'zod';
import { parseJson } from '../types/json';
import {
  SCHEMA_VERSION,
  metaSchema,
  testsFileSchema,
  type ProblemMeta,
  type TestCase,
} from './schema';
import { crossCheckProblem } from './validate';

/** Reads a UTF-8 file by path; `null` when it does not exist. Paths use `/`. */
export interface ProblemFileReader {
  readText(path: string): Promise<string | null>;
}

export interface Problem {
  /** The folder it was loaded from, as given. */
  dir: string;
  meta: ProblemMeta;
  tests: TestCase[];
  /** `problem.md`. */
  statement: string;
  /** `reference.py`. Main process only, like hidden tests. */
  reference: string;
  /** `brute_force.py`, if present. */
  bruteForce?: string;
}

export type LoadResult = { ok: true; problem: Problem } | { ok: false; errors: string[] };

export interface LoadOptions {
  /** Known topic ids (from `content/references/topics.md`); unchecked when omitted. */
  topics?: ReadonlySet<string>;
}

/** Load `dir` and return the validated problem, or every error found. */
export async function loadProblem(
  reader: ProblemFileReader,
  dir: string,
  options: LoadOptions = {},
): Promise<LoadResult> {
  const base = dir.replace(/\/+$/, '');
  const read = (name: string): Promise<string | null> => reader.readText(`${base}/${name}`);
  const [metaText, testsText, statement, reference, bruteForce] = await Promise.all(
    ['meta.json', 'tests.json', 'problem.md', 'reference.py', 'brute_force.py'].map(read),
  );

  const errors: string[] = [];
  const meta = parseFile('meta.json', metaText, metaSchema, errors);
  const testsFile = parseFile('tests.json', testsText, testsFileSchema, errors);
  if (statement === null || statement === undefined) errors.push('problem.md: missing');
  else if (!statement.trim()) errors.push('problem.md: empty');
  if (reference === null || reference === undefined) errors.push('reference.py: missing');
  else if (!reference.trim()) errors.push('reference.py: empty');

  if (meta) {
    const folder = base.slice(base.lastIndexOf('/') + 1);
    if (folder !== meta.slug)
      errors.push(`meta.json: slug: "${meta.slug}" does not match the folder name "${folder}"`);
    if (options.topics && !options.topics.has(meta.topic)) {
      errors.push(`meta.json: topic: unknown topic "${meta.topic}"`);
    }
  }
  if (meta && testsFile) errors.push(...crossCheckProblem(meta, testsFile.tests));

  if (errors.length || !meta || !testsFile || !statement || !reference)
    return { ok: false, errors };
  const problem: Problem = { dir, meta, tests: testsFile.tests, statement, reference };
  if (bruteForce) problem.bruteForce = bruteForce;
  return { ok: true, problem };
}

function parseFile<T>(
  name: string,
  text: string | null | undefined,
  schema: z.ZodType<T>,
  errors: string[],
): T | undefined {
  if (text === null || text === undefined) {
    errors.push(`${name}: missing`);
    return undefined;
  }
  let data: unknown;
  try {
    data = parseJson(text);
  } catch (e) {
    errors.push(`${name}: not valid JSON (${e instanceof Error ? e.message : String(e)})`);
    return undefined;
  }
  const version = (data as { schema_version?: unknown } | null)?.schema_version;
  if (typeof version === 'number' && version !== SCHEMA_VERSION) {
    errors.push(
      version > SCHEMA_VERSION
        ? `${name}: schema_version ${version} is newer than this app supports (${SCHEMA_VERSION}); update the app`
        : `${name}: schema_version ${version} is an older format; convert it to version ${SCHEMA_VERSION}`,
    );
    return undefined;
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    for (const issue of result.error.issues)
      errors.push(`${name}: ${formatPath(issue.path)}${issue.message}`);
    return undefined;
  }
  return result.data;
}

function formatPath(path: readonly PropertyKey[]): string {
  if (!path.length) return '';
  let out = '';
  for (const key of path) {
    out += typeof key === 'number' ? `[${key}]` : `${out ? '.' : ''}${String(key)}`;
  }
  return `${out}: `;
}
