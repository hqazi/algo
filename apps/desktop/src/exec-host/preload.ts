/**
 * Preload for the execution host (sandboxed). Its only job: hand the
 * MessagePort the main process sends to the page. Nothing is exposed on
 * `window`.
 */
import { ipcRenderer } from 'electron';

// Typed by hand: the preload is checked with the Node config (no DOM lib).
const page = globalThis as unknown as {
  postMessage(message: string, targetOrigin: string, transfer: unknown[]): void;
};

ipcRenderer.once('exec-host:port', (event) => {
  page.postMessage('exec-host:port', '*', event.ports);
});
