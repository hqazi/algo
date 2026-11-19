/**
 * The tutor as the app wires it (T10): real content, SQLite, files on disk,
 * the fake backend from `ALGOTUTOR_FAKE_TUTOR`, a scripted executor, and the
 * tutor channels through the IPC router. Nothing calls an AI provider.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  stringifyJson,
  type FakeScript,
  type Settings,
} from '@algorithm-tutor/core';
import {
  curatedProblems,
  hiddenNeedles,
  ScriptedExecutor,
} from '../../../../../packages/core/src/teaching/test-support';
import { STREAM_CANCEL, STREAM_START, type IpcResult } from '../../shared/ipc';
import { chatEvent, threadResponse } from '../../shared/tutor';
import { registerTutorHandlers } from '../ipc/handlers/tutor';
import { IpcRouter } from '../ipc/router';
import { FakeIpcMain, page } from '../ipc/testing';
import { FileCatalog } from '../practice/catalog';
import { FileWorkspace } from '../practice/file-workspace';
import { Practice } from '../practice/service';
import { openDatabase } from '../storage/database';
import { SqliteStorage } from '../storage/sqlite-storage';
import { ExplanationStore, KEEP } from './explanations';
import {
  CLAUDE_CODE_MIN_VERSION,
  DEFAULT_MODEL,
  FAKE_TUTOR_ENV,
  openTutor,
  type AppTutor,
  type ClaudeCodeInfo,
} from '.';

const CONTENT = fileURLToPath(new URL('../../../../../content/', import.meta.url));
const SLUG = 'compress-runs';
const now = (): string => '2026-11-19T10:00:00Z';

let dataDir: string;
let storage: SqliteStorage;
let workspace: FileWorkspace;
let practice: Practice;
let executor: ScriptedExecutor;
let tutor: AppTutor;
let ipc: FakeIpcMain;
let settings: Settings;
let apiKey: string | null;
let streamId = 0;
let ccInfo: ClaudeCodeInfo;
let detections: (string | null)[];

async function make(script: FakeScript | null): Promise<void> {
  const env: Record<string, string> = {};
  if (script) {
    const file = join(dataDir, 'fake.json');
    await writeFile(file, JSON.stringify(script));
    env[FAKE_TUTOR_ENV] = file;
  }
  tutor = await openTutor({
    practice,
    settings: () => settings,
    apiKey: () => apiKey,
    contentDir: CONTENT,
    explanationsDir: join(dataDir, 'explanations'),
    agentHome: join(dataDir, 'agent-home'),
    appVersion: '0.0.0',
    detectClaudeCode: (configured) => {
      detections.push(configured);
      return Promise.resolve(ccInfo);
    },
    env,
    now,
    log: () => {},
  });
  ipc = new FakeIpcMain();
  const router = new IpcRouter(ipc, {
    isTrustedUrl: (u) => u.startsWith('tutor-app://app/'),
    onError: () => {},
  });
  registerTutorHandlers(router, { tutor, practice });
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'algotutor-tutor-'));
  storage = new SqliteStorage(openDatabase(':memory:').db);
  workspace = new FileWorkspace(join(dataDir, 'workspace'));
  const catalog = await FileCatalog.open({ content: CONTENT, dataDir }, now, storage);
  executor = new ScriptedExecutor(await curatedProblems());
  practice = new Practice({
    storage,
    catalog,
    workspace,
    executorFor: (language) => (language === 'python' ? executor : null),
    timeScale: () => 1,
    now,
  });
  await practice.teaching.profileDefaults();
  settings = structuredClone(DEFAULT_SETTINGS);
  apiKey = null;
  detections = [];
  ccInfo = {
    found: false,
    path: null,
    version: null,
    usable: false,
    reason: 'Claude Code was not found.',
  };
});

afterEach(async () => {
  await storage.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const invoke = (channel: string, request?: unknown): Promise<IpcResult<unknown>> =>
  ipc.invoke(page().event, channel, request) as Promise<IpcResult<unknown>>;

async function value<T>(channel: string, request?: unknown): Promise<T> {
  const r = await invoke(channel, request);
  if (!r.ok) throw new Error(`${channel}: ${JSON.stringify(r.error)}`);
  return r.value as T;
}

type Sent = { events: { type: string; [k: string]: unknown }[]; result: IpcResult<unknown> };

/** Starts a `chat:send` stream from one page; `onEvent` may cancel it. */
function start(
  request: unknown,
  onEvent?: (event: { type: string }, cancel: () => void) => void,
): { cancel: () => void; done: Promise<Sent> } {
  const p = page();
  const id = `s${++streamId}`;
  const cancel = () => ipc.send(p.event, STREAM_CANCEL, id);
  const seen: unknown[] = [];
  const origSend = p.event.sender.send;
  p.event.sender.send = (channel: string, ...args: unknown[]) => {
    origSend(channel, ...args);
    const msg = args[0] as { id: string; event?: { type: string } };
    if (msg?.id === id && msg.event) {
      seen.push(msg.event);
      onEvent?.(msg.event, cancel);
    }
  };
  const done = (async () => {
    const result = (await ipc.invoke(p.event, STREAM_START, {
      id,
      channel: 'chat:send',
      request,
    })) as IpcResult<unknown>;
    for (const e of seen) expect(chatEvent.safeParse(e).success, JSON.stringify(e)).toBe(true);
    return { events: seen as Sent['events'], result };
  })();
  return { cancel, done };
}

