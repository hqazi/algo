/**
 * App start-up shared by the real entry (`index.ts`) and the security check
 * (`security-check.ts`), so the check runs exactly what ships.
 */
import { app, ipcMain, protocol, session } from 'electron';
import { EXEC_SCHEME_PRIVILEGES } from './exec/host-window';
import { registerHandlers } from './ipc/handlers';
import { IpcRouter } from './ipc/router';
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
