/**
 * New problems end to end in the main process, with the real parts below
 * them: the self-check in Pyodide (Node worker threads, as in
 * `pyodide-executor.test.ts`), problem folders in a temporary data folder
 * read back by the file catalog, SQLite, and the intake IPC channels. The
 * tutor is the fake backend; open-set files come from a stand-in `fetch`.
 * Nothing here calls an AI provider or the network.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  FakeBackend,
  type Executor,
  type ExecutorId,
  type FakeScript,
  type RunJob,
} from '@algo/core';
import { PyodidePool } from '../../exec-host/pool';
import { poolTransport } from '../../exec-host/pool-transport';
import { nodeWorkerFactory } from '../../exec-host/testing/node-factory';
import { PyodideExecutor } from '../exec/pyodide-executor';
import type { IpcResult } from '../../shared/ipc';
import { registerIntakeHandlers } from '../ipc/handlers/intake';
import { IpcRouter } from '../ipc/router';
import { FakeIpcMain, page } from '../ipc/testing';
import { FileCatalog } from '../practice/catalog';
import { FileWorkspace } from '../practice/file-workspace';
import { Practice } from '../practice/service';
import { openAppStorage, type AppStorage } from '../storage';
import { openTutor } from '../tutor';
import { chatCreateProblem, openIntake, openSets, problemFactory, type AppIntake } from '.';
import specs from '../../../../../packages/core/src/intake/fixtures/specs.json';

const CONTENT = fileURLToPath(new URL('../../../../../content/', import.meta.url));
const FIXTURES = fileURLToPath(
  new URL('../../../../../packages/core/src/intake/fixtures/exercism/', import.meta.url),
);
const now = (): string => '2026-11-19T10:00:00Z';
const GOOD = specs.good;
const BAD = { ...specs.good, reference_solution: specs.bad_reference };

let pool: PyodidePool;
let pyodide: PyodideExecutor;
let dataDir: string;
let app: AppStorage;
let catalog: FileCatalog;
let practice: Practice;
let intake: AppIntake;
let ipc: FakeIpcMain;
let script: FakeScript;
let asked: ExecutorId[];
let others: { local: RunJob[]; container: RunJob[] };
let pyodideJobs: RunJob[];
let fetched: string[];

/** A registry with every executor id: only Pyodide may ever be used for model-written code. */
const spy = (id: ExecutorId, jobs: RunJob[], real?: Executor): Executor => ({
  id,
  status: () => Promise.resolve({ available: true }),
  run: (job, signal) => {
    jobs.push(job);
    if (!real) throw new Error(`${id} must not run model-written code`);
    return real.run(job, signal);
  },
});

beforeAll(async () => {
  pool = new PyodidePool(nodeWorkerFactory, { graceMs: 150, spares: 2 });
  pyodide = new PyodideExecutor(poolTransport(pool));
  await pyodide.status();
}, 60_000);

afterAll(() => pool.dispose());

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'algotutor-intake-'));
  app = openAppStorage(dataDir);
  catalog = await FileCatalog.open({ content: CONTENT, dataDir }, now, app.storage);
  asked = [];
  others = { local: [], container: [] };
  pyodideJobs = [];
  fetched = [];
  const registry: Record<ExecutorId, Executor> = {
    pyodide: spy('pyodide', pyodideJobs, pyodide),
    local: spy('local', others.local),
    container: spy('container', others.container),
  };
  const executors = (id: ExecutorId): Executor => {
    asked.push(id);
    return registry[id];
  };
  practice = new Practice({
    storage: app.storage,
    catalog,
    workspace: new FileWorkspace(app.paths.workspace),
    // The learner's own code would go to the local toolchain here: model-written code must not.
    executorFor: () => registry.local,
    timeScale: () => 1,
    now,
  });
  const create = problemFactory({ catalog, dataDir, executors, now });
  const tutor = await openTutor({
    practice,
    settings: () => app.settings.get(),
    apiKey: () => null,
    contentDir: CONTENT,
    explanationsDir: app.paths.explanations,
    agentHome: app.paths.agentHome,
    appVersion: '0.0.0',
    env: {},
    now,
    createProblem: chatCreateProblem(create),
  });
  const { sets } = await openSets({
    contentDir: CONTENT,
    cacheDir: app.paths.cache,
    topics: new Set(catalog.topics().map((t) => t.id)),
    fetch: (url) => {
      fetched.push(url);
      const file = url.slice(url.lastIndexOf('/') + 1);
      // The index lists introduction.md and instructions.md: both get the fixture text.
      const name = file.endsWith('.md') ? 'instructions.md' : file;
      if (url.includes('/exercises/binary-search/') && existsSync(join(FIXTURES, name)))
        return Promise.resolve(new Response(readFileSync(join(FIXTURES, name))));
      if (url.includes('/exercises/sublist/'))
        return Promise.resolve(
          new Response(null, { status: 302, headers: { location: 'https://evil.example/x' } }),
        );
      return Promise.resolve(new Response('', { status: 404 }));
    },
  });
  script = [];
  intake = openIntake({
    catalog,
    create,
    sets,
    backend: () => new FakeBackend(script),
    tools: tutor.tools,
    guides: tutor.references,
    guard: practice.guard,
    log: () => {},
  });
  ipc = new FakeIpcMain();
  const router = new IpcRouter(ipc, {
    isTrustedUrl: (u) => u.startsWith('tutor-app://app/'),
    onError: (c, e) => {
      throw new Error(`ipc ${c}: ${String(e)}`);
    },
  });
  registerIntakeHandlers(router, { intake });
});

afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function call<T>(channel: string, payload?: unknown): Promise<IpcResult<T>> {
  return (await ipc.invoke(page().event, channel, payload)) as IpcResult<T>;
}

/** Starts a job over IPC and follows `intake:events` to the end. */
async function job(request: unknown): Promise<{ events: unknown[]; result: unknown }> {
  const started = await call<{ jobId: string }>('intake:start', request);
  if (!started.ok) throw new Error(started.error.message);
  const p = page();
  void ipc.invoke(p.event, 'ipc:stream:start', {
    id: 's1',
    channel: 'intake:events',
    request: { jobId: started.value.jobId },
  });
  for (let i = 0; i < 600 && !p.results().length; i++) await new Promise((r) => setTimeout(r, 50));
  const events = (p.events() as { event: unknown }[]).map((e) => e.event);
  const [result] = p.results() as { result: IpcResult<unknown> }[];
  return { events, result: result?.result };
}

describe('intake with Pyodide and the file catalog', () => {
  it('generates a problem that the catalog loads, after a repair', async () => {
    script = [
      [
        { tool: 'create_problem', input: { spec: BAD } },
        { tool: 'create_problem', input: { spec: GOOD } },
      ],
    ];
    const { events, result } = await job({
      kind: 'generate',
      topic: 'arrays-strings',
      difficulty: 'easy',
    });
    expect(result).toEqual({
      ok: true,
      value: { type: 'done', slug: 'count-even-readings', title: 'Even Readings' },
    });
    expect(events.map((e) => (e as { stage: string }).stage)).toEqual([
      'started',
      'writing',
      'checking',
      'repair',
      'checking',
    ]);
    // Nothing of the hidden tests crossed IPC.
    const sent = JSON.stringify(events);
    for (const needle of specs.hidden_needles) expect(sent).not.toContain(needle);

    const dir = join(dataDir, 'problems', 'generated', 'count-even-readings');
    expect(existsSync(join(dir, 'meta.json'))).toBe(true);
    expect(catalog.issues).toEqual([]);
    const problem = await catalog.load('count-even-readings');
    expect(problem?.meta).toMatchObject({ source: 'generated', time_limit_ms: 2000 });
    expect(problem?.tests.map((t) => t.expected)).toEqual([2, 0, 0, 3, 2]);
    expect(app.storage.read((db) => db.getProblem('count-even-readings'))?.source).toBe(
      'generated',
    );

    // Brute force, failing reference, brute force, passing reference: all in Pyodide.
    expect(new Set(asked)).toEqual(new Set(['pyodide']));
    expect(pyodideJobs).toHaveLength(4);
    expect(others.local).toEqual([]);
    expect(others.container).toEqual([]);
  }, 120_000);

  it('imports an Exercism entry with its licence, and lists it as imported', async () => {
    script = [[{ tool: 'create_problem', input: { spec: specs.import } }]];
    const { result } = await job({ kind: 'import', set: 'exercism', entry: 'binary-search' });
    expect(result).toMatchObject({ ok: true, value: { type: 'done', slug: 'shelf-search' } });
    expect(fetched.every((u) => u.startsWith('https://raw.githubusercontent.com/'))).toBe(true);
    const dir = join(dataDir, 'problems', 'imported', 'shelf-search');
    expect(readFileSync(join(dir, 'NOTICE.md'), 'utf8')).toContain(
      'Copyright (c) 2014, 2019, 2021 Exercism',
    );
    const problem = await catalog.load('shelf-search');
    expect(problem?.meta.origin).toMatchObject({ kind: 'open-set', license: 'MIT' });
    // Fetched once, then cached in the data folder.
    expect(existsSync(join(app.paths.cache, 'open-sets', 'raw.githubusercontent.com'))).toBe(true);

    const sets = await call<{ sets: { id: string; entries: number }[] }>('open-sets:list');
    expect(sets).toMatchObject({ ok: true, value: { sets: [{ id: 'exercism' }] } });
    const entries = await call<{ entries: { id: string; imported: string | null }[] }>(
      'open-sets:entries',
      { set: 'exercism' },
    );
    if (!entries.ok) throw new Error('entries failed');
    expect(entries.value.entries.find((e) => e.id === 'binary-search')?.imported).toBe(
      'shelf-search',
    );
    expect(entries.value.entries.find((e) => e.id === 'isogram')?.imported).toBeNull();
    expect(asked.every((id) => id === 'pyodide')).toBe(true);
  }, 120_000);

  it('refuses a redirect off the allowlist, and bad requests', async () => {
    script = [[{ tool: 'create_problem', input: { spec: specs.import } }]];
    const { result } = await job({ kind: 'import', set: 'exercism', entry: 'sublist' });
    expect(result).toMatchObject({ ok: true, value: { type: 'error', code: 'fetch' } });
    expect(JSON.stringify(result)).toContain('evil.example');
    expect(asked).toEqual([]);

    expect(
      await call('intake:start', { kind: 'import', set: 'exercism', entry: 'nope' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'refused', reason: 'unknown_entry' },
    });
    expect(await call('intake:start', { kind: 'paste', text: 'short' })).toMatchObject({
      ok: false,
      error: { code: 'refused', reason: 'invalid' },
    });
    expect(await call('intake:current')).toEqual({ ok: true, value: { jobId: null } });
    expect(await call('intake:cancel', { jobId: `job_${'0'.repeat(24)}` })).toEqual({
      ok: true,
      value: { cancelled: false },
    });
  }, 60_000);
});
