import { join } from 'node:path';
import { app, BrowserWindow, dialog } from 'electron';
import { APP_NAME } from '@algorithm-tutor/core';
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

void app.whenReady().then(() => {
  // Kept for the IPC handlers that use it (T06, T08).
  const storage = openStorage();
  if (!storage) {
    app.exit(1);
    return;
  }
  afterReady(ui);
  createMainWindow(APP_NAME, ui);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow(APP_NAME, ui);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
