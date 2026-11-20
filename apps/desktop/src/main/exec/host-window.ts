/**
 * The execution host window (SPEC §6.2, §10), main-process side.
 *
 * - A hidden `BrowserWindow`: `sandbox`, `contextIsolation`, no Node, its own
 *   in-memory session partition, background throttling off (the host's kill
 *   timers must fire on time while hidden).
 * - The page and Pyodide are served from the app's files over `tutor-exec://`,
 *   a protocol registered only on that partition. It serves nothing else.
 * - Every other request from the partition is cancelled (`webRequest`), all
 *   permissions are denied, navigation, new windows and downloads are blocked.
 * - CSP (as response headers): the page `default-src 'none'; script-src
 *   'self'; worker-src 'self'; connect-src 'none'`. Workers additionally get
 *   `connect-src 'self'` and `'wasm-unsafe-eval'` so Pyodide can fetch its own
 *   bundled files and compile its WebAssembly (DECISIONS D-14).
 *
 * `ExecHost` implements the executor's transport over a MessagePort.
 */
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import {
  app,
  BrowserWindow,
  MessageChannelMain,
  net,
  protocol,
  session,
  type CustomScheme,
  type MessagePortMain,
  type Session,
} from 'electron';
import type { CancelSignal, ExecutorStatus, HarnessOutput, HarnessRequest } from '@algo/core';
import type { HostToMain, MainToHost } from '../../exec-host/protocol';
import type { HarnessTransport } from './pyodide-executor';

export const EXEC_SCHEME = 'tutor-exec';
export const EXEC_PARTITION = 'exec-host'; // no "persist:" prefix: in memory only
const ORIGIN = `${EXEC_SCHEME}://host`;
const PAGE = `${ORIGIN}/exec-host/index.html`;

export const PAGE_CSP =
  "default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'";
export const WORKER_CSP =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'none'";

/** Paths under the renderer build the protocol may serve. */
const SERVED = ['exec-host/', 'assets/', 'pyodide/'];

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8', // dev server output
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip',
};

/** Privileges for `protocol.registerSchemesAsPrivileged`. */
export const EXEC_SCHEME_PRIVILEGES: CustomScheme = {
  scheme: EXEC_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true },
};

/**
 * Call before `app.whenReady()`, when this is the only custom scheme (checks).
 * Electron takes one `registerSchemesAsPrivileged` call; the app registers
 * all its schemes together in `main/index.ts`.
 */
export function registerExecScheme(): void {
  protocol.registerSchemesAsPrivileged([EXEC_SCHEME_PRIVILEGES]);
}

export interface ExecHostOptions {
  /** The renderer build folder (`out/renderer`). */
  rendererDir: string;
  /** The built execution host preload (`out/preload/exec-host.cjs`). */
  preloadPath: string;
  /** In development: the Vite dev server to proxy instead of reading files. */
  devServerUrl?: string | undefined;
  /** Open DevTools on the hidden window (development only). */
  devTools?: boolean;
  /** Called with every request the partition blocked (for checks and logging). */
  onBlocked?: (url: string) => void;
  /** Called with the host page's console messages (checks and development). */
  onConsole?: (message: string) => void;
  /** Extra time allowed per job on top of its tests' limits. */
  watchdogMs?: number;
}

/** Serve `tutor-exec://host/<path>` from the renderer build, or the dev server. */
async function serve(request: Request, opts: ExecHostOptions): Promise<Response> {
  const url = new URL(request.url);
  const path = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  // In development every path goes to the local dev server (Vite's module
  // URLs: /@fs/, /@vite/, /node_modules/); packaged builds serve only SERVED.
  const servable = opts.devServerUrl !== undefined || SERVED.some((p) => path.startsWith(p));
  if (url.host !== 'host' || !servable || path.includes('..')) {
    return new Response('not found', { status: 404 });
  }
  const isPage = path.endsWith('.html');
  const headers: Record<string, string> = {
    'Content-Security-Policy': isPage ? PAGE_CSP : WORKER_CSP,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  };
  if (opts.devServerUrl) {
    const upstream = await net.fetch(new URL(path + url.search, `${opts.devServerUrl}/`).href);
    const body = await upstream.arrayBuffer();
    const type = upstream.headers.get('content-type') ?? 'application/octet-stream';
    return new Response(body, {
      status: upstream.status,
      headers: { ...headers, 'Content-Type': type },
    });
  }
  const file = normalize(join(opts.rendererDir, path));
  if (!file.startsWith(normalize(opts.rendererDir) + sep))
    return new Response('not found', { status: 404 });
  try {
    const body = await readFile(file);
    const type = TYPES[extname(file)] ?? 'application/octet-stream';
    return new Response(body, { headers: { ...headers, 'Content-Type': type } });
  } catch {
    return new Response('not found', { status: 404 });
  }
}

