import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { APP_NAME } from '@algorithm-tutor/core';
import { registerExecScheme } from './exec/host-window';

// Skeleton window only. The full security baseline (CSP, navigation and
// permission blocking, fuses) and typed IPC are T02.
function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: APP_NAME,
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devUrl) {
    void win.loadURL(`${devUrl}/renderer/index.html`);
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/renderer/index.html'));
  }
  return win;
}

app.setName(APP_NAME);
// The execution host's protocol (T07); the executor itself is wired to IPC in T08.
registerExecScheme();

void app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
