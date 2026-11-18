/**
 * `npm run check:security`: start the built app the way it ships (UI over
 * `tutor-app://`, no dev server) and check the security baseline from inside
 * the real window, where unit tests cannot reach (SPEC §10, T02):
 *
 * - the page has no `require`, `process`, `module` or `Buffer`; `window.tutor`
 *   has only `invoke` and `stream`;
 * - IPC works end to end, and an invalid payload or unknown channel is refused;
 * - a stream delivers its events and result, and cancel stops it;
 * - CSP blocks `fetch`, inline scripts, `eval` and frames;
 * - navigation, `window.open` and permission requests are refused;
 * - the protocol serves nothing outside `renderer/` and `assets/`;
 * - a page in the UI session cannot load remote content even past CSP.
 *
 *   electron out/main/security-check.js
 *
 * Prints JSON lines; exits 1 if a check fails.
 */
import { join } from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import { APP_NAME } from '@algorithm-tutor/core';
import { afterReady, beforeReady } from './setup';
import { APP_ORIGIN, createMainWindow, type UiOptions } from './window';

const failures: string[] = [];
const blocked: string[] = [];
const log = (o: object): void => console.log(JSON.stringify(o));

function check(name: string, ok: boolean, detail?: unknown): void {
  log({ check: name, ok, ...(detail === undefined ? {} : { detail }) });
  if (!ok) failures.push(name);
}

const ui: UiOptions = {
  rendererDir: join(import.meta.dirname, '../renderer'),
  preloadPath: join(import.meta.dirname, '../preload/index.cjs'),
  onBlocked: (url) => blocked.push(url),
};

