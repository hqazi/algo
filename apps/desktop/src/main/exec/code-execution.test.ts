/**
 * Settings → Code execution in main (T18): the detection view per state, the
 * image check only for running runtimes, Recheck, the "only running
 * runtimes" rule, the fallback notice, Test sandbox, and the IPC channels.
 * The hello-world job is run for real with the local toolchains (when found)
 * and in real Docker (when `ALGOTUTOR_TEST_RUNNER_IMAGE` names a local image).
 */
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RunJob, RunReport } from '@algo/core';
import { STREAM_START, type IpcResult } from '../../shared/ipc';
import { pullEvent, runtimesView, sandboxResult } from '../../shared/settings';
import { INSTALL_HELP, registerCodeExecutionHandlers } from '../ipc/handlers/code-execution';
import { IpcRouter } from '../ipc/router';
import { FakeIpcMain, page } from '../ipc/testing';
import type { Runtime, RuntimeStatus } from '../runtimes';
import {
  CodeExecution,
  describeCheck,
  helloJob,
  type CodeExecutionOptions,
} from './code-execution';
import { ContainerExecutor } from './container';
import { LocalExecutor } from './local';
import type { ToolchainStatus } from './local/detect';

const RUNNERS = fileURLToPath(new URL('../../../../../content/runners/', import.meta.url));
const IMAGE = 'example.test/runner:1.2.3';

const STATES: Record<Runtime, RuntimeStatus> = {
  podman: {
    runtime: 'podman',
    state: 'installed-not-running',
    path: '/usr/bin/podman',
    version: '5.0.0',
    reason: 'Cannot connect to Podman',
    startHint: 'podman machine start',
  },
  docker: {
    runtime: 'docker',
    state: 'running',
    path: '/usr/bin/docker',
    version: '29.1.0',
    endpoint: 'unix:///var/run/docker.sock',
  },
};

const TOOLCHAINS: ToolchainStatus[] = [
  { tool: 'cargo', found: true, path: '/home/u/.cargo/bin/cargo', version: '1.90.0' },
  { tool: 'go', found: false, reason: 'go was not found' },
];

function pass(job: RunJob): RunReport {
  return {
    ok: true,
    results: [{ id: job.tests[0]!.id, visibility: 'visible', status: 'pass' }],
    durationMs: 1500,
  };
}

function fakes(over: { states?: Partial<Record<Runtime, RuntimeStatus>>; image?: boolean } = {}) {
  const states = { ...STATES, ...over.states };
  const local = { toolchains: vi.fn(() => Promise.resolve(TOOLCHAINS)), recheck: vi.fn() };
  const hasImage = vi.fn(() => Promise.resolve(over.image ?? true));
  const pull = vi.fn((onProgress?: (p: { line: string }) => void) => {
    onProgress?.({ line: 'abc: Pulling fs layer' });
    return Promise.resolve({ ok: true, message: `pulled ${IMAGE}` });
  });
  const jobs: RunJob[] = [];
  const sandboxFor = vi.fn((runtime: Runtime) => ({
    runtime,
    run: (job: RunJob) => {
      jobs.push(job);
      return Promise.resolve(pass(job));
    },
  }));
  let selected: 'local' | Runtime = 'local';
  const opts: CodeExecutionOptions = {
    local,
    container: (runtime) => ({
      detect: () => Promise.resolve(states[runtime]),
      hasImage,
      pull,
      image: IMAGE,
    }),
    sandbox: sandboxFor,
    selected: () => selected,
  };
  return {
    ce: new CodeExecution(opts),
    local,
    hasImage,
    pull,
    jobs,
    sandboxFor,
    select: (r: 'local' | Runtime) => (selected = r),
  };
}