function lockDownSession(ses: Session, opts: ExecHostOptions): void {
  ses.protocol.handle(EXEC_SCHEME, (req) => serve(req, opts));
  ses.webRequest.onBeforeRequest((details, callback) => {
    const allowed =
      details.url.startsWith(`${ORIGIN}/`) ||
      (opts.devTools === true && details.url.startsWith('devtools://'));
    if (!allowed) opts.onBlocked?.(details.url);
    callback({ cancel: !allowed });
  });
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', (e) => e.preventDefault());
}

type Pending = { resolve: (m: HostToMain) => void; reject: (e: Error) => void };

export class ExecHost implements HarnessTransport {
  private win: BrowserWindow | undefined;
  private port: MessagePortMain | undefined;
  private connecting: Promise<MessagePortMain> | undefined;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private sessionReady = false;

  constructor(private readonly opts: ExecHostOptions) {}

  async status(): Promise<ExecutorStatus> {
    const reply = await this.request({ type: 'status', id: this.nextId++ }, 120_000);
    if (reply.type !== 'status') throw new Error('unexpected reply');
    return reply.available
      ? { available: true, ...(reply.versions ? { versions: { ...reply.versions } } : {}) }
      : { available: false, reason: reply.reason ?? 'Pyodide is not available' };
  }

  async run(request: HarnessRequest, signal?: CancelSignal): Promise<HarnessOutput> {
    const id = this.nextId++;
    // Start-up, plus every test at its limit and a worker restart after each.
    const budget =
      (this.opts.watchdogMs ?? 120_000) + request.inputs.length * (request.timeLimitMs + 5_000);
    const onAbort = (): void => this.port?.postMessage({ type: 'cancel', id } satisfies MainToHost);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const reply = await this.request({ type: 'run', id, request }, budget);
      if (reply.type !== 'output') throw new Error('unexpected reply');
      return reply.output;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /** Run JavaScript in the host page (checks only: `check.ts`). */
  async evaluate(code: string): Promise<unknown> {
    await this.connect();
    return this.win!.webContents.executeJavaScript(code);
  }

  /** Close the window; the next request opens a new one. */
  dispose(reason = 'the execution host was closed'): void {
    for (const p of this.pending.values()) p.reject(new Error(reason));
    this.pending.clear();
    this.port?.close();
    this.port = undefined;
    this.connecting = undefined;
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = undefined;
  }

  private async request(msg: MainToHost & { id: number }, timeoutMs: number): Promise<HostToMain> {
    const port = await this.connect();
    return new Promise<HostToMain>((resolve, reject) => {
      const timer = setTimeout(() => {
        // The host stopped answering: start over with a new window.
        this.dispose('the execution host stopped responding');
      }, timeoutMs);
      this.pending.set(msg.id, {
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      port.postMessage(msg);
    });
  }

  private connect(): Promise<MessagePortMain> {
    if (this.port) return Promise.resolve(this.port);
    this.connecting ??= this.open().catch((e: unknown) => {
      this.dispose(String(e));
      throw e;
    });
    return this.connecting;
  }

  private async open(): Promise<MessagePortMain> {
    await app.whenReady();
    const ses = session.fromPartition(EXEC_PARTITION, { cache: false });
    if (!this.sessionReady) {
      lockDownSession(ses, this.opts);
      this.sessionReady = true;
    }
    const win = new BrowserWindow({
      show: false,
      width: 400,
      height: 300,
      webPreferences: {
        session: ses,
        preload: this.opts.preloadPath,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        webSecurity: true,
        backgroundThrottling: false,
        spellcheck: false,
        devTools: this.opts.devTools === true,
      },
    });
    this.win = win;
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.on('render-process-gone', (_e, details) =>
      this.dispose(`the execution host stopped (${details.reason})`),
    );
    win.on('closed', () => {
      if (this.win === win) this.dispose();
    });
    if (this.opts.onConsole) {
      const onConsole = this.opts.onConsole;
      win.webContents.on('console-message', (e) => onConsole(`${e.level}: ${e.message}`));
    }
    if (this.opts.devTools) win.webContents.openDevTools({ mode: 'detach' });

    await win.loadURL(PAGE);
    const { port1, port2 } = new MessageChannelMain();
    const hello = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the execution host did not start')), 30_000);
      port1.on('message', (e: { data: HostToMain }) => {
        const m = e.data;
        if (m.type === 'hello') {
          clearTimeout(timer);
          resolve();
          return;
        }
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        p?.resolve(m);
      });
    });
    port1.start();
    win.webContents.postMessage('exec-host:port', null, [port2]);
    await hello;
    this.port = port1;
    return port1;
  }
}