const send = (request: unknown, onEvent?: (event: { type: string }, cancel: () => void) => void) =>
  start(request, onEvent).done;

describe('status and backend choice', () => {
  it('auto without a key: no tutor, and a reason', async () => {
    await make(null);
    expect(await value('tutor:status')).toEqual({
      backend: 'none',
      available: false,
      reason: expect.stringMatching(/API key/),
      model: DEFAULT_MODEL,
    });
    const { result } = await send({ thread: 'home', text: 'hi' });
    expect(result).toMatchObject({ ok: false, error: { code: 'refused', reason: 'unavailable' } });
  });

  it('auto with a key: Anthropic with the default model, or the configured one', async () => {
    await make(null);
    apiKey = 'sk-ant-test';
    expect(await value('tutor:status')).toEqual({
      backend: 'anthropic',
      available: true,
      reason: null,
      model: DEFAULT_MODEL,
    });
    settings.tutor.model = 'claude-sonnet-5-5';
    expect(await value('tutor:status')).toMatchObject({ model: 'claude-sonnet-5-5' });
    settings.tutor.backend = 'none';
    expect(await value('tutor:status')).toMatchObject({ backend: 'none', available: false });
  });

  it('claude-code: the installed CLI, with the app’s key; detection is cached', async () => {
    await make(null);
    settings.tutor.backend = 'claude-code';
    apiKey = 'sk-ant-test';
    expect(await value('tutor:status')).toEqual({
      backend: 'claude-code',
      available: false,
      reason: 'Claude Code was not found.',
      model: 'claude-opus-5-5',
    });
    ccInfo = { found: true, path: '/bin/claude', version: '2.1.400', usable: true, reason: null };
    // Cached until a recheck.
    expect(await value('tutor:status')).toMatchObject({ available: false });
    expect(await value('tutor:claude-code', { recheck: true })).toEqual({
      ...ccInfo,
      min_version: CLAUDE_CODE_MIN_VERSION,
    });
    expect(await value('tutor:status')).toMatchObject({
      backend: 'claude-code',
      available: true,
    });
    apiKey = null;
    expect(await value('tutor:status')).toMatchObject({
      available: false,
      reason: expect.stringMatching(/API key/) as string,
    });
    // A new configured path is detected again.
    const before = detections.length;
    settings.tutor.claudeCodePath = '/opt/claude';
    await value('tutor:claude-code', { recheck: false });
    expect(detections.slice(before)).toEqual(['/opt/claude']);
    await value('tutor:claude-code', { recheck: false });
    expect(detections.length).toBe(before + 1);
  });

  it('the fake backend from the environment replaces the choice; a bad script says why', async () => {
    await make([[{ text: 'hi' }]]);
    expect(await value('tutor:status')).toMatchObject({ backend: 'fake', available: true });
    const file = join(dataDir, 'bad.json');
    await writeFile(file, '{"not": "a list"}');
    tutor = await openTutor({
      practice,
      settings: () => settings,
      apiKey: () => null,
      contentDir: CONTENT,
      explanationsDir: join(dataDir, 'explanations'),
      agentHome: join(dataDir, 'agent-home'),
      appVersion: '0.0.0',
      env: { [FAKE_TUTOR_ENV]: file },
      now,
    });
    expect(await tutor.status()).toMatchObject({
      backend: 'fake',
      available: false,
      reason: expect.stringMatching(FAKE_TUTOR_ENV),
    });
  });

  it('builds the system prompt from the real guides', async () => {
    await make(null);
    expect(tutor.systemPrompt).toContain('# Guide: hint_ladder');
    expect(tutor.systemPrompt).toContain('`render_explanation`');
    expect(tutor.tools.has('render_explanation')).toBe(true);
    expect(tutor.tools.has('create_problem')).toBe(false);
  });
});