describe('CodeExecution', () => {
  it('reports each runtime state and the toolchains, checking the image only when running', async () => {
    const f = fakes({ states: { podman: { runtime: 'podman', state: 'not-found' } } });
    const v = await f.ce.view();
    expect(runtimesView.parse(v)).toEqual(v);
    expect(v.selected).toBe('local');
    expect(v.toolchains).toEqual([
      {
        language: 'rust',
        tool: 'cargo',
        found: true,
        version: '1.90.0',
        path: '/home/u/.cargo/bin/cargo',
        reason: null,
      },
      {
        language: 'go',
        tool: 'go',
        found: false,
        version: null,
        path: null,
        reason: 'go was not found',
      },
    ]);
    expect(v.runtimes).toEqual([
      {
        runtime: 'podman',
        state: 'not-found',
        version: null,
        path: null,
        endpoint: null,
        reason: null,
        start_hint: null,
        image: { name: IMAGE, present: null },
      },
      {
        runtime: 'docker',
        state: 'running',
        version: '29.1.0',
        path: '/usr/bin/docker',
        endpoint: 'unix:///var/run/docker.sock',
        reason: null,
        start_hint: null,
        image: { name: IMAGE, present: true },
      },
    ]);
    expect(f.hasImage).toHaveBeenCalledTimes(1);
    expect(f.hasImage).toHaveBeenCalledWith('/usr/bin/docker');
  });

  it('shows a stopped runtime with its start command and reason', async () => {
    const v = await fakes().ce.view();
    expect(v.runtimes[0]).toMatchObject({
      runtime: 'podman',
      state: 'installed-not-running',
      start_hint: 'podman machine start',
      reason: 'Cannot connect to Podman',
      image: { present: null },
    });
  });

  it('reports a missing image', async () => {
    const v = await fakes({ image: false }).ce.view();
    expect(v.runtimes[1]!.image.present).toBe(false);
  });

  it('Recheck forgets the cached toolchain detection; opening does not', async () => {
    const f = fakes();
    await f.ce.view();
    expect(f.local.recheck).not.toHaveBeenCalled();
    await f.ce.view(true);
    expect(f.local.recheck).toHaveBeenCalledTimes(1);
  });

  it('lets only running runtimes be chosen', async () => {
    const f = fakes({ states: { podman: { runtime: 'podman', state: 'not-found' } } });
    expect(await f.ce.refusal('local')).toBeNull();
    expect(await f.ce.refusal('docker')).toBeNull();
    expect(await f.ce.refusal('podman')).toMatch(/not found/);
    expect(await fakes().ce.refusal('podman')).toMatch(/installed but not running/);
  });

  it('keeps the fallback notice while the chosen runtime is down, and drops it after', async () => {
    const f = fakes();
    f.select('podman');
    f.ce.notice('podman is installed but not running; running with the local toolchains instead');
    expect((await f.ce.view()).notice).toMatch(/running with the local toolchains/);
    f.select('docker');
    expect((await f.ce.view()).notice).toBeNull();
  });

  it('Test sandbox runs hello world in Rust and Go in the container executor without fallback', async () => {
    const f = fakes();
    const r = await f.ce.test('docker');
    expect(f.sandboxFor).toHaveBeenCalledWith('docker');
    expect(f.jobs.map((j) => j.language)).toEqual(['rust', 'go']);
    expect(r.ok).toBe(true);
    expect(r.checks.map((c) => c.message)).toEqual([
      'Rust: hello world passed (1.5 s, build included)',
      'Go: hello world passed (1.5 s, build included)',
    ]);
  });

  it('describes failed checks', () => {
    expect(
      describeCheck('go', {
        ok: false,
        error: { kind: 'runtime-missing', message: 'the runner image x is not on this machine' },
        results: [],
        durationMs: 3,
      }),
    ).toEqual({
      language: 'go',
      ok: false,
      message: 'Go: the runner image x is not on this machine',
    });
    expect(
      describeCheck('rust', {
        ok: true,
        results: [{ id: 'hello', visibility: 'visible', status: 'fail' }],
        durationMs: 3,
      }).message,
    ).toBe('Rust: hello world did not pass (fail)');
  });
});

