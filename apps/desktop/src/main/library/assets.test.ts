/**
 * The reader in main (T22, SPEC §15.2–15.3): image references resolved as
 * Obsidian does, only files inside the folder that are real images, served
 * by token with their type and `nosniff`; wikilinks; external links.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcResult } from '../../shared/ipc';
import type { ArticleView } from '../../shared/library';
import { IpcRouter } from '../ipc/router';
import { FakeIpcMain, page } from '../ipc/testing';
import { openDatabase } from '../storage/database';
import { SettingsStore, SqliteStorage } from '../storage';
import { LibraryService } from './service';
import {
  AssetRegistry,
  extractRefs,
  isLibraryAssetRequest,
  registerReaderHandlers,
  sniffImage,
} from './assets';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00', 'latin1');
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([20, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
  Buffer.alloc(8),
]);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';

let base: string;
let vault: string;
let outside: string;
let storage: SqliteStorage;
let library: LibraryService;
let assets: AssetRegistry;
let ipc: FakeIpcMain;
let opened: string[];
let tokens: number;

const write = (dir: string, rel: string, data: string | Buffer): void => {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), data);
};

async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const r = (await ipc.invoke(page().event, channel, payload)) as IpcResult<T>;
  if (!r.ok) throw Object.assign(new Error(r.error.message), r.error);
  return r.value;
}

const get = (url: string) => assets.serve(new Request(url));

beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), 'tutor-reader-'));
  vault = join(base, 'Vault');
  outside = join(base, 'Elsewhere');
  mkdirSync(vault);
  mkdirSync(outside);
  write(outside, 'secret.png', PNG);
  write(vault, 'attachments/photo.png', PNG);
  write(vault, 'attachments/deep/photo.png', JPEG);
  write(vault, 'pics/anim.gif', GIF);
  write(vault, 'pics/pic.webp', WEBP);
  write(vault, 'sub/here.jpg', JPEG);
  write(vault, 'My Image.png', PNG);
  write(vault, 'fake.png', '<html><script>alert(1)</script></html>');
  write(vault, 'logo.svg', SVG);
  write(vault, 'disguised.png', SVG);
  symlinkSync(join(outside, 'secret.png'), join(vault, 'link.png'));
  write(vault, 'Other note.md', '# Other');
  write(vault, 'sub/Nested.md', '# Nested');
  storage = new SqliteStorage(openDatabase(':memory:').db);
  const settings = SettingsStore.load(join(base, 'data', 'settings.json'));
  let ids = 0;
  opened = [];
  tokens = 0;
  library = new LibraryService({
    settings,
    storage,
    now: () => '2026-11-20T10:00:00.000Z',
    newId: () => `id-${++ids}`,
    chooseFolder: async () => vault,
    openPath: async () => true,
  });
  assets = new AssetRegistry({
    newToken: () => `token-${String(++tokens).padStart(12, '0')}`,
    isLibraryFolder: (id) => library.paths().some((f) => f.id === id),
  });
  ipc = new FakeIpcMain();
  const router = new IpcRouter(ipc, { isTrustedUrl: () => true });
  registerReaderHandlers(router, library, {
    assets,
    openExternal: async (u) => (opened.push(u), true),
  });
});

afterEach(async () => {
  await storage.close();
  rmSync(base, { recursive: true, force: true });
});

const note = () =>
  [
    '---',
    'title: Reading test',
    'source: https://example.com/post',
    'author: "[[Ada]]"',
    'tags: [algorithms, graphs]',
    'rating: 5',
    '---',
    '# Heading',
    '![[photo.png]] ![[photo.png|300]] ![alt](sub/here.jpg) ![[pics/anim.gif]] ![w](pics/pic.webp)',
    '![sp](My%20Image.png) ![sp2](<My Image.png>)',
    `![up](../Elsewhere/secret.png) ![abs](${join(outside, 'secret.png')})`,
    '![enc](%2e%2e/Elsewhere/secret.png) ![win](..\\Elsewhere\\secret.png) ![[link.png]]',
    '![f](fake.png) ![s](logo.svg) ![d](disguised.png) ![n](nowhere.png)',
    '![r](https://cdn.example.com/a.png) ![h](http://insecure.example/a.png)',
    '![file](file:///etc/a.png) ![data](data:image/png;base64,iVBORw0KGgo=)',
    '[[Other note]] [[Nested|label]] [[sub/Nested#Part]] [[Gone]] ![[Other note]]',
    '```',
    '![[in-code.png]] [[in code]]',
    '```',
    'and `![[inline.png]]`',
  ].join('\n');

async function openNote(): Promise<ArticleView> {
  write(vault, 'note.md', note());
  await library.addFolder();
  const id = library.tree()[0]!.root.articles.find((a) => a.title === 'Reading test')!.id;
  return call<ArticleView>('library:article', { id });
}

describe('references', () => {
  it('finds images and wikilinks, not inside code', () => {
    const refs = extractRefs(note().slice(note().indexOf('# Heading')));
    expect(refs.images).toContain('photo.png');
    expect(refs.images).toContain('My Image.png');
    expect(refs.images).toContain('sub/here.jpg');
    expect(refs.images).not.toContain('in-code.png');
    expect(refs.images).not.toContain('inline.png');
    expect(refs.links).toEqual(['Other note', 'Nested', 'sub/Nested', 'Gone']);
  });

  it('knows image magic bytes, and SVG is none', () => {
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(JPEG)).toBe('image/jpeg');
    expect(sniffImage(GIF)).toBe('image/gif');
    expect(sniffImage(WEBP)).toBe('image/webp');
    expect(sniffImage(Buffer.from(SVG))).toBeNull();
  });
});

describe('library:article', () => {
  it('gives the header, body and wikilinks, with no path in the reply', async () => {
    const a = await openNote();
    expect(a.title).toBe('Reading test');
    expect(a.source).toBe('https://example.com/post');
    expect(a.author).toEqual(['Ada']);
    expect(a.tags).toEqual(['algorithms', 'graphs']);
    expect(a.extra).toEqual([['rating', '5']]);
    expect(a.missing).toBe(false);
    expect(a.body.startsWith('# Heading')).toBe(true);
    const ids = Object.fromEntries(library.tree()[0]!.root.articles.map((x) => [x.title, x.id]));
    const nested = library.tree()[0]!.root.folders[0]!.articles[0]!.id;
    expect(a.links).toEqual({
      'Other note': ids['Other note'],
      Nested: nested,
      'sub/Nested': nested,
      Gone: null,
    });
    // Only the note's own text (body, reference keys) may hold one.
    expect(JSON.stringify({ ...a, body: '', images: Object.values(a.images) })).not.toContain(base);
  });

  it('resolves local images and refuses the rest, each with a reason', async () => {
    const a = await openNote();
    const reason = (k: string) => {
      const v = a.images[k]!;
      return v.kind === 'asset' ? 'asset' : v.reason;
    };
    for (const k of [
      'photo.png',
      'sub/here.jpg',
      'pics/anim.gif',
      'pics/pic.webp',
      'My%20Image.png',
      'My Image.png',
    ])
      expect(reason(k), k).toBe('asset');
    for (const k of [
      '../Elsewhere/secret.png',
      join(outside, 'secret.png'),
      '%2e%2e/Elsewhere/secret.png',
      '..\\Elsewhere\\secret.png',
      'link.png',
    ])
      expect(reason(k), k).toBe('outside');
    expect(reason('fake.png')).toBe('not_image');
    expect(reason('logo.svg')).toBe('svg');
    expect(reason('disguised.png')).toBe('not_image');
    expect(reason('nowhere.png')).toBe('not_found');
    expect(a.images['https://cdn.example.com/a.png']).toEqual({
      kind: 'blocked',
      reason: 'remote',
      host: 'cdn.example.com',
    });
    expect(reason('http://insecure.example/a.png')).toBe('insecure');
    expect(reason('file:///etc/a.png')).toBe('scheme');
    expect(reason('data:image/png;base64,iVBORw0KGgo=')).toBe('data');
  });

  it('picks the shortest path for an ambiguous name', async () => {
    const a = await openNote();
    const url = (a.images['photo.png'] as { url: string }).url;
    const res = await get(url);
    // attachments/photo.png (PNG) over attachments/deep/photo.png (JPEG).
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('uses no network while opening an article', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('network unavailable')));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const a = await openNote();
      expect(a.images['https://cdn.example.com/a.png']).toMatchObject({ reason: 'remote' });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('says "missing" when the file is gone, without failing', async () => {
    const a0 = await openNote();
    rmSync(join(vault, 'note.md'));
    const a = await call<ArticleView>('library:article', { id: a0.id });
    expect(a).toMatchObject({ missing: true, body: '', title: 'Reading test', images: {} });
    await expect(call('library:article', { id: 'nope' })).rejects.toMatchObject({
      reason: 'not_found',
    });
  });
});

describe('the asset route', () => {
  it('serves PNG, JPEG, GIF and WebP with the right type and nosniff', async () => {
    const a = await openNote();
    const want: Record<string, string> = {
      'My Image.png': 'image/png',
      'sub/here.jpg': 'image/jpeg',
      'pics/anim.gif': 'image/gif',
      'pics/pic.webp': 'image/webp',
    };
    for (const [k, type] of Object.entries(want)) {
      const v = a.images[k]!;
      expect(v.kind).toBe('asset');
      const url = (v as { url: string }).url;
      expect(url).toMatch(/^tutor-app:\/\/app\/library-asset\/[A-Za-z0-9_-]+$/);
      expect(isLibraryAssetRequest(url)).toBe(true);
      const res = await get(url);
      expect(res.status, k).toBe(200);
      expect(res.headers.get('content-type')).toBe(type);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    }
  });

  it('refuses unknown tokens, paths in place of a token, and files changed since', async () => {
    const a = await openNote();
    for (const url of [
      'tutor-app://app/library-asset/token-999999999999',
      'tutor-app://app/library-asset/',
      'tutor-app://app/library-asset/..%2f..%2fElsewhere%2fsecret.png',
      `tutor-app://app/library-asset/${encodeURIComponent(join(outside, 'secret.png'))}`,
      'tutor-app://app/library-asset/%2e%2e/%2e%2e/Elsewhere/secret.png',
      'tutor-app://other/library-asset/token-000000000001',
    ]) {
      expect((await get(url)).status, url).toBe(404);
    }
    const url = (a.images['My Image.png'] as { url: string }).url;
    expect((await assets.serve(new Request(url, { method: 'POST' }))).status).toBe(404);
    // Replaced by a non-image, or by a link out of the folder: no longer served.
    writeFileSync(join(vault, 'My Image.png'), '<html></html>');
    expect((await get(url)).status).toBe(404);
    rmSync(join(vault, 'My Image.png'));
    symlinkSync(join(outside, 'secret.png'), join(vault, 'My Image.png'));
    expect((await get(url)).status).toBe(404);
  });

  it('stops serving a removed folder', async () => {
    const a = await openNote();
    const url = (a.images['sub/here.jpg'] as { url: string }).url;
    expect((await get(url)).status).toBe(200);
    await library.removeFolder(library.paths()[0]!.id);
    expect((await get(url)).status).toBe(404);
  });

  it('gives random tokens by default', () => {
    const r = new AssetRegistry();
    const u1 = r.url('f', '/v', '/v/a.png');
    const u2 = r.url('f', '/v', '/v/b.png');
    expect(u1).not.toBe(u2);
    expect(r.url('f', '/v', '/v/a.png')).toBe(u1);
    expect(u1.split('/').pop()!.length).toBeGreaterThanOrEqual(32);
  });
});

describe('library:open-link', () => {
  it('opens https, http and mailto only', async () => {
    for (const u of ['https://example.com/a', 'http://example.com/', 'mailto:a@example.com'])
      expect(await call('library:open-link', { url: u })).toEqual({ opened: true });
    for (const u of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'tutor-app://app/renderer/index.html',
      'data:text/html,x',
      'not a url',
      'smb://host/share',
    ])
      await expect(call('library:open-link', { url: u }), u).rejects.toMatchObject({
        reason: 'scheme',
      });
    expect(opened).toEqual([
      'https://example.com/a',
      'http://example.com/',
      'mailto:a@example.com',
    ]);
  });
});
