/**
 * Updates in the app (T13): electron-updater with the GitHub provider that
 * electron-builder writes into `app-update.yml`, and the `updates:*` channels.
 * Development builds get no updater (`unsupported`).
 */
import type { IpcRouter } from '../ipc/router';
import { UpdateService, type UpdateSettingsSource, type UpdaterLike } from './service';

export { UpdateService } from './service';

export interface OpenUpdaterOptions {
  packaged: boolean;
  settings: UpdateSettingsSource;
  now: () => string;
  log?: (message: string) => void;
}

/** The updater for this build; `unsupported` when not packaged. */
export async function openUpdater(opts: OpenUpdaterOptions): Promise<UpdateService> {
  let updater: UpdaterLike | null = null;
  let reason = 'Updates are checked only in installed builds, not in development.';
  if (opts.packaged) {
    try {
      // Bundled into the main process; picks the updater for this install
      // (NSIS, DMG/zip, AppImage, deb) from how the app was installed.
      const { autoUpdater } = await import('electron-updater');
      autoUpdater.logger = null;
      updater = autoUpdater as unknown as UpdaterLike;
    } catch (e) {
      reason = `The updater could not start: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  const service = new UpdateService({
    updater,
    unsupportedReason: reason,
    settings: opts.settings,
    now: opts.now,
    ...(opts.log ? { log: opts.log } : {}),
  });
  service.start();
  return service;
}

export function registerUpdateHandlers(router: IpcRouter, updates: UpdateService): void {
  router.handle('updates:status', () => updates.state());
  router.handle('updates:check', () => {
    void updates.check();
    return updates.state();
  });
  router.handle('updates:download', () => updates.download());
  router.handle('updates:restart', () => ({ restarting: updates.restart() }));
  router.handleStream('updates:watch', async (_req, { signal, emit }) => {
    emit(updates.state());
    const off = updates.subscribe(emit);
    await new Promise<void>((resolve) => {
      if (signal.aborted) return resolve();
      signal.addEventListener('abort', () => resolve(), { once: true });
    });
    off();
    return { closed: true as const };
  });
}