app.commandLine.appendSwitch('disable-gpu');
beforeReady({ onBlocked: (what, url) => blocked.push(`${what} ${url}`) });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(what: string, f: () => Promise<boolean>, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await f()) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function checks(): Promise<void> {
  const router = afterReady(ui);
  const win = createMainWindow(APP_NAME, ui);
  const page = (code: string): Promise<unknown> => win.webContents.executeJavaScript(code);
  await until('the page to load', async () => !win.webContents.isLoading());
  check('loaded from the app protocol', win.webContents.getURL().startsWith(`${APP_ORIGIN}/`), {
    url: win.webContents.getURL(),
  });

  // The UI rendered and fetched its versions over IPC (app:version).
  await until('versions', async () => Boolean(await page('!!document.querySelector(".versions")')));
  const text = await page('document.body.innerText');
  check(
    'renders and calls app:version',
    String(text).includes(APP_NAME) &&
      String(text).includes(`Electron ${process.versions.electron}`),
    text,
  );

  const globals = (await page(`({
    require: typeof require, process: typeof process, module: typeof module,
    Buffer: typeof Buffer, global: typeof global, ipcRenderer: typeof ipcRenderer,
    tutor: Object.keys(window.tutor).sort(),
  })`)) as Record<string, unknown>;
  check(
    'no Node in the renderer',
    ['require', 'process', 'module', 'Buffer', 'global', 'ipcRenderer'].every(
      (k) => globals[k] === 'undefined',
    ),
    globals,
  );
  check(
    'bridge exposes only invoke and stream',
    JSON.stringify(globals['tutor']) === '["invoke","stream"]',
    globals['tutor'],
  );

  const bad = (await page(`Promise.all([
    window.tutor.invoke('app:version', { evil: true }),
    window.tutor.invoke('fs:read', '/etc/passwd'),
    window.tutor.stream('example:count', { to: 'lots', intervalMs: 0 }, () => {}).result,
    window.tutor.stream('nope', {}, () => {}).result,
  ])`)) as { ok: boolean; error?: { code: string } }[];
  check(
    'invalid payloads and unknown channels are refused',
    bad.map((r) => r.error?.code).join() ===
      'invalid_request,unknown_channel,invalid_request,unknown_channel',
    bad,
  );

  const streamed = (await page(`(async () => {
    const events = [];
    const h = window.tutor.stream('example:count', { to: 5, intervalMs: 0 }, (e) => events.push(e.n));
    return { result: await h.result, events };
  })()`)) as { result: unknown; events: number[] };
  check(
    'stream delivers events then its result',
    JSON.stringify(streamed) ===
      '{"result":{"ok":true,"value":{"counted":5}},"events":[1,2,3,4,5]}',
    streamed,
  );

  const cancelled = (await page(`(async () => {
    const events = [];
    const h = window.tutor.stream('example:count', { to: 1000, intervalMs: 10 }, (e) => events.push(e.n));
    await new Promise((r) => setTimeout(r, 150));
    h.cancel();
    const result = await h.result;
    const atCancel = events.length;
    await new Promise((r) => setTimeout(r, 150));
    return { result, atCancel, after: events.length };
  })()`)) as { result: { error?: { code: string } }; atCancel: number; after: number };
  check(
    'stream cancel stops it',
    cancelled.result.error?.code === 'cancelled' &&
      cancelled.atCancel > 0 &&
      cancelled.atCancel < 1000 &&
      cancelled.after === cancelled.atCancel &&
      router.activeStreams === 0,
    { ...cancelled, activeStreams: router.activeStreams },
  );

  const csp = (await page(`(async () => {
    const out = {};
    try { await fetch('https://example.com/'); out.fetch = 'allowed'; } catch { out.fetch = 'blocked'; }
    try { await fetch('${APP_ORIGIN}/renderer/index.html'); out.fetchSelf = 'allowed'; } catch { out.fetchSelf = 'blocked'; }
    const s = document.createElement('script');
    s.textContent = 'window.__inline = true';
    document.body.appendChild(s);
    out.inline = window.__inline ? 'ran' : 'blocked';
    try { eval('1'); out.eval = 'ran'; } catch { out.eval = 'blocked'; }
    try { new Function('return 1')(); out.newFunction = 'ran'; } catch { out.newFunction = 'blocked'; }
    const f = document.createElement('iframe');
    f.src = '${APP_ORIGIN}/renderer/index.html';
    document.body.appendChild(f);
    await new Promise((r) => setTimeout(r, 300));
    let framed = false;
    try { framed = Boolean(f.contentWindow.tutor); } catch {}
    out.iframeBridge = framed ? 'available' : 'none';
    f.remove();
    return out;
  })()`)) as Record<string, string>;
  check(
    'CSP blocks fetch, inline script, eval and frames',
    csp['fetch'] === 'blocked' &&
      csp['fetchSelf'] === 'blocked' &&
      csp['inline'] === 'blocked' &&
      csp['eval'] === 'blocked' &&
      csp['newFunction'] === 'blocked' &&
      csp['iframeBridge'] === 'none',
    csp,
  );

  const windows = BrowserWindow.getAllWindows().length;
  const nav = (await page(`(async () => {
    const opened = window.open('https://example.com/');
    location.href = 'https://example.com/';
    await new Promise((r) => setTimeout(r, 500));
    return { opened: opened === null ? null : 'window', url: location.href };
  })()`)) as { opened: unknown; url: string };
  check(
    'navigation and window.open are refused',
    nav.opened === null &&
      nav.url.startsWith(`${APP_ORIGIN}/`) &&
      BrowserWindow.getAllWindows().length === windows &&
      blocked.some((b) => b.startsWith('window.open')) &&
      blocked.some((b) => b.startsWith('navigation')),
    { ...nav, blocked: blocked.filter((b) => /^(window\.open|navigation)/.test(b)) },
  );

  const perms = (await page(`(async () => ({
    notification: await Notification.requestPermission(),
    geolocation: (await navigator.permissions.query({ name: 'geolocation' })).state,
    camera: await navigator.mediaDevices.getUserMedia({ video: true }).then(() => 'granted', (e) => e.name),
  }))()`)) as Record<string, string>;
  check(
    'permission requests are denied',
    perms['notification'] === 'denied' &&
      perms['geolocation'] === 'denied' &&
      perms['camera'] !== 'granted',
    perms,
  );

  // The protocol serves only renderer/ and assets/.
  const served: Record<string, number> = {};
  for (const path of [
    'renderer/index.html',
    'main/index.js',
    'preload/index.cjs',
    'renderer/../main/index.js',
    'renderer/%2e%2e/main/index.js',
    'pyodide/pyodide.mjs',
    'exec-host/index.html',
  ]) {
    served[path] = (await session.defaultSession.fetch(`${APP_ORIGIN}/${path}`)).status;
  }
  const header = (await session.defaultSession.fetch(`${APP_ORIGIN}/renderer/index.html`)).headers;
  check(
    'protocol serves only the UI, with CSP',
    served['renderer/index.html'] === 200 &&
      Object.entries(served).every(([p, s]) => p === 'renderer/index.html' || s === 404) &&
      (header.get('content-security-policy') ?? '').includes("connect-src 'none'"),
    served,
  );

  // Past CSP: a page in the UI session told to load a remote URL directly.
  const probe = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  const before = blocked.length;
  const error = await probe.loadURL('https://example.com/').then(
    () => 'loaded',
    (e: Error) => e.message,
  );
  probe.destroy();
  check(
    'remote content is blocked in the UI session',
    error.includes('ERR_BLOCKED_BY_CLIENT') &&
      blocked.slice(before).some((b) => b.startsWith('https://example.com')),
    error,
  );

  win.destroy();
}

void app.whenReady().then(async () => {
  try {
    await checks();
  } catch (e) {
    check('ran to the end', false, String(e));
  }
  log({ failures });
  app.exit(failures.length ? 1 : 0);
});
