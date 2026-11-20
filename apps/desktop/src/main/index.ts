import { join } from 'node:path';
import { app, BrowserWindow, dialog } from 'electron';
import { APP_NAME } from '@algo/core';
import { applyPending } from './data';
import type { AppPractice } from './practice';
import { afterReady, beforeReady, startPractice } from './setup';
import { dataPaths, openAppStorage, resolveDataDir, type AppStorage } from './storage';
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
    // A staged import or "reset everything" (SPEC §4.5), before anything is opened.
    const applied = applyPending(dataPaths(dataDir));
    if (applied) console.warn(`data: applied a staged ${applied.op} from ${applied.at}`);
  } catch (e) {
    dialog.showErrorBox(
      `${APP_NAME} could not finish importing or resetting`,
      `${e instanceof Error ? e.message : String(e)}\n\nData folder: ${dataDir}\n` +
        'The data from before is in the backups folder there.',
    );
    return null;
  }
  try {
    const opened = openAppStorage(dataDir);
    for (const issue of opened.settings.issues) {
      // Also shown in Settings.
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

void app.whenReady().then(async () => {
  const storage = openStorage();
  if (!storage) {
    app.exit(1);
    return;
  }
  const router = afterReady(ui);
  let practice: AppPractice;
  try {
    practice = await startPractice(router, storage, ui, import.meta.dirname);
  } catch (e) {
    dialog.showErrorBox(
      `${APP_NAME} cannot load its problems`,
      e instanceof Error ? e.message : String(e),
    );
    app.exit(1);
    return;
  }
  app.on('before-quit', () => practice.dispose());
  createMainWindow(APP_NAME, ui);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow(APP_NAME, ui);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