describe('chat over IPC', () => {
  it('streams a turn, stores it, and serves the transcript', async () => {
    await make([[{ text: 'Hello ' }, { text: 'there.' }]]);
    const { events, result } = await send({ thread: 'home', text: 'hi' });
    expect(events.map((e) => e.type)).toEqual(['text_delta', 'text_delta', 'done']);
    expect(result).toMatchObject({
      ok: true,
      value: { message: { role: 'assistant', text: 'Hello there.' } },
    });
    const t = threadResponse.parse(await value('chat:thread', { thread: 'home' }));
    expect(t.messages.map((m) => [m.seq, m.role, m.text])).toEqual([
      [1, 'user', 'hi'],
      [2, 'assistant', 'Hello there.'],
    ]);
    expect(t.running).toBe(false);
    expect(await value('chat:reset', { thread: 'home' })).toEqual({
      thread: 'home',
      archived: true,
    });
    expect(
      (await value<{ messages: unknown[] }>('chat:thread', { thread: 'home' })).messages,
    ).toEqual([]);
  });

  it('sends the problem, language, code and last stored report as context', async () => {
    await make([
      [{ tool: 'run_tests', input: { slug: SLUG } }, { text: 'ok' }],
      [{ text: 'again' }],
    ]);
    await practice.teaching.start(SLUG);
    await practice.save(SLUG, '# ECHO\n');
    const first = await send({ thread: SLUG, text: 'run' });
    const results = first.events.find((e) => e.type === 'ui_event') as unknown as {
      event: { action: string; report: { slug: string; cases: { visibility: string }[] } };
    };
    expect(results.event.action).toBe('show_results');
    expect(results.event.report.slug).toBe(SLUG);
    await send({ thread: SLUG, text: 'and?', code: 'editor code' });
    const fake = tutor.backend() as unknown as { turns: { context: Record<string, unknown> }[] };
    expect(fake.turns[0]!.context).toMatchObject({
      slug: SLUG,
      title: expect.any(String),
      language: 'python',
      code: '# ECHO\n',
    });
    expect(fake.turns[0]!.context.lastReport).toBeUndefined();
    expect(fake.turns[1]!.context).toMatchObject({
      code: 'editor code',
      lastReport: { total: expect.any(Number) },
    });
  });

  it('refuses an unknown problem, and a second turn in the same thread', async () => {
    await make([[{ sleep: 5000 }]]);
    expect((await send({ thread: 'no-such-problem', text: 'x' })).result).toMatchObject({
      ok: false,
      error: { code: 'refused', reason: 'no_problem' },
    });
    const first = start({ thread: 'home', text: 'one' });
    await new Promise((r) => setTimeout(r, 20));
    expect((await send({ thread: 'home', text: 'two' })).result).toMatchObject({
      ok: false,
      error: { reason: 'busy' },
    });
    expect(await invoke('chat:reset', { thread: 'home' })).toMatchObject({
      ok: false,
      error: { reason: 'busy' },
    });
    first.cancel();
    expect((await first.done).result).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  });

  it('cancel stops the turn and stores it as stopped', async () => {
    await make([[{ text: 'Thinking' }, { sleep: 10_000 }, { text: 'never' }]]);
    const { events, result } = await send({ thread: 'home', text: 'go' }, (e, cancel) => {
      if (e.type === 'text_delta') cancel();
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(events.map((e) => e.type)).toEqual(['text_delta']);
    for (let i = 0; i < 50 && tutor.chat.isRunning('home'); i++)
      await new Promise((r) => setTimeout(r, 10));
    const t = threadResponse.parse(await value('chat:thread', { thread: 'home' }));
    expect(t.messages.at(-1)).toMatchObject({ text: 'Thinking', error: { kind: 'cancelled' } });
  });

  it('never sends hidden test data to the renderer or the backend', async () => {
    const p = (await curatedProblems()).find((x) => x.meta.slug === SLUG)!;
    await make([
      [
        { tool: 'start_problem', input: { slug: SLUG } },
        { tool: 'run_tests', input: { slug: SLUG } },
        { tool: 'run_tests', input: { slug: SLUG, only: 'hidden' } },
        { tool: 'get_problem', input: { slug: SLUG } },
        { text: 'ok' },
      ],
      [{ text: 'next' }],
    ]);
    await practice.teaching.start(SLUG);
    await practice.save(SLUG, '# ECHO\n');
    const a = await send({ thread: SLUG, text: 'go' });
    const b = await send({ thread: SLUG, text: 'again' });
    const fake = tutor.backend() as unknown as { turns: unknown[] };
    const blob =
      stringifyJson(a.events) +
      stringifyJson(b.events) +
      stringifyJson(fake.turns.map((t) => (t as { context: unknown }).context)) +
      stringifyJson(await value('chat:thread', { thread: SLUG }));
    for (const n of hiddenNeedles(p)) expect(blob.includes(n), n).toBe(false);
  });
});

describe('explanations', () => {
  const content = {
    slug: SLUG,
    plain_words: 'Squash runs.',
    intuition: 'Count.',
    brute_force: { idea: 'Rebuild.', time: 'O(n^2)', space: 'O(n)' },
    optimal: { idea: 'One pass.', time: 'O(n)', space: 'O(n)' },
    trace: 'Step 1.',
    complexity: { time: 'O(n)', space: 'O(n)', why: 'Once.' },
    solution: 'def compress_runs(s):\n    return s\n',
    pitfalls: ['The last run.'],
  };

  it('the explain tool writes a version; the pages are listed, served and marked viewed', async () => {
    await make([[{ tool: 'render_explanation', input: { content } }, { text: 'Opened.' }]]);
    await practice.teaching.start(SLUG);
    const { events } = await send({ thread: SLUG, action: 'explain' });
    expect(events).toContainEqual({
      type: 'ui_event',
      event: { type: 'ui', action: 'open_explanation', slug: SLUG },
    });
    const list = await value<{ versions: { id: string; latest: boolean }[] }>('explanations:list', {
      slug: SLUG,
    });
    expect(list.versions).toHaveLength(1);
    expect(list.versions[0]!.latest).toBe(true);
    const pageOut = await value<{ html: string; version: string }>('explanations:page', {
      slug: SLUG,
    });
    expect(pageOut.version).toBe(list.versions[0]!.id);
    expect(pageOut.html).toContain(`<h1>${practice.teaching.summary(SLUG).title}</h1>`);
    expect(await value('explanations:viewed', { slug: SLUG })).toEqual({
      slug: SLUG,
      attempt_marked_explained: true,
    });
    expect(await invoke('explanations:page', { slug: 'first-unique-char' })).toMatchObject({
      ok: false,
      error: { reason: 'not_found' },
    });
  });

  it('a malformed explanation is reported to the model, not written', async () => {
    await make([
      [{ tool: 'render_explanation', input: { content: { ...content, pitfalls: [] } } }],
    ]);
    const { events } = await send({ thread: SLUG, action: 'explain' });
    expect(events.find((e) => e.type === 'tool_end')).toMatchObject({ ok: false });
    expect(await tutor.explanations.versions(SLUG)).toEqual([]);
  });

  it('keeps the newest versions, newest first, with distinct ids', async () => {
    const store = new ExplanationStore(
      join(dataDir, 'ex'),
      () => new Date('2026-11-19T10:00:00.000Z'),
    );
    const ids: string[] = [];
    for (let i = 0; i < KEEP + 3; i++) ids.push(await store.save(SLUG, `<p>${i}</p>`));
    expect(new Set(ids).size).toBe(ids.length);
    const kept = await store.versions(SLUG);
    expect(kept).toHaveLength(KEEP);
    expect(kept[0]).toBe(ids.at(-1));
    expect((await store.read(SLUG))!.html).toBe(`<p>${KEEP + 2}</p>`);
    expect((await readdir(join(dataDir, 'ex', SLUG))).filter((n) => n.endsWith('.tmp'))).toEqual(
      [],
    );
    expect((await store.list(SLUG))[0]).toEqual({
      id: ids.at(-1),
      created_at: '2026-11-19T10:00:00Z',
      latest: true,
    });
    await expect(store.read(SLUG, '../../etc')).rejects.toThrow(/invalid version/);
    await expect(store.save('../x', 'x')).rejects.toThrow(/invalid slug/);
  });
});
