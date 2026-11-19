/**
 * The updater service (T13) over a fake electron-updater: settings drive the
 * pre-release and download flags, events become states, automatic checks
 * follow the setting, and "Restart to update" needs a downloaded update.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateState } from '../../shared/updates';
import { updateState } from '../../shared/updates';
import { UpdateService, type UpdateSettings, type UpdaterLike } from './service';

class FakeUpdater implements UpdaterLike {
  private readonly listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  autoDownload = true;
  autoInstallOnAppQuit = false;
  allowPrerelease = false;
  checks = 0;
  downloads = 0;
  installs: [boolean | undefined, boolean | undefined][] = [];
  /** What the next check does. */
  next: (u: FakeUpdater) => void = (u) => u.emit('update-not-available', { version: '1.0.0' });

  checkForUpdates(): Promise<unknown> {
    this.checks += 1;
    this.emit('checking-for-update');
    this.next(this);
    return Promise.resolve(null);
  }
  downloadUpdate(): Promise<unknown> {
    this.downloads += 1;
    return Promise.resolve([]);
  }
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    this.installs.push([isSilent, isForceRunAfter]);
  }
  on(event: string, listener: (...args: never[]) => void): this {
    const list = this.listeners.get(event) ?? [];
    list.push(listener as (...args: unknown[]) => void);
    this.listeners.set(event, list);
    return this;
  }
  emit(event: string, ...args: unknown[]): void {
    for (const l of this.listeners.get(event) ?? []) l(...args);
  }
}

function settingsSource(initial: UpdateSettings) {
  let current = initial;
  const listeners = new Set<(c: { changed: readonly string[] }) => void>();
  return {
    get: () => ({ updates: current }),
    onChange: (l: (c: { changed: readonly string[] }) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    set(next: Partial<UpdateSettings>) {
      const changed = Object.keys(next).map((k) => `updates.${k}`);
      current = { ...current, ...next };
      for (const l of listeners) l({ changed });
    },
  };
}

const NOW = '2026-11-19T10:00:00.000Z';

function setup(initial: UpdateSettings = { channel: 'stable', auto: true }) {
  const updater = new FakeUpdater();
  const settings = settingsSource(initial);
  const service = new UpdateService({
    updater,
    settings,
    now: () => NOW,
    firstCheckMs: 1000,
    intervalMs: 10_000,
  });
  const seen: UpdateState[] = [];
  service.subscribe((s) => seen.push(updateState.parse(s)));
  return { updater, settings, service, seen };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('UpdateService', () => {
  it('is unsupported without an updater, and every action is a no-op', async () => {
    const service = new UpdateService({
      updater: null,
      unsupportedReason: 'development build',
      settings: settingsSource({ channel: 'stable', auto: true }),
      now: () => NOW,
    });
    service.start();
    expect(service.state()).toEqual({ state: 'unsupported', reason: 'development build' });
    expect(await service.check()).toEqual(service.state());
    expect(await service.download()).toEqual(service.state());
    expect(service.restart()).toBe(false);
  });

  it('maps the channel to pre-releases and the auto setting to background downloads', () => {
    const { updater, settings, service } = setup({ channel: 'stable', auto: true });
    expect(updater.allowPrerelease).toBe(false);
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    service.start();
    settings.set({ channel: 'beta' });
    expect(updater.allowPrerelease).toBe(true);
    settings.set({ auto: false });
    expect(updater.autoDownload).toBe(false);
    service.stop();
  });

  it('reports up to date', async () => {
    const { service, seen } = setup();
    expect(service.state()).toEqual({ state: 'idle' });
    await service.check();
    expect(seen.map((s) => s.state)).toEqual(['checking', 'checking', 'none']);
    expect(service.state()).toEqual({ state: 'none', checkedAt: NOW });
  });

  it('downloads in the background, then offers "Restart to update"', async () => {
    const { updater, service } = setup({ channel: 'stable', auto: true });
    updater.next = (u) => u.emit('update-available', { version: '1.1.0' });
    await service.check();
    expect(service.state()).toEqual({ state: 'downloading', version: '1.1.0', percent: 0 });
    updater.emit('download-progress', { percent: 42.4 });
    expect(service.state()).toEqual({ state: 'downloading', version: '1.1.0', percent: 42 });
    expect(service.restart()).toBe(false);
    updater.emit('update-downloaded', { version: '1.1.0' });
    expect(service.state()).toEqual({ state: 'downloaded', version: '1.1.0' });
    // A later check keeps the downloaded update.
    await service.check();
    expect(updater.checks).toBe(1);
    // An error afterwards does not hide it either.
    updater.emit('error', new Error('network down'));
    expect(service.state().state).toBe('downloaded');
    expect(service.restart()).toBe(true);
    expect(updater.installs).toEqual([[false, true]]);
  });

  it('with automatic updates off, downloads only when asked', async () => {
    const { updater, service } = setup({ channel: 'beta', auto: false });
    updater.next = (u) => u.emit('update-available', { version: '1.1.0-beta.2' });
    await service.check();
    expect(service.state()).toEqual({ state: 'available', version: '1.1.0-beta.2' });
    expect(updater.downloads).toBe(0);
    expect(await service.download()).toEqual({
      state: 'downloading',
      version: '1.1.0-beta.2',
      percent: 0,
    });
    expect(updater.downloads).toBe(1);
    // A second click while downloading does nothing.
    await service.download();
    expect(updater.downloads).toBe(1);
  });

  it('turns a failed check into an error state with the first line of the message', async () => {
    const { updater, service } = setup();
    updater.checkForUpdates = () =>
      Promise.reject(new Error('net::ERR_INTERNET_DISCONNECTED\nstack'));
    await service.check();
    expect(service.state()).toEqual({ state: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' });
    // electron-updater also emits `error`.
    updater.emit('error', new Error('HttpError: 404'));
    expect(service.state()).toEqual({ state: 'error', message: 'HttpError: 404' });
  });

  it('checks soon after start and then periodically, only while automatic updates are on', async () => {
    const { updater, settings, service } = setup({ channel: 'stable', auto: true });
    service.start();
    await vi.advanceTimersByTimeAsync(999);
    expect(updater.checks).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(updater.checks).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(updater.checks).toBe(2);
    settings.set({ auto: false });
    await vi.advanceTimersByTimeAsync(100_000);
    expect(updater.checks).toBe(2);
    settings.set({ auto: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(updater.checks).toBe(3);
    service.stop();
    await vi.advanceTimersByTimeAsync(100_000);
    expect(updater.checks).toBe(3);
  });
});
