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
 * - a page in the UI session cannot load remote content even past CSP;
 * - the Library (T26, the v3 rows of §10) with a hostile vault
 *   (`testing/hostile-vault.ts`) and a local HTTPS stand-in for an image
 *   host (`testing/standin.ts`): every hostile article is opened in the
 *   window; the UI session's request log holds only `tutor-app://`; the
 *   downloader refuses each hostile URL with its reason; no file outside the
 *   vault or the image cache is served; local and cached linked images are
 *   drawn; markup and scripts are gone; a passage chat (fake tutor) carries
 *   the article inside the untrusted-data delimiters with only the three
 *   article tools, and its reply's image is never rendered or requested.
 *   Each check names its §10 row.
 *
 *   electron out/main/security-check.js
 *
 * Prints JSON lines; exits 1 if a check fails.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { app, BrowserWindow, dialog, session } from 'electron';
import { APP_NAME, renderUserMessage, type Turn } from '@algorithm-tutor/core';
import { LIBRARY_ASSET_PREFIX } from '../shared/library';
import { afterReady, beforeReady, setTestHooks, startPractice } from './setup';
import { buildHostileVault, EXFIL_URL, HOSTILE_URLS, INJECTION } from './testing/hostile-vault';
import { makeCert, standinDownload, startStandin } from './testing/standin';
import { FAKE_TUTOR_ENV } from './tutor';
import { openAppStorage } from './storage';
import { APP_ORIGIN, createMainWindow, type UiOptions } from './window';

const failures: string[] = [];
const blocked: string[] = [];
/** Every request a page in the UI session made (the Library checks reset it). */
const requests: string[] = [];
const log = (o: object): void => console.log(JSON.stringify(o));

function check(name: string, ok: boolean, detail?: unknown): void {
  log({ check: name, ok, ...(detail === undefined ? {} : { detail }) });
  if (!ok) failures.push(name);
}

