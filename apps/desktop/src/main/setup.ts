/**
 * App start-up shared by the real entry (`index.ts`) and the security check
 * (`security-check.ts`), so the check runs exactly what ships.
 */
import { join } from 'node:path';
import { app, ipcMain, nativeTheme, protocol, session } from 'electron';
import { EXEC_SCHEME_PRIVILEGES } from './exec/host-window';
import { registerHandlers } from './ipc/handlers';
import { registerPracticeHandlers } from './ipc/handlers/practice';
import { IpcRouter } from './ipc/router';
import { contentDir, openPractice, type AppPractice } from './practice';
import type { AppStorage } from './storage';
import {
  APP_SCHEME_PRIVILEGES,
  guardAllWebContents,
  isTrustedUrl,
  secureUiSession,
  type UiOptions,
} from './window';

export interface SetupHooks {
  onBlocked?: (what: string, url: string) => void;
}

/** Before `app.whenReady()`. */
export function beforeReady(hooks: SetupHooks = {}): void {
  // Sandbox every renderer, including any a window forgets to configure.
  // Chromium refuses to start as root with this on, so an explicit
  // --no-sandbox (development as root only) skips it; every window still sets
  // `sandbox: true` itself.
  if (!app.commandLine.hasSwitch('no-sandbox')) app.enableSandbox();
  // Electron takes one call for every custom scheme: the UI's and the
  // execution host's (T07; the executor is wired to IPC in T08).
  protocol.registerSchemesAsPrivileged([APP_SCHEME_PRIVILEGES, EXEC_SCHEME_PRIVILEGES]);
  guardAllWebContents(hooks.onBlocked);
}

/** After `app.whenReady()`: lock down the UI session and start IPC. */
export function afterReady(ui: UiOptions): IpcRouter {
  secureUiSession(session.defaultSession, ui);
  const router = new IpcRouter(ipcMain, {
    isTrustedUrl: (url) => isTrustedUrl(url, ui),
    onError: (channel, error) => console.error(`ipc ${channel}:`, error),
  });
  registerHandlers(router, {
    version: app.getVersion(),
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
  });
  return router;
}

/**
 * After `app.whenReady()` and storage: load the problems, start the executor
 * behind the execution host, and register the practice channels (T08). The
 * theme setting drives `prefers-color-scheme` in every window.
 */
export async function startPractice(
  router: IpcRouter,
  storage: AppStorage,
  ui: UiOptions,
  mainDir: string,
): Promise<AppPractice> {
  const practice = await openPractice(storage, {
    content: contentDir(app.isPackaged, process.resourcesPath, mainDir),
    host: {
      rendererDir: ui.rendererDir,
      preloadPath: join(mainDir, '../preload/exec-host.cjs'),
      devServerUrl: ui.devServerUrl,
    },
  });
  nativeTheme.themeSource = storage.settings.get().ui.theme;
  registerPracticeHandlers(router, {
    practice: practice.practice,
    theme: {
      get: () => storage.settings.get().ui.theme,
      set: (theme) => {
        const next = storage.settings.update({ ui: { theme } }).ui.theme;
        nativeTheme.themeSource = next;
        return next;
      },
    },
  });
  return practice;
}
