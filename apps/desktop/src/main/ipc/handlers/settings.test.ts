/**
 * Settings and onboarding over IPC (T09) with the app's real pieces: a data
 * folder on disk (`tutor.db`, `settings.json`), the keychain store over a
 * test cipher, the tutor from `openTutor`, the curated content. Nothing
 * calls an AI provider: the connection test's probe is a fake.
 *
 * Covers the acceptance checks: model, effort and theme apply at once, and a
 * stored key never appears in an IPC reply, the logs, the database,
 * settings.json, an export, or any other file in the data folder.
 */
import { readdirSync, readFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import type { Turn } from '@algorithm-tutor/core';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  curatedProblems,
  ScriptedExecutor,
} from '../../../../../../packages/core/src/teaching/test-support';
import type { IpcResult } from '../../../shared/ipc';
import { DataService, type DataUi } from '../../data';
import { FileCatalog } from '../../practice/catalog';
import { FileWorkspace } from '../../practice/file-workspace';
import { Practice } from '../../practice/service';
import { FAKE_KEY, testCrypto } from '../../secrets/testing';
import { SecretStore } from '../../secrets';
import { openAppStorage, type AppStorage } from '../../storage';
import { AnthropicBackend, DEFAULT_MODEL, openTutor, type AppTutor } from '../../tutor';
import { IpcRouter } from '../router';
import { FakeIpcMain, page } from '../testing';
import { followTheme, profilePairs, registerSettingsHandlers } from './settings';
import { registerTutorHandlers } from './tutor';

const CONTENT = fileURLToPath(new URL('../../../../../../content/', import.meta.url));
const now = (): string => '2026-11-19T10:00:00.000Z';

let dataDir: string;
let app: AppStorage;
let secrets: SecretStore;
let tutor: AppTutor;
let ipc: FakeIpcMain;
let ui: DataUi;
let probe: ReturnType<
  typeof vi.fn<(key: string, model: string, signal?: AbortSignal) => Promise<void>>
>;
const replies: unknown[] = [];
const logged: string[] = [];

async function call<T = unknown>(channel: string, payload?: unknown): Promise<T> {
  const r = (await ipc.invoke(page().event, channel, payload)) as IpcResult<T>;
  replies.push(r);
  if (!r.ok) throw Object.assign(new Error(r.error.message), r.error);
  return r.value;
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'algotutor-settings-'));
  app = openAppStorage(dataDir);
  const catalog = await FileCatalog.open({ content: CONTENT, dataDir }, now, app.storage);
  const practice = new Practice({
    storage: app.storage,
    catalog,
    workspace: new FileWorkspace(app.paths.workspace),
    executorFor: (l) => (l === 'python' ? executor : null),
    timeScale: () => app.settings.get().execution.timeScale,
    now,
  });
  const executor = new ScriptedExecutor(await curatedProblems());
  secrets = await SecretStore.open(app.paths.secrets, testCrypto(), {});
  const log = (m: string, e?: unknown) => logged.push(`${m} ${String(e ?? '')}`);
  tutor = await openTutor({
    practice,
    settings: () => app.settings.get(),
    apiKey: () => secrets.apiKey(),
    contentDir: CONTENT,
    explanationsDir: app.paths.explanations,
    env: {},
    now,
    log,
  });
  type Probe = (key: string, model: string, signal?: AbortSignal) => Promise<void>;
  probe = vi.fn<Probe>(() => Promise.resolve());
  const anthropic = new AnthropicBackend({
    apiKey: () => secrets.apiKey(),
    model: () => app.settings.get().tutor.model,
    effort: () => app.settings.get().tutor.effort,
    probe,
    log: (m) => logged.push(m),
  });
  ui = {
    chooseExportPath: () => Promise.resolve(`${dataDir}-export.zip`),
    chooseImportFile: () => Promise.resolve(null),
    confirm: () => Promise.resolve(true),
    openFolder: () => Promise.resolve(true),
    restart: () => {},
  };
  ipc = new FakeIpcMain();
  const router = new IpcRouter(ipc, {
    isTrustedUrl: (u) => u.startsWith('tutor-app://app/'),
    onError: (c, e) => logged.push(`ipc ${c}: ${String(e)}`),
  });
  registerTutorHandlers(router, { tutor, practice });
  registerSettingsHandlers(router, {
    settings: app.settings,
    secrets,
    anthropic,
    defaultModel: DEFAULT_MODEL,
    practice,
    data: new DataService({ paths: app.paths, storage: app.storage, appVersion: '0.1.0', now, ui }),
  });
  replies.length = 0;
  logged.length = 0;
});

afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(`${dataDir}-export.zip`, { force: true });
});

const turn = (): Turn => ({
  threadId: 'home',
  systemPrompt: tutor.systemPrompt,
  history: [],
  userText: 'hi',
  context: {},
  tools: tutor.tools,
  backendState: {},
});

describe('settings apply at once', () => {
  it('model and effort reach the next request; an empty model means the default', async () => {
    await call('secrets:set-key', { key: FAKE_KEY });
    expect(tutor.anthropic.requestParams(turn(), []).model).toBe(DEFAULT_MODEL);
    expect(tutor.anthropic.requestParams(turn(), []).output_config).toEqual({ effort: 'medium' });

    const r = await call<{ settings: { tutor: unknown } }>('settings:set', {
      tutor: { model: 'claude-sonnet-5-5', effort: 'high' },
    });
    expect(r.settings.tutor).toEqual({
      backend: 'auto',
      model: 'claude-sonnet-5-5',
      effort: 'high',
    });
    const p = tutor.anthropic.requestParams(turn(), []);
    expect(p.model).toBe('claude-sonnet-5-5');
    expect(p.output_config).toEqual({ effort: 'high' });
    expect((await call<{ model: string }>('tutor:status')).model).toBe('claude-sonnet-5-5');
    expect(JSON.parse(readFileSync(app.paths.settings, 'utf8')).tutor).toMatchObject({
      model: 'claude-sonnet-5-5',
      effort: 'high',
    });

    await call('settings:set', { tutor: { model: '  ' } });
    expect(tutor.anthropic.requestParams(turn(), []).model).toBe(DEFAULT_MODEL);
  });

  it('the backend choice applies at once', async () => {
    await call('secrets:set-key', { key: FAKE_KEY });
    expect((await call<{ available: boolean }>('tutor:status')).available).toBe(true);
    await call('settings:set', { tutor: { backend: 'none' } });
    expect(await call('tutor:status')).toMatchObject({ backend: 'none', available: false });
  });

  it('the theme follows the setting', async () => {
    const native = { themeSource: 'system' as 'system' | 'light' | 'dark' };
    const stop = followTheme(app.settings, native);
    await call('settings:set', { ui: { theme: 'dark' } });
    expect(native.themeSource).toBe('dark');
    await call('settings:set', { editor: { fontSize: 20 } });
    expect(native.themeSource).toBe('dark');
    stop();
  });

  it('refuses invalid values and changes nothing', async () => {
    await expect(call('settings:set', { editor: { fontSize: 99 } })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(call('settings:set', { tutor: { effort: 'max' } })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect((await call<{ settings: { editor: unknown } }>('settings:get')).settings.editor).toEqual(
      {
        fontSize: 14,
        keymap: 'default',
      },
    );
  });
});

describe('the connection test', () => {
  it('says when there is no key, and does not call the API', async () => {
    const r = await call('tutor:test');
    expect(r).toMatchObject({ ok: false, kind: 'no_key' });
    expect(probe).not.toHaveBeenCalled();
  });

  it('probes with the key in use and the configured model', async () => {
    await call('secrets:set-key', { key: FAKE_KEY });
    await call('settings:set', { tutor: { model: 'claude-haiku-5-5' } });
    expect(await call('tutor:test')).toMatchObject({ ok: true, model: 'claude-haiku-5-5' });
    expect(probe).toHaveBeenCalledWith(FAKE_KEY, 'claude-haiku-5-5', undefined);
  });

  it('maps a rejected key to auth, and an unknown model to model', async () => {
    await call('secrets:set-key', { key: FAKE_KEY });
    const headers = new Headers();
    probe.mockRejectedValueOnce(
      new Anthropic.AuthenticationError(
        401,
        { error: { message: `bad key ${FAKE_KEY}` } },
        'x',
        headers,
      ),
    );
    const auth = await call<{ ok: boolean; kind: string; message: string }>('tutor:test');
    expect(auth).toMatchObject({ ok: false, kind: 'auth' });
    expect(auth.message).not.toContain(FAKE_KEY);
    probe.mockRejectedValueOnce(new Anthropic.NotFoundError(404, {}, 'not found', headers));
    expect(await call('tutor:test')).toMatchObject({ ok: false, kind: 'model' });
  });
});

describe('the API key never leaves main', () => {
  function filesUnder(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? filesUnder(p) : [p];
    });
  }

  it('is not in any reply, log line, file in the data folder, or the export', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      }),
    );
    try {
      await call('secrets:set-key', { key: FAKE_KEY });
      await call('settings:set', { tutor: { effort: 'low' }, ui: { theme: 'dark' } });
      await call('profile:set', {
        goal: 'general',
        interview_date: null,
        experience: 'beginner',
        comfort: { basics: 'some' },
        hint_preference: 'early',
        focus_topic: null,
      });
      for (const ch of [
        'secrets:status',
        'settings:get',
        'tutor:status',
        'tutor:test',
        'data:info',
      ])
        await call(ch);
      const { path } = await call<{ path: string }>('data:export');
      await call('data:reset', { scope: 'progress' });
      // The key that was stored is the key in use.
      expect(secrets.apiKey()).toBe(FAKE_KEY);

      const needles = [FAKE_KEY, FAKE_KEY.slice(8, -4)];
      const haystacks: [string, string][] = [
        ['replies', JSON.stringify(replies)],
        ['logs', logged.join('\n')],
      ];
      for (const f of filesUnder(dataDir)) haystacks.push([f, readFileSync(f).toString('latin1')]);
      for (const [name, data] of Object.entries(unzipSync(readFileSync(path))))
        haystacks.push([`export:${name}`, strFromU8(data, true)]);
      expect(haystacks.length).toBeGreaterThan(5);
      expect(haystacks.map(([n]) => n).some((n) => n.endsWith('tutor.db'))).toBe(true);
      expect(haystacks.map(([n]) => n).some((n) => n.endsWith('secrets.bin'))).toBe(true);
      for (const [name, text] of haystacks)
        for (const needle of needles) expect(text.includes(needle), name).toBe(false);
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
});

