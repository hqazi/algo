/**
 * The practice flow end to end below the IPC handlers: the real `content/`
 * catalog, SQLite, the file workspace in a temp folder and Python run by the
 * Pyodide executor on Node worker threads (as in `pyodide-executor.test.ts`).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stringifyJson } from '@algo/core';
import { PyodidePool } from '../../exec-host/pool';
import { poolTransport } from '../../exec-host/pool-transport';
import { nodeWorkerFactory } from '../../exec-host/testing/node-factory';
import { LocalExecutor } from '../exec/local';
import { PyodideExecutor } from '../exec/pyodide-executor';
import { openDatabase } from '../storage/database';
import { SqliteStorage } from '../storage/sqlite-storage';
import { FileCatalog } from './catalog';
import { FileWorkspace } from './file-workspace';
import { Practice, PracticeRefusal } from './service';
import { caseView, reportView } from './service';
import { reportView as reportSchema } from '../../shared/practice';

const CONTENT = fileURLToPath(new URL('../../../../../content/', import.meta.url));
const now = (): string => '2026-11-19T10:00:00Z';

let pool: PyodidePool;
let executor: PyodideExecutor;
let dataDir: string;
let storage: SqliteStorage;
let workspace: FileWorkspace;
let catalog: FileCatalog;
let practice: Practice;

beforeAll(async () => {
  pool = new PyodidePool(nodeWorkerFactory, { graceMs: 150, spares: 2 });
  executor = new PyodideExecutor(poolTransport(pool));
  await executor.status();
}, 60_000);

afterAll(() => pool.dispose());

beforeEach(async () => {
  if (storage) await storage.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = mkdtempSync(join(tmpdir(), 'algotutor-practice-'));
  storage = new SqliteStorage(openDatabase(':memory:').db);
  workspace = new FileWorkspace(join(dataDir, 'workspace'));
  catalog = await FileCatalog.open({ content: CONTENT, dataDir }, now, storage);
  practice = new Practice({
    storage,
    catalog,
    workspace,
    executorFor: (language) => (language === 'python' ? executor : null),
    timeScale: () => 1,
    now,
  });
});

const refusal = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    if (e instanceof PracticeRefusal) return e.reason;
    throw e;
  }
  throw new Error('expected a refusal');
};

describe('FileCatalog', () => {
  it('loads every curated problem and indexes it in SQLite', () => {
    expect(catalog.issues).toEqual([]);
    expect(catalog.list().length).toBeGreaterThanOrEqual(50);
    expect(catalog.list().every((p) => p.source === 'curated')).toBe(true);
    const indexed = storage.read((db) => db.listProblems());
    expect(indexed).toHaveLength(catalog.list().length);
    expect(indexed.find((p) => p.slug === 'pair-with-target')).toMatchObject({
      topic: 'hashing',
      path: 'problems/hashing/pair-with-target',
    });
  });

  it('adds problems from the data folder and refuses a "curated" one there', async () => {
    const src = join(CONTENT, 'problems', 'hashing', 'pair-with-target');
    const add = async (slug: string, source: string): Promise<void> => {
      const dir = join(dataDir, 'problems', 'generated', slug);
      await mkdir(dir, { recursive: true });
      for (const f of ['problem.md', 'tests.json', 'reference.py'])
        await writeFile(join(dir, f), await readFile(join(src, f)));
      const meta = JSON.parse(await readFile(join(src, 'meta.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      await writeFile(join(dir, 'meta.json'), JSON.stringify({ ...meta, slug, source }));
    };
    await add('my-pairs', 'generated');
    await add('fake-curated', 'curated');
    await catalog.reload();
    expect(catalog.list().at(-1)).toMatchObject({ slug: 'my-pairs', source: 'generated' });
    expect(catalog.issues).toEqual([
      expect.objectContaining({ where: 'problems/generated/fake-curated' }),
    ]);
  });
});

describe('Practice', () => {
  it('lists problems with status filters, in teaching order', async () => {
    await practice.teaching.profileDefaults();
    await practice.teaching.start('pair-with-target');
    expect(practice.problems({ status: 'active' }).map((p) => p.slug)).toEqual([
      'pair-with-target',
    ]);
    const hashing = practice.problems({ topic: 'hashing' });
    expect(hashing.length).toBeGreaterThan(1);
    expect(hashing.map((p) => p.difficulty)).toEqual(
      [...hashing.map((p) => p.difficulty)].sort(
        (a, b) => ['easy', 'medium', 'hard'].indexOf(a) - ['easy', 'medium', 'hard'].indexOf(b),
      ),
    );
  });

  it('shows a problem with visible examples only, as JSON text', async () => {
    const d = await practice.problem('pair-with-target');
    const problem = (await catalog.load('pair-with-target'))!;
    const visible = problem.tests.filter((t) => t.visibility === 'visible');
    expect(d.examples.map((e) => e.id)).toEqual(visible.map((t) => t.id));
    expect(d.examples[0]!.expected).toBe(stringifyJson(visible[0]!.expected));
    expect(d.status).toBe('new');
    expect(d.attempt_recorded).toBe(false);
    const text = JSON.stringify(d);
    for (const t of problem.tests.filter((x) => x.visibility === 'hidden'))
      expect(text).not.toContain(t.id);
  });

  it('starter → run → submit (not solved) → solve → submit records and updates progress', async () => {
    await practice.teaching.profileDefaults();
    const slug = 'pair-with-target';
    const ws = await practice.workspace(slug);
    expect(ws.exists).toBe(false);
    expect(ws.code).toContain('def find_pair(');
    await practice.teaching.start(slug);
    expect((await practice.workspace(slug)).exists).toBe(true);

    const run = await practice.run(slug);
    expect(run.cases.every((c) => c.visibility === 'visible')).toBe(true);
    expect(run.all_passed).toBe(false);
    expect(run.cases[0]).toMatchObject({ status: 'error', error_type: 'NotImplementedError' });

    const wrong = await practice.submit(slug);
    expect(wrong.recorded).toBe(false);
    expect(wrong.report.cases.some((c) => c.visibility === 'hidden')).toBe(true);
    expect(practice.problems({ status: 'active' }).map((p) => p.slug)).toEqual([slug]);
    expect(await refusal(practice.reference(slug))).toBe('locked');

    await practice.save(slug, (await catalog.load(slug))!.reference);
    const ok = await practice.submit(slug);
    expect(ok.recorded).toBe(true);
    expect(ok.record).toMatchObject({ recorded: { outcome: 'unaided' }, topic: 'hashing' });
    expect(practice.topics().find((t) => t.id === 'hashing')).toMatchObject({
      level: 'learning',
      solved_unaided: 1,
    });
    expect(practice.attempts({})).toEqual([
      expect.objectContaining({ slug, outcome: 'unaided', tests_passed: ok.report.total }),
    ]);
    expect((await practice.reference(slug)).code).toContain('def find_pair');
    const runs = storage.read((db) => db.listTestRuns(practice.attempts({})[0]!.id));
    expect(runs.map((r) => r.kind)).toEqual(['run', 'submit', 'submit']);
  }, 60_000);

  it('give up records the attempt and opens the reference', async () => {
    await practice.teaching.profileDefaults();
    await practice.teaching.start('first-unique-char');
    const r = await practice.giveUp('first-unique-char', 'revisit');
    expect(r.record.recorded.outcome).toBe('gave_up');
    expect(r.report?.all_passed).toBe(false);
    expect((await practice.problem('first-unique-char')).status).toBe('gave_up');
    await practice.reference('first-unique-char');
  }, 60_000);

  it('run without a saved solution, and a busy problem, are refused', async () => {
    expect(await refusal(practice.run('pair-with-target'))).toBe('no_solution');
    await practice.teaching.profileDefaults();
    await practice.teaching.start('pair-with-target');
    const first = practice.run('pair-with-target');
    // Wait until the first run holds the problem (slow runners need more than a tick).
    await vi.waitFor(() => expect(practice.guard.isBusy('pair-with-target')).toBe(true), {
      timeout: 10_000,
      interval: 5,
    });
    expect(await refusal(practice.run('pair-with-target'))).toBe('busy');
    expect(await refusal(practice.save('pair-with-target', 'x = 1\n'))).toBe('busy');
    await first;
  }, 60_000);

  it('reports every case through the strict UI schema', async () => {
    await practice.teaching.profileDefaults();
    await practice.teaching.start('rotate-playlist');
    await practice.save(
      'rotate-playlist',
      'def shift_playlist(tracks, k):\n    print("hi")\n    return tracks\n',
    );
    const r = await practice.submit('rotate-playlist');
    expect(reportSchema.safeParse(r.report).success).toBe(true);
    const visibleFail = r.report.cases.find(
      (c) => c.visibility === 'visible' && c.status === 'fail',
    );
    expect(visibleFail).toMatchObject({ stdout: 'hi\n' });
    expect(visibleFail).toHaveProperty('actual');
    for (const c of r.report.cases.filter((x) => x.visibility === 'hidden'))
      expect(Object.keys(c).sort()).toEqual(expect.arrayContaining(['id', 'status', 'visibility']));
    for (const c of r.report.cases.filter((x) => x.visibility === 'hidden'))
      for (const k of Object.keys(c))
        expect(['id', 'visibility', 'category', 'status', 'time_ms']).toContain(k);
  }, 60_000);
});

const HAS_GO = spawnSync('go', ['version']).status === 0;

describe('languages (T16)', () => {
  const GO_SOLUTION =
    'package main\n\nfunc shiftPlaylist(tracks []int, k int) []int {\n\tn := len(tracks)\n' +
    '\tif n == 0 {\n\t\treturn []int{}\n\t}\n\tk %= n\n' +
    '\treturn append(append([]int{}, tracks[n-k:]...), tracks[:n-k]...)\n}\n';

  it('switches the attempt between languages, each with its own file', async () => {
    await practice.teaching.profileDefaults();
    const offered = await practice.languages('rotate-playlist');
    expect(offered).toEqual([
      { language: 'python', available: true },
      { language: 'rust', available: false },
      { language: 'go', available: false },
    ]);
    await practice.teaching.start('rotate-playlist');
    await practice.save('rotate-playlist', 'def shift_playlist(tracks, k):\n    return tracks\n');
    const go = await practice.switchLanguage('rotate-playlist', 'go');
    expect(go).toMatchObject({ language: 'go', exists: true });
    expect(go.code).toContain('func shiftPlaylist(tracks []int, k int) []int {');
    expect(go.path.endsWith('solution.go')).toBe(true);
    expect((await practice.problem('rotate-playlist')).language).toBe('go');
    expect(storage.read((db) => db.listAttempts())).toHaveLength(1);
    // Back to Python: the code is where it was left.
    const py = await practice.switchLanguage('rotate-playlist', 'python');
    expect(py.code).toBe('def shift_playlist(tracks, k):\n    return tracks\n');
  });

  it.skipIf(!HAS_GO)(
    'runs and submits a Go solution with the local toolchain',
    async () => {
      const local = new LocalExecutor({
        buildDir: join(dataDir, 'cache', 'build'),
        runnersDir: join(CONTENT, 'runners'),
      });
      const withGo = new Practice({
        storage,
        catalog,
        workspace,
        executorFor: (language) => (language === 'python' ? executor : local),
        languageStatus: (language) => local.statusFor(language),
        timeScale: () => 1,
        now,
      });
      await withGo.teaching.profileDefaults();
      expect(
        (await withGo.languages('rotate-playlist')).find((l) => l.language === 'go'),
      ).toMatchObject({ available: true, version: expect.stringMatching(/^go \d/) as unknown });
      await withGo.switchLanguage('rotate-playlist', 'go');
      await withGo.save('rotate-playlist', GO_SOLUTION);
      const r = await withGo.submit('rotate-playlist');
      expect(reportSchema.safeParse(r.report).success).toBe(true);
      expect(r.report).toMatchObject({ language: 'go', all_passed: true });
      expect(r.recorded).toBe(true);
      expect(storage.read((db) => db.listAttempts())[0]).toMatchObject({ language: 'go' });
    },
    300_000,
  );
});

describe('caseView', () => {
  it('drops everything but the allowlist from hidden cases, even unredacted ones', () => {
    const c = caseView({
      id: 'h1',
      visibility: 'hidden',
      category: 'empty',
      status: 'fail',
      input: { a: 1 },
      expected: 2,
      actual: 3,
      stdout: 'x',
      message: 'm',
      timeMs: 4,
    });
    expect(c).toEqual({
      id: 'h1',
      visibility: 'hidden',
      category: 'empty',
      status: 'fail',
      time_ms: 4,
    });
  });

  it('keeps big integers exact', () => {
    const r = reportView('s', 'python', {
      passed: 0,
      total: 1,
      all_passed: false,
      duration_ms: 1,
      cases: [
        { id: 'a', visibility: 'visible', status: 'fail', input: { n: 2n ** 63n }, actual: 1 },
      ],
    });
    expect(r.cases[0]).toMatchObject({ input: { n: '9223372036854775808' } });
  });
});

describe('FileWorkspace', () => {
  it('saves atomically and reports edits made by another program, not its own', async () => {
    const seen: string[] = [];
    await workspace.create('pair-with-target', 'python', 'a\n');
    const handle = await workspace.watch('pair-with-target', 'python', (c) => seen.push(c));
    try {
      await workspace.write('pair-with-target', 'python', 'mine\n');
      await new Promise((r) => setTimeout(r, 400));
      expect(seen).toEqual([]);
      await writeFile(workspace.file('pair-with-target', 'python'), 'theirs\n');
      await expect.poll(() => seen, { timeout: 3000 }).toEqual(['theirs\n']);
    } finally {
      handle.close();
    }
  });

  it('refuses an oversized solution', async () => {
    await expect(
      workspace.write('pair-with-target', 'python', 'x'.repeat(200_001)),
    ).rejects.toThrow(/limit/);
  });
});
