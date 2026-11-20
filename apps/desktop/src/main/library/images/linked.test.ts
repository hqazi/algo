/**
 * Linked and `data:` images in the reader (T23, SPEC §15.4): only
 * references in the article file load, `ask` mode, the cache served through
 * the asset route with the network gone, failure memory and Retry, limits,
 * Clear, and "Make available offline". A fake downloader stands in for the
 * network.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STREAM_START, type IpcResult } from '../../../shared/ipc';
import type { ArticleView, ImageView } from '../../../shared/library';
import { IpcRouter } from '../../ipc/router';
import { FakeIpcMain, page } from '../../ipc/testing';
import { openDatabase } from '../../storage/database';
import { SettingsStore, SqliteStorage } from '../../storage';
import { AssetRegistry, registerReaderHandlers } from '../assets';
import { LibraryService } from '../service';
import type { Downloaded } from './download';
import { gif, png } from './fixtures';
import { registerImageHandlers } from './handlers';
import { decodeDataImage, FAILURE_MS, LinkedImages, MAX_ARTICLE_IMAGES } from './linked';

let base: string;
let vault: string;
let cacheDir: string;
let storage: SqliteStorage;
let library: LibraryService;
let assets: AssetRegistry;
let linked: LinkedImages;
let ipc: FakeIpcMain;
let mode: 'on-open' | 'ask';
let clock: number;
let network: boolean;
let downloads: string[];
let answers: Map<string, Downloaded>;

const write = (rel: string, data: string | Uint8Array): void => {
  mkdirSync(join(vault, rel, '..'), { recursive: true });
  writeFileSync(join(vault, rel), data);
};

async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const r = (await ipc.invoke(page().event, channel, payload)) as IpcResult<T>;
  if (!r.ok) throw Object.assign(new Error(r.error.message), r.error);
  return r.value;
}

const ok = (url: string, bytes: Uint8Array): Downloaded => ({
  ok: true,
  bytes,
  info: { type: 'image/png', width: 1, height: 1 },
  url,
});

const A = 'https://cdn.example.com/a.png';
const B = 'https://cdn.example.com/b.png';
const BAD = 'https://inside.example.com/c.png';
const DATA = `data:image/gif;base64,${Buffer.from(gif(2, 2)).toString('base64')}`;

async function fakeDownload(url: string): Promise<Downloaded> {
  downloads.push(url);
  if (!network) return { ok: false, reason: 'network', host: new URL(url).hostname };
  return answers.get(url) ?? { ok: false, reason: 'http', host: new URL(url).hostname };
}

async function setup(body: string): Promise<string> {
  write('Note.md', `---\ntitle: Pictures\n---\n${body}`);
  await library.addFolder();
  await library.refresh();
  return library.tree()[0]!.root.articles[0]!.id;
}

const get = (url: string) => assets.serve(new Request(url));
const urlOf = (v: ImageView | undefined) => (v?.kind === 'asset' ? v.url : null);
const reasonOf = (v: ImageView | undefined) => (v?.kind === 'blocked' ? v.reason : null);

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'tutor-linked-'));
  vault = join(base, 'Vault');
  cacheDir = join(base, 'data', 'cache', 'article-images');
  mkdirSync(vault);
  storage = new SqliteStorage(openDatabase(':memory:').db);
  const settings = SettingsStore.load(join(base, 'data', 'settings.json'));
  let ids = 0;
  library = new LibraryService({
    settings,
    storage,
    now: () => '2026-11-20T10:00:00.000Z',
    newId: () => `id-${++ids}`,
    chooseFolder: async () => vault,
    openPath: async () => true,
  });
  assets = new AssetRegistry({
    isLibraryFolder: (id) => library.paths().some((f) => f.id === id),
  });
  mode = 'on-open';
  clock = Date.parse('2026-11-20T10:00:00Z');
  network = true;
  downloads = [];
  answers = new Map([
    [A, ok(A, png(4, 4))],
    [B, ok(B, png(8, 8))],
    [BAD, { ok: false, reason: 'local_address', host: 'inside.example.com' }],
  ]);
  linked = new LinkedImages({
    cacheDir,
    assets,
    mode: () => mode,
    download: fakeDownload,
    now: () => clock,
  });
  ipc = new FakeIpcMain();
  const router = new IpcRouter(ipc, { isTrustedUrl: () => true });
  registerReaderHandlers(router, library, { assets, linked, openExternal: async () => true });
  registerImageHandlers(router, library, { assets, linked });
});

afterEach(async () => {
  await storage.close();
  rmSync(base, { recursive: true, force: true });
});

type Loaded = { mode: string; images: Record<string, ImageView> };

describe('linked images', () => {
  it('opening an article downloads nothing; loading downloads its references once', async () => {
    const id = await setup(`![a](${A}) ![b](<${B}>) ![[x.png]] ![a again](${A})\n\`![c](${BAD})\``);
    const article = await call<ArticleView>('library:article', { id });
    expect(reasonOf(article.images[A])).toBe('remote');
    expect(article.images[A]).toMatchObject({ host: 'cdn.example.com' });
    expect(downloads).toEqual([]);

    const r = await call<Loaded>('library:load-images', { id, force: false, retry: false });
    expect(r.mode).toBe('on-open');
    expect(Object.keys(r.images).sort()).toEqual([A, B]);
    // In code: never a reference, never downloaded.
    expect(downloads.sort()).toEqual([A, B]);
    const res = await get(urlOf(r.images[A])!);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    // The cache: bytes and a record, outside the vault.
    const files = readdirSync(cacheDir).sort();
    expect(files.filter((f) => f.endsWith('.json'))).toHaveLength(2);
    expect(readdirSync(vault)).toEqual(['Note.md']);
  });

  it('a cached image is served with the network off, also after a restart', async () => {
    const id = await setup(`![a](${A})`);
    await call('library:load-images', { id, force: false, retry: false });
    network = false;
    downloads = [];
    // A new session: new registry and service on the same cache.
    assets = new AssetRegistry();
    linked = new LinkedImages({ cacheDir, assets, mode: () => mode, download: fakeDownload });
    const ipc2 = new FakeIpcMain();
    const router = new IpcRouter(ipc2, { isTrustedUrl: () => true });
    registerReaderHandlers(router, library, { assets, linked, openExternal: async () => true });
    ipc = ipc2;
    const article = await call<ArticleView>('library:article', { id });
    const res = await get(urlOf(article.images[A])!);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png(4, 4));
    expect(downloads).toEqual([]);
  });

  it('ask mode loads only with Load images (force)', async () => {
    mode = 'ask';
    const id = await setup(`![a](${A})`);
    const r = await call<Loaded>('library:load-images', { id, force: false, retry: false });
    expect(r.mode).toBe('ask');
    expect(reasonOf(r.images[A])).toBe('remote');
    expect(downloads).toEqual([]);
    const forced = await call<Loaded>('library:load-images', { id, force: true, retry: false });
    expect(urlOf(forced.images[A])).toMatch(/^tutor-app:\/\/app\/library-asset\//);
  });

  it('remembers a failure for an hour; Retry tries again', async () => {
    const id = await setup(`![c](${BAD})`);
    const load = (retry = false) => call<Loaded>('library:load-images', { id, force: true, retry });
    expect((await load()).images[BAD]).toEqual({
      kind: 'blocked',
      reason: 'local_address',
      host: 'inside.example.com',
    });
    await load();
    expect(downloads).toEqual([BAD]);
    // The reader shows the remembered reason without asking again.
    const article = await call<ArticleView>('library:article', { id });
    expect(reasonOf(article.images[BAD])).toBe('local_address');
    await load(true);
    expect(downloads).toEqual([BAD, BAD]);
    clock += FAILURE_MS + 1;
    await load();
    expect(downloads).toEqual([BAD, BAD, BAD]);
  });

  it('caps the images per article', async () => {
    const refs = Array.from(
      { length: MAX_ARTICLE_IMAGES + 5 },
      (_, i) => `https://cdn.example.com/${i}.png`,
    );
    for (const u of refs) answers.set(u, ok(u, png(1, 1)));
    const id = await setup(refs.map((u) => `![](${u})`).join(' '));
    const r = await call<Loaded>('library:load-images', { id, force: true, retry: false });
    const reasons = Object.values(r.images).map((v) => (v.kind === 'asset' ? 'asset' : v.reason));
    expect(reasons.filter((x) => x === 'asset')).toHaveLength(MAX_ARTICLE_IMAGES);
    expect(reasons.filter((x) => x === 'limit')).toHaveLength(5);
    expect(downloads).toHaveLength(MAX_ARTICLE_IMAGES);
  });

  it('Clear empties the cache; its images stop being served', async () => {
    const id = await setup(`![a](${A}) ![b](${B})`);
    const r = await call<Loaded>('library:load-images', { id, force: false, retry: false });
    const usage = await call<{ images: number; bytes: number }>('library:image-cache');
    expect(usage.images).toBe(2);
    expect(usage.bytes).toBeGreaterThan(0);
    expect(await call('library:clear-image-cache')).toEqual({ images: 0, bytes: 0 });
    expect((await get(urlOf(r.images[A])!)).status).toBe(404);
    const article = await call<ArticleView>('library:article', { id });
    expect(reasonOf(article.images[A])).toBe('remote');
  });

  it('refuses an unknown article', async () => {
    await expect(
      call('library:load-images', { id: 'nope', force: true, retry: false }),
    ).rejects.toMatchObject({ code: 'refused' });
  });
});

describe('data: images', () => {
  it('are decoded, stored and served like a download', async () => {
    const id = await setup(`![d](${DATA})`);
    const article = await call<ArticleView>('library:article', { id });
    const res = await get(urlOf(article.images[DATA])!);
    expect(res.headers.get('content-type')).toBe('image/gif');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(gif(2, 2));
    expect(downloads).toEqual([]);
  });

  it('only PNG, JPEG, GIF and WebP, base64, at most 2 MB, real image bytes', async () => {
    const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
    const html = b64(new TextEncoder().encode('<html>'));
    const svg = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
    const big = `data:image/png;base64,${'A'.repeat(3 * 1024 * 1024)}`;
    expect(decodeDataImage(svg)).toEqual({ reason: 'data' });
    expect(decodeDataImage('data:image/png,%89PNG')).toEqual({ reason: 'data' });
    expect(decodeDataImage(big)).toEqual({ reason: 'oversize' });
    const id = await setup(`![h](data:image/png;base64,${html}) ![s](${svg})`);
    const article = await call<ArticleView>('library:article', { id });
    expect(reasonOf(article.images[`data:image/png;base64,${html}`])).toBe('not_image');
    expect(reasonOf(article.images[svg])).toBe('data');
  });
});

describe('Make available offline', () => {
  it('downloads every article of a folder, with progress', async () => {
    write('One.md', `![a](${A})`);
    write('sub/Two.md', `![b](${B}) ![c](${BAD})`);
    await library.addFolder();
    await library.refresh();
    const p = page();
    const r = (await ipc.invoke(p.event, STREAM_START, {
      id: 's',
      channel: 'library:offline',
      request: { id: 'id-1' },
    })) as IpcResult<unknown>;
    expect(r.ok).toBe(true);
    await new Promise((res) => setTimeout(res, 50));
    expect(downloads.sort()).toEqual([A, B, BAD]);
    const events = p.events().map((e) => (e as { event: unknown }).event);
    expect(events.at(0)).toEqual({ done: 0, total: 2, failed: 0 });
    expect(events.at(-1)).toEqual({ done: 2, total: 2, failed: 1 });
    expect(p.results()).toHaveLength(1);
    expect(JSON.stringify(p.results()[0])).toContain('"cancelled":false');
  });
});
