// @vitest-environment jsdom
/**
 * Settings → Code execution (T18): each detection state, only running
 * runtimes selectable, Recheck, How to install → links, start hints, the
 * fallback notice, Pull / Update with progress, Test sandbox.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { RuntimesView } from '../../../shared/settings';
import { Toasts } from '../components/Toasts';
import { AppProvider } from '../lib/app';
import { FakeBridge, installBridge, Refused } from '../test/fake-bridge';
import { baseHandlers } from '../test/fixtures';
import { ExecutionSection } from './SettingsCodeExecution';

const IMAGE = 'ghcr.io/hqazi/algo-runner:0.1.0';
type Row = RuntimesView['runtimes'][number];

function row(runtime: Row['runtime'], state: Row['state'], extra: Partial<Row> = {}): Row {
  return {
    runtime,
    state,
    version: null,
    path: null,
    endpoint: null,
    reason: null,
    start_hint: null,
    image: { name: IMAGE, present: null },
    ...extra,
  };
}

const RUNNING_DOCKER = row('docker', 'running', {
  version: '29.1.0',
  path: '/usr/bin/docker',
  endpoint: 'desktop-linux',
  image: { name: IMAGE, present: true },
});
const STOPPED_PODMAN = row('podman', 'installed-not-running', {
  path: '/usr/bin/podman',
  reason: 'Cannot connect to Podman socket',
  start_hint: 'podman machine start',
});

function view(runtimes: Row[], extra: Partial<RuntimesView> = {}): RuntimesView {
  return {
    selected: 'local',
    toolchains: [
      {
        language: 'rust',
        tool: 'cargo',
        found: true,
        version: '1.90.0',
        path: '/c/cargo',
        reason: null,
      },
      { language: 'go', tool: 'go', found: false, version: null, path: null, reason: 'not found' },
    ],
    runtimes,
    notice: null,
    ...extra,
  };
}

function bridgeWith(...views: RuntimesView[]): FakeBridge {
  let i = 0;
  return baseHandlers(new FakeBridge())
    .on('exec:status', () => ({
      python: { available: true, reason: null, versions: { pyodide: '314.0.7' } },
    }))
    .on('exec:runtimes', () => views[Math.min(i++, views.length - 1)]!)
    .on('exec:install-help', () => ({ opened: true }))
    .on('exec:test', () => ({
      ok: false,
      checks: [
        { language: 'rust', ok: true, message: 'Rust: hello world passed (4.0 s, build included)' },
        { language: 'go', ok: false, message: 'Go: the build failed' },
      ],
    }));
}

function renderSection(bridge: FakeBridge) {
  installBridge(bridge);
  render(
    <AppProvider>
      <ExecutionSection />
      <Toasts />
    </AppProvider>,
  );
}

const radio = (name: RegExp) => screen.getByRole('radio', { name }) as HTMLInputElement;
const calls = (b: FakeBridge, channel: string) =>
  b.calls.filter((c) => c.channel === channel).map((c) => c.request);

afterEach(cleanup);

describe('Settings → Code execution', () => {
  it('not found: the runtime is disabled and links to How to install', async () => {
    const b = bridgeWith(view([row('podman', 'not-found'), row('docker', 'not-found')]));
    renderSection(b);
    const podman = await screen.findByTestId('runtime-podman');
    expect(within(podman).getByText('(Not found)')).toBeTruthy();
    expect(radio(/Podman/).disabled).toBe(true);
    expect(radio(/Docker/).disabled).toBe(true);
    expect(radio(/Local toolchains/).disabled).toBe(false);
    expect(radio(/Local toolchains/).checked).toBe(true);
    fireEvent.click(within(podman).getByRole('button', { name: 'How to install →' }));
    await waitFor(() => expect(calls(b, 'exec:install-help')).toEqual([{ topic: 'container' }]));
    expect(within(podman).queryByText(/Pull image/)).toBeNull();
  });

  it('installed but not running: disabled, with the command that starts it', async () => {
    renderSection(bridgeWith(view([STOPPED_PODMAN, row('docker', 'not-found')])));
    const podman = await screen.findByTestId('runtime-podman');
    expect(within(podman).getByText('(Installed, not running)')).toBeTruthy();
    expect(within(podman).getByText('podman machine start').tagName).toBe('CODE');
    expect(within(podman).getByText('Cannot connect to Podman socket')).toBeTruthy();
    expect(radio(/Podman/).disabled).toBe(true);
    expect(within(podman).queryByRole('button', { name: /Test sandbox/ })).toBeNull();
  });

  it('running: selectable, shows version, endpoint, image and its tools', async () => {
    const b = bridgeWith(view([STOPPED_PODMAN, RUNNING_DOCKER]));
    renderSection(b);
    const docker = await screen.findByTestId('runtime-docker');
    expect(within(docker).getByText('(Running · 29.1.0 · desktop-linux)')).toBeTruthy();
    expect(within(docker).getByText(IMAGE)).toBeTruthy();
    expect(within(docker).getByText(/on this computer/)).toBeTruthy();
    expect(within(docker).getByRole('button', { name: 'Update image (Docker)' })).toBeTruthy();
    expect(radio(/Docker/).disabled).toBe(false);
    fireEvent.click(radio(/Docker/));
    await waitFor(() =>
      expect(calls(b, 'settings:set')).toEqual([{ execution: { runtime: 'docker' } }]),
    );
    await waitFor(() => expect(radio(/Docker/).checked).toBe(true));
    fireEvent.click(radio(/Podman/));
    expect(calls(b, 'settings:set')).toHaveLength(1);
  });

  it('a refused choice is shown and the setting stays', async () => {
    const b = bridgeWith(view([STOPPED_PODMAN, RUNNING_DOCKER])).on('settings:set', () => {
      throw new Refused(
        'runtime_not_running',
        'Cannot use docker: docker is installed but not running.',
      );
    });
    renderSection(b);
    await screen.findByTestId('runtime-docker');
    fireEvent.click(radio(/Docker/));
    expect(
      await screen.findByText('Cannot use docker: docker is installed but not running.'),
    ).toBeTruthy();
    expect(radio(/Local toolchains/).checked).toBe(true);
  });

  it('local toolchains: versions, a missing one links to How to install, and no-sandbox wording', async () => {
    const b = bridgeWith(view([row('podman', 'not-found'), row('docker', 'not-found')]));
    renderSection(b);
    const local = await screen.findByTestId('runtime-local');
    expect(local.textContent).toContain('cargo: 1.90.0');
    expect(local.textContent).toMatch(/go: not found/);
    expect(local.textContent).toMatch(/No sandbox: your code runs as you/);
    fireEvent.click(within(local).getByRole('button', { name: 'How to install →' }));
    await waitFor(() => expect(calls(b, 'exec:install-help')).toEqual([{ topic: 'toolchains' }]));
  });

  it('Recheck detects again, forgetting the cached toolchains', async () => {
    const b = bridgeWith(
      view([STOPPED_PODMAN, row('docker', 'not-found')]),
      view([
        row('podman', 'running', { version: '5.2.0', path: '/p' }),
        row('docker', 'not-found'),
      ]),
    );
    renderSection(b);
    await screen.findByText('(Installed, not running)');
    expect(radio(/Podman/).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Recheck runtimes' }));
    expect(await screen.findByText('(Running · 5.2.0)')).toBeTruthy();
    expect(radio(/Podman/).disabled).toBe(false);
    expect(calls(b, 'exec:runtimes')).toEqual([{ recheck: false }, { recheck: true }]);
    expect(screen.getByRole('button', { name: 'Pull image (Podman)' })).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Test sandbox (Podman)' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('shows the fallback notice, and that a stopped choice runs locally', async () => {
    const b = bridgeWith(
      view([STOPPED_PODMAN, row('docker', 'not-found')], {
        selected: 'podman',
        notice: 'podman is installed but not running; running with the local toolchains instead',
      }),
    );
    b.on('settings:get', () => ({
      settings: {
        tutor: { backend: 'auto', model: null, effort: 'medium', claudeCodePath: null },
        execution: { runtime: 'podman', timeScale: 1 },
        editor: { fontSize: 14, keymap: 'default' },
        ui: { theme: 'system', leader: 'ctrl+b' },
        updates: { channel: 'stable', auto: true },
        library: { images: 'on-open', readAloudGpu: false },
      },
      issues: [],
      default_model: 'm',
    }));
    renderSection(b);
    expect((await screen.findByTestId('exec-notice')).textContent).toMatch(
      /running with the local toolchains instead/,
    );
    expect(
      await screen.findByText(
        'Podman is not running, so Rust and Go run with the local toolchains.',
      ),
    ).toBeTruthy();
  });

  it('Pull streams progress, can be cancelled, and re-detects after', async () => {
    const b = bridgeWith(
      view([
        STOPPED_PODMAN,
        row('docker', 'running', { path: '/d', image: { name: IMAGE, present: false } }),
      ]),
      view([STOPPED_PODMAN, RUNNING_DOCKER]),
    );
    renderSection(b);
    expect(await screen.findByText(/not pulled yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pull image (Docker)' }));
    await waitFor(() => expect(b.streams).toHaveLength(1));
    const s = b.streams[0]!;
    expect(s.channel).toBe('exec:pull');
    expect(s.request).toEqual({ runtime: 'docker' });
    act(() => s.emit({ line: 'a1b2c3d4e5f6: Downloading', layers: { done: 1, total: 3 } }));
    expect((await screen.findByTestId('pull-progress')).textContent).toBe(
      'Layers 1/3 · a1b2c3d4e5f6: Downloading',
    );
    act(() => s.finish({ ok: true, message: `pulled ${IMAGE}` }));
    expect(await screen.findByText(`Done: pulled ${IMAGE}`)).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Update image (Docker)' })).toBeTruthy();
    expect(calls(b, 'exec:runtimes')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Update image (Docker)' }));
    await waitFor(() => expect(b.streams).toHaveLength(2));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel pull' }));
    expect(b.streams[1]!.cancelled).toBe(true);
    expect(await screen.findByText(/Pull failed: /)).toBeTruthy();
  });

  it('Test sandbox shows one line per language', async () => {
    const b = bridgeWith(view([STOPPED_PODMAN, RUNNING_DOCKER]));
    renderSection(b);
    fireEvent.click(await screen.findByRole('button', { name: 'Test sandbox (Docker)' }));
    const result = await screen.findByTestId('sandbox-result');
    expect(calls(b, 'exec:test')).toEqual([{ runtime: 'docker' }]);
    expect(result.textContent).toContain('Rust: hello world passed (4.0 s, build included)');
    expect(within(result).getByText('Go: the build failed').className).toBe('error-text');
  });
});
