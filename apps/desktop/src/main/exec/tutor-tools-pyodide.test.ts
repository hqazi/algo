/**
 * The tutor tools end to end with the real parts below them: curated content
 * from `content/problems/`, SQLite storage, and Python run by the Pyodide
 * executor (Node worker threads, as in `pyodide-executor.test.ts`). The core
 * tests cover the tools in depth with a scripted executor; this checks that
 * the real executor and storage agree with them.
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildTutorRegistry,
  loadProblem,
  memoryCatalog,
  memoryWorkspace,
  parseTopics,
  SlugGuard,
  stringifyJson,
  Teaching,
  workspacePath,
  type Problem,
  type ToolRegistry,
  type TutorToolContext,
} from '@algorithm-tutor/core';
import { PyodidePool } from '../../exec-host/pool';
import { poolTransport } from '../../exec-host/pool-transport';
import { nodeWorkerFactory } from '../../exec-host/testing/node-factory';
import { openDatabase } from '../storage/database';
import { SqliteStorage } from '../storage/sqlite-storage';
import { PyodideExecutor } from './pyodide-executor';

const CONTENT = fileURLToPath(new URL('../../../../../content/', import.meta.url)).replaceAll(
  '\\',
  '/',
);
const SLUGS = ['first-unique-char', 'pair-with-target', 'rotate-playlist'];

let pool: PyodidePool;
let executor: PyodideExecutor;
let problems: Problem[];
let topics: ReturnType<typeof parseTopics>;
let storage: SqliteStorage;
let workspace: ReturnType<typeof memoryWorkspace>;
let tools: ToolRegistry<TutorToolContext>;

beforeAll(async () => {
  pool = new PyodidePool(nodeWorkerFactory, { graceMs: 150, spares: 2 });
  executor = new PyodideExecutor(poolTransport(pool));
  topics = parseTopics(await readFile(`${CONTENT}references/topics.md`, 'utf8'));
  const reader = { readText: (p: string) => readFile(p, 'utf8').catch(() => null) };
  problems = [];
  for (const topic of await readdir(`${CONTENT}problems`))
    for (const slug of await readdir(`${CONTENT}problems/${topic}`)) {
      if (!SLUGS.includes(slug)) continue;
      const r = await loadProblem(reader, `${CONTENT}problems/${topic}/${slug}`);
      if (!r.ok) throw new Error(r.errors.join('\n'));
      problems.push(r.problem);
    }
  expect(problems.map((p) => p.meta.slug).sort()).toEqual(SLUGS);
  await executor.status();
}, 60_000);

afterAll(() => pool.dispose());

beforeEach(async () => {
  if (storage) await storage.close();
  storage = new SqliteStorage(openDatabase(':memory:').db);
  workspace = memoryWorkspace();
  const teaching = new Teaching({
    storage,
    catalog: memoryCatalog(topics, problems),
    workspace,
    now: () => new Date().toISOString(),
  });
  tools = buildTutorRegistry({
    teaching,
    storage,
    workspace,
    guard: new SlugGuard(),
    executorFor: (language) => (language === 'python' ? executor : null),
  });
});

const problem = (slug: string): Problem => problems.find((p) => p.meta.slug === slug)!;
const save = (slug: string, code: string): void => {
  workspace.files.set(workspacePath(slug, 'python'), code);
};

describe('tutor tools with Pyodide and SQLite', () => {
  it('the starter code fails every test, hidden ones redacted', async () => {
    await tools.call('start_problem', { slug: 'first-unique-char' });
    const r = await tools.call('run_tests', { slug: 'first-unique-char' });
    const out = r.output as unknown as {
      all_passed: boolean;
      cases: { status: string; errorType?: string; visibility: string; input?: unknown }[];
    };
    expect(out.all_passed).toBe(false);
    for (const c of out.cases) {
      expect(c.status).toBe('error');
      if (c.visibility === 'hidden') expect(Object.keys(c)).not.toContain('input');
      else expect(c.errorType).toBe('NotImplementedError');
    }
    expect((await tools.call('record_attempt', { slug: 'first-unique-char' })).output.code).toBe(
      'not_solved',
    );
  }, 60_000);

  it('record_attempt runs the reference and records an unaided solve in SQLite', async () => {
    await tools.call('set_profile', { pairs: { goal: 'general' } });
    await tools.call('start_problem', { slug: 'pair-with-target' });
    save('pair-with-target', problem('pair-with-target').reference);
    const r = await tools.call('record_attempt', { slug: 'pair-with-target', notes: 'hash map' });
    expect(r.output).toMatchObject({ ok: true, recorded: { outcome: 'unaided' } });
    const attempts = storage.read((db) => db.listAttempts());
    expect(attempts).toEqual([expect.objectContaining({ outcome: 'unaided', notes: 'hash map' })]);
    expect(storage.read((db) => db.listTestRuns(attempts[0]!.id)).map((x) => x.kind)).toEqual([
      'submit',
    ]);
    expect(storage.read((db) => db.getTopicProgress('hashing'))).toMatchObject({
      level: 'learning',
      unaidedSolves: 1,
    });
  }, 60_000);

  it('a wrong answer and a timeout are graded, hidden data stays out', async () => {
    save(
      'rotate-playlist',
      'def shift_playlist(tracks, k):\n    print(tracks, k)\n    if k == 0:\n' +
        '        while True:\n            pass\n    return tracks\n',
    );
    const r = await tools.call('run_tests', { slug: 'rotate-playlist' });
    const out = r.output as unknown as {
      total: number;
      passed: number;
      cases: { category?: string; status: string; visibility: string; actual?: unknown }[];
    };
    expect(out.cases).toHaveLength(problem('rotate-playlist').tests.length);
    const statuses = new Set(out.cases.map((c) => c.status));
    expect(statuses.has('fail')).toBe(true);
    expect(statuses.has('timeout')).toBe(true); // k == 0 loops forever
    expect(out.passed).toBeGreaterThan(0); // the run goes on after a timeout
    expect(out.cases.find((c) => c.visibility === 'visible' && c.status === 'fail')).toHaveProperty(
      'actual',
    );
    const text = stringifyJson(r.output);
    for (const t of problem('rotate-playlist').tests.filter((x) => x.visibility === 'hidden')) {
      const input = stringifyJson(t.input);
      if (input.length >= 8) expect(text.includes(input)).toBe(false);
    }
  }, 60_000);
});
