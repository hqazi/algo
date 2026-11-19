import { join } from 'node:path';
import { app, BrowserWindow, dialog, nativeTheme } from 'electron';
import { APP_NAME } from '@algorithm-tutor/core';
import { registerPracticeHandlers } from './ipc/handlers/practice';
import { contentDir, openPractice, type AppPractice } from './practice';
import { afterReady, beforeReady } from './setup';
import { openAppStorage, resolveDataDir, type AppStorage } from './storage';
import { createMainWindow, type UiOptions } from './window';

const ui: UiOptions = {
  rendererDir: join(import.meta.dirname, '../renderer'),
  preloadPath: join(import.meta.dirname, '../preload/index.cjs'),
  devServerUrl: app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'],
};

app.setName(APP_NAME);
beforeReady();

/** Opens `tutor.db` and `settings.json`; on failure, tells the user and quits. */
function openStorage(): AppStorage | null {
  const dataDir = resolveDataDir({ userData: app.getPath('userData'), env: process.env });
  try {
    const opened = openAppStorage(dataDir);
    for (const issue of opened.settings.issues) {
      // Shown in Settings once it exists (T09).
      console.warn(`settings.json: ${issue.key || '(file)'}: ${issue.message}`);
    }
    return opened;
  } catch (e) {
    dialog.showErrorBox(
      `${APP_NAME} cannot open its data`,
      `${e instanceof Error ? e.message : String(e)}\n\nData folder: ${dataDir}`,
    );
    return null;
  }
}

/** Loads the problems and starts the executor; on failure, tells the user and quits. */
async function startPractice(storage: AppStorage): Promise<AppPractice | null> {
  try {
    return await openPractice(storage, {
      content: contentDir(app.isPackaged, process.resourcesPath, import.meta.dirname),
      host: {
        rendererDir: ui.rendererDir,
        preloadPath: join(import.meta.dirname, '../preload/exec-host.cjs'),
        devServerUrl: ui.devServerUrl,
      },
    });
  } catch (e) {
    dialog.showErrorBox(
      `${APP_NAME} cannot load its problems`,
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
}

void app.whenReady().then(async () => {
  const storage = openStorage();
  const practice = storage && (await startPractice(storage));
  if (!storage || !practice) {
    app.exit(1);
    return;
  }
  // The theme setting drives `prefers-color-scheme` in every window.
  nativeTheme.themeSource = storage.settings.get().ui.theme;
  const router = afterReady(ui);
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
  app.on('before-quit', () => practice.dispose());
  createMainWindow(APP_NAME, ui);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow(APP_NAME, ui);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