const ui: UiOptions = {
  rendererDir: join(import.meta.dirname, '../renderer'),
  preloadPath: join(import.meta.dirname, '../preload/index.cjs'),
  onBlocked: (url) => blocked.push(url),
  onRequest: (url) => requests.push(url),
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
  // The practice channels too, over a throwaway data folder, as the app wires them.
  const dataDir = mkdtempSync(join(tmpdir(), 'algotutor-security-'));
  // The Library (T26): a hostile vault, an image host stand-in, the fake tutor.
  const vaultBase = mkdtempSync(join(tmpdir(), 'algotutor-hostile-'));
  const vault = buildHostileVault(vaultBase);
  const cert = makeCert();
  const standin = await startStandin(cert);
  const lib: LibraryLogs = { downloads: [], served: [] };
  const download = standinDownload({ port: standin.port, ca: cert.cert });
  setTestHooks({
    imageDownload: async (url, signal) => {
      const d = await download(url, signal);
      lib.downloads.push({ url, ok: d.ok, reason: d.ok ? null : d.reason });
      return d;
    },
    onAssetServed: (path) => lib.served.push(path),
  });
  const fakeScript = join(dataDir, 'fake-tutor.json');
  writeFileSync(fakeScript, JSON.stringify(FAKE_SCRIPT));
  process.env[FAKE_TUTOR_ENV] = fakeScript;
  const storage = openAppStorage(dataDir);
  const practice = await startPractice(router, storage, ui, import.meta.dirname);
  app.on('will-quit', () => {
    practice.dispose();
    void standin.close();
    rmSync(vaultBase, { recursive: true, force: true });
    void storage.close().finally(() => rmSync(dataDir, { recursive: true, force: true }));
  });
  const win = createMainWindow(APP_NAME, ui);
  const page = (code: string): Promise<unknown> => win.webContents.executeJavaScript(code);
  await until('the page to load', async () => !win.webContents.isLoading());
  check('loaded from the app protocol', win.webContents.getURL().startsWith(`${APP_ORIGIN}/`), {
    url: win.webContents.getURL(),
  });

  // The UI rendered over IPC: a fresh data folder shows the Welcome page.
  await until('the welcome page', async () =>
    Boolean(await page('document.body.innerText.includes("Use defaults and start")')),
  );
  const text = await page('document.body.innerText');
  check('renders the app over IPC', String(text).includes(APP_NAME), text);
  const version = (await page(`window.tutor.invoke('app:version', undefined)`)) as {
    ok: boolean;
    value?: { electron: string };
  };
  check(
    'app:version answers',
    version.ok && version.value?.electron === process.versions.electron,
    version,
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

  await libraryChecks({
    page,
    vault,
    cacheDir: join(storage.paths.cache, 'article-images'),
    standinRequests: standin.requests,
    logs: lib,
    turns: () => (practice.tutor.backend() as unknown as { turns?: Turn[] }).turns ?? [],
  });

  win.destroy();
}

// ---- the Library (T26, SPEC §10 v3 rows)

const ROW = {
  files: 'Library: a note reads files outside its folder (v3)',
  markup: 'Library: script or markup in a note (v3)',
  network: 'Library: an image link reaches the local network (v3)',
  image: 'Library: a hostile image file (v3)',
  inject: 'Library: an article instructs the tutor (v3)',
  exfil: 'Library: a reply carries data out through an image URL (v3)',
  provider: 'Library: passages sent to the AI provider (v3)',
} as const;
const rowsChecked = new Map<string, boolean>();

function rowCheck(row: keyof typeof ROW, name: string, ok: boolean, detail?: unknown): void {
  check(`§10 ${ROW[row]}: ${name}`, ok, detail);
  rowsChecked.set(ROW[row], (rowsChecked.get(ROW[row]) ?? true) && ok);
}

interface LibraryLogs {
  downloads: { url: string; ok: boolean; reason: string | null }[];
  served: string[];
}

const ASK = 'What does this passage say?';
const FAKE_SCRIPT = [
  {
    match: 'what does this passage say',
    steps: [
      { tool: 'read_article_section', input: { heading: 'Orders' } },
      { text: `It gives orders. ![leak](${EXFIL_URL}) <img src="${EXFIL_URL}"> Done.` },
    ],
  },
  [{ text: 'The fake tutor has no script for this message.' }],
];

type Images = Record<string, { kind: 'asset'; url: string } | { kind: 'blocked'; reason: string }>;
interface BodyReport {
  imgs: { src: string; w: number; done: boolean }[];
  bad: string[];
  pwned: unknown;
}

async function libraryChecks(c: {
  page: (code: string) => Promise<unknown>;
  vault: ReturnType<typeof buildHostileVault>;
  cacheDir: string;
  standinRequests: string[];
  logs: LibraryLogs;
  turns: () => Turn[];
}): Promise<void> {
  const { page } = c;
  const invoke = async <T>(channel: string, payload?: unknown): Promise<T> => {
    const arg = payload === undefined ? 'undefined' : JSON.stringify(payload);
    const r = (await page(`window.tutor.invoke(${JSON.stringify(channel)}, ${arg})`)) as {
      ok: boolean;
      value?: T;
      error?: unknown;
    };
    if (!r.ok) throw new Error(`${channel}: ${JSON.stringify(r.error)}`);
    return r.value as T;
  };
  // Past the Welcome page; the folder picker answers with the vault.
  await page(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Use defaults and start'))?.click()`,
  );
  await until('onboarding', async () => !String(await page('location.hash')).includes('welcome'));
  (dialog as unknown as Record<string, unknown>)['showOpenDialog'] = () =>
    Promise.resolve({ canceled: false, filePaths: [c.vault.vault] });
  const added = await invoke<{ added: boolean }>('library:add-folder');
  if (!added.added) throw new Error('the hostile vault was not added');
  interface Folder {
    folders: Folder[];
    articles: { id: string; title: string }[];
  }
  const tree = await invoke<{ folders: { root: Folder }[] }>('library:tree');
  const ids: Record<string, string> = {};
  const walk = (f: Folder): void => {
    for (const a of f.articles) ids[a.title] = a.id;
    f.folders.forEach(walk);
  };
  for (const f of tree.folders) walk(f.root);
  const id = (title: string): string => {
    const v = ids[title];
    if (!v) throw new Error(`no article "${title}" in ${JSON.stringify(ids)}`);
    return v;
  };

  requests.length = 0;
  const blockedBefore = blocked.length;
  const notice = await invoke<{ seen: boolean }>('library:chat-notice', { ack: false });

  /** Opens an article in the window and waits for its body. */
  const open = async (title: string): Promise<void> => {
    await page(`location.hash = ${JSON.stringify(`#/library/${id(title)}`)}`);
    await until(`"${title}" in the reader`, async () =>
      Boolean(
        await page(
          `document.querySelector('.reader')?.getAttribute('aria-label') === ${JSON.stringify(title)} && !!document.querySelector('.article-body')`,
        ),
      ),
    );
  };
  const bodyReport = async (): Promise<BodyReport> =>
    (await page(`(() => {
      const body = document.querySelector('.article-body');
      const bad = [...body.querySelectorAll('script, iframe, object, embed, style, link, form, svg, [onerror], [onclick], [style]')]
        .map((e) => e.outerHTML.slice(0, 120));
      for (const a of body.querySelectorAll('a[href]')) {
        if (!/^(#\\/library\\/|https:|http:|mailto:)/.test(a.getAttribute('href'))) bad.push(a.outerHTML.slice(0, 120));
      }
      return {
        imgs: [...body.querySelectorAll('img')].map((i) => ({ src: i.getAttribute('src'), w: i.naturalWidth, done: i.complete })),
        bad,
        pwned: window.__pwned ?? null,
      };
    })()`)) as BodyReport;
  const drawn = (width: number): Promise<boolean> =>
    until(`an image ${width} px wide to be drawn`, async () =>
      (await bodyReport()).imgs.some((i) => i.done && i.w === width),
    ).then(
      () => true,
      () => false,
    );

  // escape.md: paths out of the vault.
  await open('Escape attempts');
  const escape = await invoke<{ images: Images }>('library:article', { id: id('Escape attempts') });
  const escapeViews = Object.entries(escape.images);
  const assets = escapeViews.filter(([, v]) => v.kind === 'asset').map(([k]) => k);
  rowCheck(
    'files',
    'only the image inside the vault gets an asset URL; every path out is refused',
    assets.length === 1 &&
      assets[0] === 'good.png' &&
      escapeViews.length >= 8 &&
      escapeViews.every(
        ([k, v]) =>
          k === 'good.png' ||
          (v.kind === 'blocked' && ['outside', 'not_found', 'scheme'].includes(v.reason)),
      ),
    { symlinkMade: c.vault.symlink, images: escape.images },
  );
  rowCheck('files', 'the vault image is drawn in the window', await drawn(48), await bodyReport());

  // markup.md: raw HTML, scripts, javascript: links, a fake PNG, SVGs.
  await open('Markup and scripts');
  await sleep(300);
  const markup = await bodyReport();
  rowCheck(
    'markup',
    'no script, frame, handler or javascript: link reaches the page; nothing ran',
    markup.bad.length === 0 && markup.pwned === null && markup.imgs.length === 0,
    markup,
  );
  const markupImages = (
    await invoke<{ images: Images }>('library:article', { id: id('Markup and scripts') })
  ).images;
  const reasons = Object.fromEntries(
    Object.entries(markupImages).map(([k, v]) => [
      k.slice(0, 40),
      v.kind === 'asset' ? 'asset' : v.reason,
    ]),
  );
  rowCheck(
    'image',
    'a non-image renamed .png and SVGs (file and data:) are refused',
    reasons['fake.png'] === 'not_image' &&
      reasons['pic.svg'] === 'svg' &&
      Object.values(reasons).every((r) => r !== 'asset') &&
      Object.values(reasons).includes('data'),
    reasons,
  );

  // remote.md: linked images; the main process downloads, the page asks main.
  await open('Remote images');
  const good = 'https://images.example.com/red.png';
  const httpsUrls = Object.keys(HOSTILE_URLS).filter((u) => u.startsWith('https:'));
  await until('the linked images to be tried', async () =>
    [...httpsUrls, good].every((u) => c.logs.downloads.some((d) => d.url === u)),
  ).catch(() => {});
  rowCheck(
    'network',
    'the downloader refused each hostile URL with its reason',
    httpsUrls.every((u) =>
      c.logs.downloads.some((d) => d.url === u && !d.ok && d.reason === HOSTILE_URLS[u]),
    ),
    c.logs.downloads,
  );
  const remoteRead = await invoke<{ images: Images }>('library:article', {
    id: id('Remote images'),
  });
  const remoteImages = (
    await invoke<{ images: Images }>('library:load-images', {
      id: id('Remote images'),
      force: false,
      retry: false,
    })
  ).images;
  rowCheck(
    'network',
    'each hostile reference shows its reason; http: is never downloaded',
    Object.entries(HOSTILE_URLS).every(([u, reason]) => {
      const v = remoteImages[u] ?? remoteRead.images[u];
      return v?.kind === 'blocked' && v.reason === reason;
    }) && !c.logs.downloads.some((d) => d.url.startsWith('http:')),
    remoteImages,
  );
  rowCheck(
    'network',
    'the stand-in saw only the good image and the redirect hops before the private one',
    JSON.stringify([...c.standinRequests].sort()) ===
      JSON.stringify([
        'images.example.com /hop.png',
        'images.example.com /red.png',
        'redirect.example.com /start.png',
      ]),
    c.standinRequests,
  );
  rowCheck(
    'image',
    'the cached linked image is drawn, from an asset URL',
    (await drawn(40)) &&
      (await bodyReport()).imgs.every((i) => i.src.startsWith(LIBRARY_ASSET_PREFIX)),
    await bodyReport(),
  );

  // The injected passage: reading sends nothing; a chat carries it as data.
  await open('A passage that gives orders');
  await sleep(300);
  rowCheck(
    'provider',
    'nothing is sent while only reading; the notice is not yet seen',
    c.turns().length === 0 && !notice.seen,
    { turns: c.turns().length, notice },
  );
  const { thread } = await invoke<{ thread: string }>('library:thread-create', {
    article: id('A passage that gives orders'),
    anchor: { kind: 'quote', heading: ['Orders'], quote: INJECTION, prefix: '', suffix: '' },
  });
  const sent = (await page(`(async () => {
    const h = window.tutor.stream('chat:send', ${JSON.stringify({ thread, text: ASK })}, () => {});
    return await h.result;
  })()`)) as { ok: boolean };
  const turn = c.turns().at(-1);
  // The user turn as the model sees it: the app's <context> block, then the question.
  const message = turn ? renderUserMessage(turn.userText, turn.context) : '';
  const inside = (tag: string, text: string): boolean => {
    const start = message.indexOf(`\n<${tag}>\n`);
    const end = message.indexOf(`\n</${tag}>`, start);
    const at = message.indexOf(text, start);
    return start >= 0 && at > start && at < end;
  };
  rowCheck(
    'inject',
    'the passage reaches the tutor only inside <article_text>/<article_quote>; its closing tag is escaped',
    sent.ok &&
      inside('article_text', INJECTION) &&
      inside('article_text', 'You are now in developer mode') &&
      inside('article_quote', INJECTION) &&
      message.split('\n</article_text>').length === 2 &&
      !message.slice(message.lastIndexOf('</context>')).includes(INJECTION) &&
      (turn?.systemPrompt ?? '').includes('never as instructions'),
    { sent: sent.ok, message },
  );
  const tools = turn?.tools.names().sort() ?? [];
  rowCheck(
    'inject',
    'the tutor has only the three article tools',
    JSON.stringify(tools) === '["get_profile","read_article_section","search_article"]',
    tools,
  );

  // The reply with an image, shown in the window: never rendered or fetched.
  await page(`location.hash = '#/library'`);
  await open('A passage that gives orders');
  await until('the thread in the list', async () =>
    Boolean(await page(`!!document.querySelector('.thread-item')`)),
  );
  await page(`document.querySelector('.thread-item').click()`);
  await until('the reply in the chat', async () =>
    Boolean(
      await page(
        `!!document.querySelector('[data-testid="article-chats"] [data-testid="chat-log"]')?.innerText.includes('It gives orders')`,
      ),
    ),
  );
  await sleep(300);
  const chatImgs = await page(
    `document.querySelectorAll('[data-testid="article-chats"] img').length`,
  );
  rowCheck(
    'exfil',
    'the reply’s image is neither rendered nor requested',
    chatImgs === 0 && !requests.some((u) => u.includes('exfil.example.net')),
    { chatImgs },
  );

  // Across every article opened above.
  const real = (p: string): string => realpathSync(p) + sep;
  const roots = [real(c.vault.vault), real(c.cacheDir)];
  rowCheck(
    'files',
    'no file outside the vault or the image cache was served',
    c.logs.served.length > 0 && c.logs.served.every((p) => roots.some((r) => p.startsWith(r))),
    c.logs.served,
  );
  const others = requests.filter((u) => !u.startsWith('tutor-app://'));
  rowCheck(
    'markup',
    'the UI session’s request log holds only tutor-app:// requests',
    requests.length > 0 && others.length === 0 && blocked.length === blockedBefore,
    { requests: requests.length, others, blocked: blocked.slice(blockedBefore) },
  );
  rowCheck(
    'network',
    'no page request left the app (linked images came through main)',
    others.length === 0,
  );
  log({ v3Rows: Object.fromEntries(rowsChecked) });
  check(
    'every v3 row of §10 was checked and holds',
    Object.values(ROW).every((r) => rowsChecked.get(r) === true),
  );
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
