/**
 * The app's updater (T13, SPEC §11) over electron-updater's `AppUpdater`,
 * kept behind a small interface so it is tested without Electron.
 *
 * - Channel `stable` follows GitHub's latest release; `beta` also takes
 *   pre-releases (`allowPrerelease`). The channel name is never set on the
 *   updater: doing so turns on `allowDowngrade` (DECISIONS D-27).
 * - Automatic updates on: check soon after start and every few hours,
 *   download in the background, install on quit. Off: only "Check now",
 *   then "Download" on request. Either way a downloaded update installs on
 *   quit, or now with "Restart to update".
 */
import type { UpdateState } from '../../shared/updates';

/** The part of electron-updater's `AppUpdater` used here. */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: string, listener: (...args: never[]) => void): unknown;
}

export interface UpdateSettings {
  channel: 'stable' | 'beta';
  auto: boolean;
}

export interface UpdateSettingsSource {
  get(): { updates: UpdateSettings };
  onChange(listener: (c: { changed: readonly string[] }) => void): () => void;
}

export interface UpdateServiceOptions {
  /** `null` when this build cannot update itself; `unsupportedReason` says why. */
  updater: UpdaterLike | null;
  unsupportedReason?: string;
  settings: UpdateSettingsSource;
  now: () => string;
  /** First automatic check after start. */
  firstCheckMs?: number;
  /** Then one every … */
  intervalMs?: number;
  log?: (message: string) => void;
}

export const FIRST_CHECK_MS = 30_000;
export const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

const message = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).split('\n')[0]!.slice(0, 500);

export class UpdateService {
  private current: UpdateState;
  private readonly listeners = new Set<(s: UpdateState) => void>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private unsubscribe: (() => void) | null = null;
  /** Version of the update found by the last check. */
  private found: string | null = null;

  constructor(private readonly opts: UpdateServiceOptions) {
    this.current = opts.updater
      ? { state: 'idle' }
      : { state: 'unsupported', reason: opts.unsupportedReason ?? 'This build does not update.' };
    const u = opts.updater;
    if (!u) return;
    this.apply();
    u.on('checking-for-update', () => this.set({ state: 'checking' }));
    u.on('update-available', (info: { version: string }) => {
      this.found = info.version;
      this.set(
        u.autoDownload
          ? { state: 'downloading', version: info.version, percent: 0 }
          : { state: 'available', version: info.version },
      );
    });
    u.on('update-not-available', () => this.set({ state: 'none', checkedAt: opts.now() }));
    u.on('download-progress', (p: { percent: number }) =>
      this.set({
        state: 'downloading',
        version: this.found ?? '',
        percent: Math.max(0, Math.min(100, Math.round(p.percent))),
      }),
    );
    u.on('update-downloaded', (info: { version: string }) =>
      this.set({ state: 'downloaded', version: info.version }),
    );
    u.on('error', (e: unknown) => {
      // Keep a finished download: it still installs on quit.
      if (this.current.state !== 'downloaded') this.set({ state: 'error', message: message(e) });
      opts.log?.(`updates: ${message(e)}`);
    });
  }

  /** Follow the settings and start the automatic checks. */
  start(): void {
    if (!this.opts.updater) return;
    this.unsubscribe = this.opts.settings.onChange((c) => {
      if (!c.changed.some((k) => k.startsWith('updates.'))) return;
      this.apply();
      this.schedule();
    });
    this.schedule();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  state(): UpdateState {
    return this.current;
  }

  /** Calls `listener` on every change; returns the unsubscribe. */
  subscribe(listener: (s: UpdateState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** "Check now". Does nothing while a check or download runs, or once one is downloaded. */
  async check(): Promise<UpdateState> {
    const u = this.opts.updater;
    if (!u || this.busy()) return this.current;
    this.apply();
    this.set({ state: 'checking' });
    try {
      await u.checkForUpdates();
    } catch (e) {
      if (this.current.state === 'checking') this.set({ state: 'error', message: message(e) });
    }
    return this.current;
  }

  /** "Download", when automatic updates are off. */
  async download(): Promise<UpdateState> {
    const u = this.opts.updater;
    if (!u || this.current.state !== 'available') return this.current;
    const version = this.current.version;
    this.set({ state: 'downloading', version, percent: 0 });
    // Resolves when the download ends; progress and the end come as events.
    u.downloadUpdate().catch((e: unknown) => {
      if (this.current.state === 'downloading') this.set({ state: 'error', message: message(e) });
    });
    return this.current;
  }

  /** "Restart to update": only once an update is downloaded. */
  restart(): boolean {
    const u = this.opts.updater;
    if (!u || this.current.state !== 'downloaded') return false;
    // Not silent (Windows shows the installer's progress), and start again after.
    u.quitAndInstall(false, true);
    return true;
  }

  /** Checking, downloading, or already holding a downloaded update. */
  private busy(): boolean {
    const s = this.current.state;
    return s === 'checking' || s === 'downloading' || s === 'downloaded';
  }

  private apply(): void {
    const u = this.opts.updater;
    if (!u) return;
    const s = this.opts.settings.get().updates;
    u.allowPrerelease = s.channel === 'beta';
    u.autoDownload = s.auto;
    u.autoInstallOnAppQuit = true;
  }

  private schedule(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (!this.opts.settings.get().updates.auto) return;
    const tick = (ms: number): void => {
      const t = setTimeout(() => {
        void this.check();
        tick(this.opts.intervalMs ?? CHECK_INTERVAL_MS);
      }, ms);
      t.unref?.();
      this.timers = [t];
    };
    tick(this.opts.firstCheckMs ?? FIRST_CHECK_MS);
  }

  private set(s: UpdateState): void {
    this.current = s;
    for (const l of this.listeners) l(s);
  }
}
