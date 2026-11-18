import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { APP_NAME } from '@algorithm-tutor/core';
import { afterReady, beforeReady } from './setup';
import { createMainWindow, type UiOptions } from './window';

const ui: UiOptions = {
  rendererDir: join(import.meta.dirname, '../renderer'),
  preloadPath: join(import.meta.dirname, '../preload/index.cjs'),
  devServerUrl: app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'],
};

app.setName(APP_NAME);
beforeReady();

void app.whenReady().then(() => {
  afterReady(ui);
  createMainWindow(APP_NAME, ui);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow(APP_NAME, ui);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
