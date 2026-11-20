/**
 * App start-up shared by the real entry (`index.ts`) and the security check
 * (`security-check.ts`), so the check runs exactly what ships.
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  protocol,
  session,
  shell,
} from 'electron';
import { isoNow } from '@algorithm-tutor/core';
import { EXEC_SCHEME_PRIVILEGES } from './exec/host-window';
import { registerHandlers } from './ipc/handlers';
import { DataService, type DataUi } from './data';
import { registerPracticeHandlers } from './ipc/handlers/practice';
import { registerCodeExecutionHandlers } from './ipc/handlers/code-execution';
import { followTheme, registerSettingsHandlers } from './ipc/handlers/settings';
import { registerTutorHandlers } from './ipc/handlers/tutor';
import { registerIntakeHandlers } from './ipc/handlers/intake';
import { chatCreateProblem, openIntake, openSets, problemFactory, type AppIntake } from './intake';
import { IpcRouter } from './ipc/router';
import { openLibrary, registerLibraryHandlers } from './library';
import { contentDir, openPractice, type AppPractice } from './practice';
import { SecretStore } from './secrets';
import { electronCrypto } from './secrets/electron-crypto';
import type { AppStorage } from './storage';
import { DEFAULT_MODEL, openTutor, type AppTutor } from './tutor';
import { openUpdater, registerUpdateHandlers, type UpdateService } from './updater';
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

/** File choosers, confirmations and restart for the Data section, as Electron dialogs. */
export function electronDataUi(): DataUi {
  const parent = (): BrowserWindow | undefined =>
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const withParent = <T>(fn: (w: BrowserWindow | undefined) => Promise<T>): Promise<T> =>
    fn(parent());
  return {
    chooseExportPath: (defaultName) =>
      withParent(async (w) => {
        const opts = {
          title: 'Export data',
          defaultPath: join(app.getPath('documents'), defaultName),
          filters: [{ name: 'Zip', extensions: ['zip'] }],
        };
        const r = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts);
        return r.canceled || !r.filePath ? null : r.filePath;
      }),
    chooseImportFile: () =>
      withParent(async (w) => {
        const opts = {
          title: 'Import data',
          properties: ['openFile' as const],
          filters: [{ name: 'Zip', extensions: ['zip'] }],
        };
        const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
        return r.canceled ? null : (r.filePaths[0] ?? null);
      }),
    confirm: ({ message, detail, ok }) =>
      withParent(async (w) => {
        const opts = {
          type: 'warning' as const,
          message,
          detail,
          buttons: ['Cancel', ok],
          defaultId: 0,
          cancelId: 0,
        };
        const r = w ? await dialog.showMessageBox(w, opts) : await dialog.showMessageBox(opts);
        return r.response === 1;
      }),
    openFolder: async (path) => (await shell.openPath(path)) === '',
    restart: () => {
      // After the IPC reply has gone out.
      setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 300);
    },
  };
}

/**
 * After `app.whenReady()` and storage: load the problems, start the executor
 * behind the execution host, open the keychain, and register the practice
 * channels (T08), the tutor's (T10) and Settings' (T09). Settings apply at
 * once; the theme setting drives `prefers-color-scheme` in every window.
 */
export async function startPractice(
  router: IpcRouter,
  storage: AppStorage,
  ui: UiOptions,
  mainDir: string,
  dataUi: DataUi = electronDataUi(),
): Promise<
  AppPractice & { tutor: AppTutor; secrets: SecretStore; intake: AppIntake; updates: UpdateService }
> {
  const content = contentDir(app.isPackaged, process.resourcesPath, mainDir);
  const practice = await openPractice(storage, {
    content,
    appVersion: app.getVersion(),
    host: {
      rendererDir: ui.rendererDir,
      preloadPath: join(mainDir, '../preload/exec-host.cjs'),
      devServerUrl: ui.devServerUrl,
    },
  });
  followTheme(storage.settings, nativeTheme);
  registerPracticeHandlers(router, { practice: practice.practice });
  const secrets = await SecretStore.open(storage.paths.secrets, electronCrypto, process.env);
  // New problems (T12): the self-check runs in Pyodide only.
  const create = problemFactory({
    catalog: practice.catalog,
    dataDir: storage.paths.root,
    executors: practice.executors,
    now: isoNow,
  });
  const tutor = await openTutor({
    createProblem: chatCreateProblem(create),
    practice: practice.practice,
    settings: () => storage.settings.get(),
    apiKey: () => secrets.apiKey(),
    contentDir: content,
    explanationsDir: storage.paths.explanations,
    agentHome: storage.paths.agentHome,
    appVersion: app.getVersion(),
    env: process.env,
    now: isoNow,
  });
  registerTutorHandlers(router, { tutor, practice: practice.practice });
  const { sets } = await openSets({
    contentDir: content,
    cacheDir: storage.paths.cache,
    topics: new Set(practice.catalog.topics().map((t) => t.id)),
  });
  const intake = openIntake({
    catalog: practice.catalog,
    create,
    sets,
    backend: () => tutor.backend(),
    tools: tutor.tools,
    guides: tutor.references,
    guard: practice.practice.guard,
  });
  registerIntakeHandlers(router, { intake });
  registerSettingsHandlers(router, {
    settings: storage.settings,
    secrets,
    anthropic: tutor.anthropic,
    defaultModel: DEFAULT_MODEL,
    practice: practice.practice,
    runtimeRefusal: (runtime) => practice.codeExecution.refusal(runtime),
    data: new DataService({
      paths: storage.paths,
      storage: storage.storage,
      appVersion: app.getVersion(),
      now: isoNow,
      ui: dataUi,
    }),
  });
  // The Library (T21): scanned at start; folders are only ever read.
  const library = openLibrary({
    settings: storage.settings,
    storage: storage.storage,
    now: isoNow,
    newId: randomUUID,
    chooseFolder: async () => {
      const w = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const opts = {
        title: 'Add a folder to the library',
        properties: ['openDirectory' as const],
      };
      const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    openPath: async (path) => (await shell.openPath(path)) === '',
    log: (m) => console.warn(m),
  });
  registerLibraryHandlers(router, library, { log: (m) => console.warn(m) });
  registerCodeExecutionHandlers(router, {
    codeExecution: practice.codeExecution,
    openExternal: async (url) => {
      await shell.openExternal(url);
      return true;
    },
  });
  // Updates (T13): only installed builds have an updater.
  const updates = await openUpdater({
    packaged: app.isPackaged,
    settings: storage.settings,
    now: isoNow,
    log: (m) => console.warn(m),
  });
  registerUpdateHandlers(router, updates);
  return {
    ...practice,
    tutor,
    secrets,
    intake,
    updates,
    dispose: () => {
      updates.stop();
      void tutor.close();
      practice.dispose();
    },
  };
}