describe('profile:set', () => {
  it('saves the questionnaire and marks the learner onboarded', async () => {
    const r = await call<{ onboarded: boolean; profile: Record<string, unknown> }>('profile:set', {
      goal: 'interview',
      interview_date: '2027-01-15',
      experience: 'advanced',
      comfort: { basics: 'solid', linear: 'some' },
      hint_preference: 'struggle',
      focus_topic: 'hashing',
    });
    expect(r.onboarded).toBe(true);
    expect(r.profile).toMatchObject({
      goal: 'interview',
      interview_date: '2027-01-15',
      experience: 'advanced',
      hint_preference: 'struggle',
      focus_topic: 'hashing',
    });
    expect(r.profile.comfort).toMatchObject({ basics: 'solid', linear: 'some' });
  });

  it('refuses an unknown topic or group with a reason', async () => {
    const base = {
      goal: 'general',
      interview_date: null,
      experience: 'beginner',
      comfort: {},
      hint_preference: 'early',
      focus_topic: null,
    };
    await expect(call('profile:set', { ...base, focus_topic: 'nope' })).rejects.toMatchObject({
      code: 'refused',
    });
    await expect(call('profile:set', { ...base, comfort: { nope: 'some' } })).rejects.toMatchObject(
      {
        code: 'refused',
      },
    );
  });

  it('drops the interview date for general practice', () => {
    expect(
      profilePairs({
        goal: 'general',
        interview_date: '2027-01-15',
        experience: 'beginner',
        comfort: { basics: 'none' },
        hint_preference: 'early',
        focus_topic: null,
      }),
    ).toMatchObject({ interview_date: null, 'comfort.basics': 'none' });
  });
});
