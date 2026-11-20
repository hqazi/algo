/**
 * The UI window and the security baseline around it (SPEC §10).
 *
 * - The UI is served from the app's own files over `tutor-app://app/`, a
 *   privileged custom protocol, not `file://` (so the
 *   `GrantFileProtocolExtraPrivileges` fuse can be off, and the page has a
 *   real origin to check IPC senders against). It serves only `renderer/`
 *   and `assets/` from the renderer build.
 * - CSP is sent as a response header (`UI_CSP`): scripts and styles from the
 *   app only, no network (`connect-src 'none'`), no frames, objects, forms or
 *   `<base>`. In development the page comes from the Vite dev server and gets
 *   `DEV_CSP`, which also allows Vite's inline preamble and its WebSocket.
 * - The window: `contextIsolation`, `sandbox`, no Node integration,
 *   `webSecurity`, no spellcheck (it downloads dictionaries).
 * - The default session: every request from a page that is not the app's
 *   own (or the dev server, in development) is cancelled, so no remote
 *   content loads; all permission requests and checks are denied; downloads
 *   are cancelled. Requests the main process makes itself (`net`) are not
 *   affected.
 * - Every web contents in the app (UI, execution host, DevTools): no
 *   navigation, no redirects, no `window.open`, no `<webview>`.
 */
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { app, BrowserWindow, type CustomScheme, type Session, type WebContents } from 'electron';

export const APP_SCHEME = 'tutor-app';
export const APP_ORIGIN = `${APP_SCHEME}://app`;
const PAGE_PATH = 'renderer/index.html';

/** Privileges for `protocol.registerSchemesAsPrivileged` (call it once, before ready). */
export const APP_SCHEME_PRIVILEGES: CustomScheme = {
  scheme: APP_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true },
};

export const UI_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  // React style props and CodeMirror's injected styles.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Development only: Vite injects an inline preamble and talks over a
 * WebSocket. The page comes from the dev server, so `'self'` is not
 * `tutor-app://app`: Library images (`tutor-app://app/library-asset/…`)
 * need that origin named, or the reader shows them broken.
 */
export function devCsp(devServerUrl: string): string {
  const { host } = new URL(devServerUrl);
  return UI_CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
    .replace("connect-src 'none'", `connect-src 'self' ws://${host}`)
    .replace("img-src 'self' data:", `img-src 'self' data: ${APP_ORIGIN}`);
}

/** Paths under the renderer build the protocol serves. */
const SERVED = ['renderer/', 'assets/'];

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

export interface UiOptions {
  /** The renderer build folder (`out/renderer`). */
  rendererDir: string;
  /** The built UI preload (`out/preload/index.cjs`). */
  preloadPath: string;
  /** In development: the Vite dev server the page is loaded from. */
  devServerUrl?: string | undefined;
  /**
   * Serves `tutor-app://app/library-asset/<token>` (Library images, T22);
   * without it that path is not found.
   */
  libraryAssets?: { handles: (url: string) => boolean; serve: (req: Request) => Promise<Response> };
  /** Called with every request the session blocked (checks and logging). */
  onBlocked?: (url: string) => void;
  /** Called with every request a page in the session made, allowed or not (checks). */
  onRequest?: (url: string) => void;
}

/** The URL the UI page is loaded from. */
export function pageUrl(opts: Pick<UiOptions, 'devServerUrl'>): string {
  return opts.devServerUrl
    ? new URL(PAGE_PATH, `${opts.devServerUrl}/`).href
    : `${APP_ORIGIN}/${PAGE_PATH}`;
}

/** True for the UI page itself: the only page allowed to use IPC. */
export function isTrustedUrl(url: string, opts: Pick<UiOptions, 'devServerUrl'>): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const page = new URL(pageUrl(opts));
  // Not `origin`: for a custom scheme it is the string "null" for every host.
  return u.protocol === page.protocol && u.host === page.host && u.pathname === page.pathname;
}

/** Serve `tutor-app://app/<path>` from the renderer build. */
export async function serveUi(request: Request, rendererDir: string): Promise<Response> {
  const url = new URL(request.url);
  let path: string;
  try {
    path = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  } catch {
    return new Response('not found', { status: 404 });
  }
  const file = normalize(join(rendererDir, path));
  if (
    url.host !== 'app' ||
    request.method !== 'GET' ||
    !SERVED.some((p) => path.startsWith(p)) ||
    path.includes('..') ||
    !file.startsWith(normalize(rendererDir) + sep)
  ) {
    return new Response('not found', { status: 404 });
  }
  try {
    const body = await readFile(file);
    return new Response(body, {
      headers: {
        'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
        'Content-Security-Policy': UI_CSP,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response('not found', { status: 404 });
  }
}

/** Is this request one the UI's session may make? */
export function isAllowedRequest(url: string, devServerUrl: string | undefined): boolean {
  if (url.startsWith(`${APP_ORIGIN}/`) || url.startsWith('devtools://')) return true;
  if (!devServerUrl) return false;
  try {
    const u = new URL(url);
    const dev = new URL(devServerUrl);
    return u.host === dev.host && ['http:', 'ws:'].includes(u.protocol);
  } catch {
    return false;
  }
}

/** Lock down the session the UI runs in. Call once, after ready. */
export function secureUiSession(ses: Session, opts: UiOptions): void {
  ses.protocol.handle(APP_SCHEME, (req) =>
    opts.libraryAssets?.handles(req.url)
      ? opts.libraryAssets.serve(req)
      : serveUi(req, opts.rendererDir),
  );
  ses.webRequest.onBeforeRequest((details, callback) => {
    // Only requests made by pages; the main process's own `net` requests
    // (updates, later) carry no web contents.
    const fromPage = details.webContentsId !== undefined;
    if (fromPage) opts.onRequest?.(details.url);
    const cancel = fromPage && !isAllowedRequest(details.url, opts.devServerUrl);
    if (cancel) opts.onBlocked?.(details.url);
    callback({ cancel });
  });
  if (opts.devServerUrl) {
    const csp = devCsp(opts.devServerUrl);
    const origin = new URL(opts.devServerUrl).origin;
    ses.webRequest.onHeadersReceived((details, callback) => {
      const headers = { ...details.responseHeaders };
      if (details.url.startsWith(`${origin}/`) && details.resourceType === 'mainFrame') {
        headers['Content-Security-Policy'] = [csp];
      }
      callback({ responseHeaders: headers });
    });
  }
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', (e) => e.preventDefault());
}

/**
 * Applied to every web contents the app creates (UI, execution host,
 * DevTools). Call once, before any window opens.
 */
export function guardAllWebContents(onBlocked?: (what: string, url: string) => void): void {
  app.on('web-contents-created', (_e, contents: WebContents) => {
    contents.setWindowOpenHandler(({ url }) => {
      onBlocked?.('window.open', url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (e) => {
      onBlocked?.('navigation', e.url);
      e.preventDefault();
    });
    contents.on('will-redirect', (e) => {
      onBlocked?.('redirect', e.url);
      e.preventDefault();
    });
    contents.on('will-attach-webview', (e) => {
      onBlocked?.('webview', '');
      e.preventDefault();
    });
  });
}

export function createMainWindow(title: string, opts: UiOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title,
    show: false,
    webPreferences: {
      preload: opts.preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  void win.loadURL(pageUrl(opts));
  return win;
}