describe('IPC', () => {
  function setup() {
    const f = fakes();
    const ipc = new FakeIpcMain();
    const router = new IpcRouter(ipc, { isTrustedUrl: (u) => u.startsWith('tutor-app://app/') });
    const opened: string[] = [];
    registerCodeExecutionHandlers(router, {
      codeExecution: f.ce,
      openExternal: (url) => {
        opened.push(url);
        return Promise.resolve(true);
      },
    });
    const call = async (channel: string, payload?: unknown) =>
      (await ipc.invoke(page().event, channel, payload)) as IpcResult<unknown>;
    return { f, ipc, call, opened };
  }

  it('exec:runtimes and exec:test answer within their schemas', async () => {
    const { call, f } = setup();
    const r = await call('exec:runtimes', { recheck: true });
    expect(r.ok).toBe(true);
    expect(f.local.recheck).toHaveBeenCalled();
    const t = await call('exec:test', { runtime: 'docker' });
    expect(t.ok && sandboxResult.parse(t.value).ok).toBe(true);
    expect((await call('exec:test', { runtime: 'local' })).ok).toBe(false);
  });

  it('exec:install-help opens only the fixed install guide sections', async () => {
    const { call, opened } = setup();
    expect(await call('exec:install-help', { topic: 'container' })).toEqual({
      ok: true,
      value: { opened: true },
    });
    await call('exec:install-help', { topic: 'toolchains' });
    expect(opened).toEqual([INSTALL_HELP.container, INSTALL_HELP.toolchains]);
    expect((await call('exec:install-help', { url: 'https://evil.test' })).ok).toBe(false);
  });

  it('exec:pull streams progress lines, then the outcome', async () => {
    const { ipc, f } = setup();
    const p = page();
    await ipc.invoke(p.event, STREAM_START, {
      id: 's1',
      channel: 'exec:pull',
      request: { runtime: 'docker' },
    });
    await vi.waitFor(() => expect(p.results()).toHaveLength(1));
    const events = p.events().map((e) => (e as { event: unknown }).event);
    expect(events).toEqual([{ line: 'abc: Pulling fs layer', layers: null }]);
    for (const e of events) pullEvent.parse(e);
    expect(p.results()[0]).toMatchObject({
      result: { ok: true, value: { ok: true, message: `pulled ${IMAGE}` } },
    });
    expect(f.pull).toHaveBeenCalledTimes(1);
  });
});

// ------------------------------------------------- the hello-world job for real

const has = (bin: string, arg: string) =>
  spawnSync(bin, [arg], { stdio: 'ignore', shell: false }).status === 0;

describe('hello world with the local toolchains', { timeout: 300_000 }, () => {
  let dir: string;
  let local: LocalExecutor;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hello-local-'));
    local = new LocalExecutor({ buildDir: dir, runnersDir: RUNNERS });
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  for (const language of ['rust', 'go'] as const) {
    it.skipIf(
      !has(language === 'rust' ? 'cargo' : 'go', language === 'rust' ? '--version' : 'version'),
    )(`${language} passes`, async () => {
      const r = await local.run(helloJob(language));
      expect(describeCheck(language, r)).toMatchObject({ ok: true });
    });
  }
});

const REAL_IMAGE = process.env['ALGOTUTOR_TEST_RUNNER_IMAGE'];
const dockerReady = (): boolean =>
  !!REAL_IMAGE &&
  spawnSync('docker', ['image', 'inspect', REAL_IMAGE], { stdio: 'ignore' }).status === 0;

describe.skipIf(!dockerReady())('Test sandbox in the real Docker', { timeout: 300_000 }, () => {
  it('passes in Rust and Go', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hello-docker-'));
    try {
      const make = (runtime: Runtime) =>
        new ContainerExecutor({ runtime, image: REAL_IMAGE!, jobsDir: dir, runnersDir: RUNNERS });
      const ce = new CodeExecution({
        local: new LocalExecutor({ buildDir: dir, runnersDir: RUNNERS }),
        container: make,
        sandbox: make,
        selected: () => 'docker',
      });
      const v = await ce.view();
      expect(v.runtimes.find((r) => r.runtime === 'docker')).toMatchObject({
        state: 'running',
        image: { present: true },
      });
      const r = await ce.test('docker');
      expect(r.checks.map((c) => c.ok)).toEqual([true, true]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
