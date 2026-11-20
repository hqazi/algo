/**
 * The Library index on a temp folder (T21, SPEC §15.1): what a scan finds
 * and skips, identity across renames, missing files, and that nothing in
 * the chosen folder is ever written.
 */
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_NOTE_BYTES } from '@algorithm-tutor/core';
import clipped from '../../../../../packages/core/src/library/fixtures/clipped-default.md?raw';
import { STREAM_CANCEL, STREAM_START, type IpcResult } from '../../shared/ipc';
import { IpcRouter } from '../ipc/router';
import { FakeIpcMain, page } from '../ipc/testing';
import { openDatabase } from '../storage/database';
import { SettingsStore, SqliteStorage } from '../storage';
import { listArticles } from './index-store';
import { LibraryService, registerLibraryHandlers } from '.';
import type { WatchFn } from './watcher';

let base: string;
let vault: string;
let outside: string;
let storage: SqliteStorage;
let settings: SettingsStore;
let library: LibraryService;
let chosen: string | null;
let opened: string[];
let ids: number;

const write = (rel: string, text: string): void => {
  mkdirSync(join(vault, rel, '..'), { recursive: true });
  writeFileSync(join(vault, rel), text);
};

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'tutor-library-'));
  vault = join(base, 'Vault');
  outside = join(base, 'Elsewhere');
  mkdirSync(vault);
  mkdirSync(outside);
  storage = new SqliteStorage(openDatabase(':memory:').db);
  settings = SettingsStore.load(join(base, 'data', 'settings.json'));
  chosen = vault;
  opened = [];
  ids = 0;
  library = new LibraryService({
    settings,
    storage,
    now: () => '2026-11-20T10:00:00.000Z',
    newId: () => `id-${++ids}`,
    chooseFolder: async () => chosen,
    openPath: async (p) => (opened.push(p), true),
  });
});

afterEach(async () => {
  await storage.close();
  rmSync(base, { recursive: true, force: true });
});

const rows = () => storage.readSql((db) => listArticles(db));
const byPath = () => Object.fromEntries(rows().map((r) => [r.relPath, r]));

/** Every entry under `dir` with its type, size, mtime and content hash. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      const st = statSync(p, { throwIfNoEntry: false });
      const rel = relative(dir, p);
      if (e.isSymbolicLink()) out[rel] = `link ${st?.mtimeMs}`;
      else if (e.isDirectory()) {
        out[rel] = `dir ${st!.mtimeMs}`;
        walk(p);
      } else {
        const hash = createHash('sha256').update(readFileSync(p)).digest('hex');
        out[rel] = `file ${st!.size} ${st!.mtimeMs} ${hash}`;
      }
    }
  };
  out['.'] = `dir ${statSync(dir).mtimeMs}`;
  walk(dir);
  return out;
}

function seed(): void {
  write('Clippings/Binary search.md', clipped);
  write('Top.md', '# Just a heading\n');
  write('Deep/er/Note.MD', '---\ntitle: Deep one\ntags: [x, "#y"]\n---\nbody\n');
  write('.obsidian/workspace.md', 'settings, not a note');
  write('.trash/Old.md', 'deleted');
  write('Clippings/.hidden.md', 'hidden');
  write('Clippings/image.png', 'not markdown');
  write('Big.md', 'x'.repeat(MAX_NOTE_BYTES + 1));
  writeFileSync(join(outside, 'Secret.md'), '---\ntitle: Secret\n---\n');
  mkdirSync(join(outside, 'dir'));
  writeFileSync(join(outside, 'dir', 'Inner.md'), 'inner');
  symlinkSync(join(outside, 'Secret.md'), join(vault, 'Link out.md'));
  symlinkSync(join(outside, 'dir'), join(vault, 'Linked dir'));
  symlinkSync(join(vault, 'Top.md'), join(vault, 'Link in.md'));
  symlinkSync(vault, join(vault, 'Deep', 'loop'));
}

describe('scanning', () => {
  it('finds notes, skips dot-folders, large files and links out of the folder', async () => {
    seed();
    expect(await library.addFolder()).toBe(true);
    expect(Object.keys(byPath()).sort()).toEqual([
      'Clippings/Binary search.md',
      'Deep/er/Note.MD',
      'Link in.md',
      'Top.md',
    ]);
    const clip = byPath()['Clippings/Binary search.md']!;
    expect(clip).toMatchObject({
      title: 'Binary search, step by step',
      sourceUrl: 'https://example.com/articles/binary-search',
      missingSince: null,
    });
    expect(clip.frontmatter).toMatchObject({
      author: ['[[Ada Example]]', '[[Sam Sample]]'],
      published: '2026-10-02',
      tags: ['clippings'],
    });
    expect(clip.contentHash).toBe(createHash('sha256').update(clipped).digest('hex'));
    expect(byPath()['Top.md']!.title).toBe('Top');

    const [folder] = library.tree();
    expect(folder!.name).toBe('Vault');
    expect(folder!.root.folders.map((f) => f.name)).toEqual(['Clippings', 'Deep']);
    expect(folder!.root.folders[1]!.folders[0]!.articles).toEqual([
      { id: expect.any(String), title: 'Deep one', tags: ['x', 'y'], missing: false },
    ]);
    expect(library.folders()).toEqual([
      { id: 'id-1', name: 'Vault', articles: 4, missing: 0, error: null },
    ]);
  });

  it('keeps the id across a rename or move, and marks a deleted file missing', async () => {
    seed();
    write('Rename me.md', 'unique text');
    await library.addFolder();
    const before = byPath();
    renameSync(join(vault, 'Rename me.md'), join(vault, 'Renamed.md'));
    // `Link in.md` has the same content: the same file name wins.
    renameSync(join(vault, 'Top.md'), join(vault, 'Clippings', 'Top.md'));
    unlinkSync(join(vault, 'Link in.md'));
    // Edited and moved: matched by `source`.
    const edited = clipped.replace('halves the range', 'cuts the range in half');
    unlinkSync(join(vault, 'Clippings/Binary search.md'));
    write('Read/Binary search.md', edited);
    unlinkSync(join(vault, 'Deep/er/Note.MD'));
    await library.refresh();
    const after = byPath();
    expect(after['Renamed.md']!.id).toBe(before['Rename me.md']!.id);
    expect(after['Clippings/Top.md']!.id).toBe(before['Top.md']!.id);
    expect(after['Read/Binary search.md']!.id).toBe(before['Clippings/Binary search.md']!.id);
    expect(after['Deep/er/Note.MD']!.missingSince).toBe('2026-11-20T10:00:00.000Z');
    expect(after['Link in.md']!.missingSince).toBe('2026-11-20T10:00:00.000Z');
    expect(library.folders()[0]).toMatchObject({ articles: 5, missing: 2 });

    // It comes back: same id, no longer missing.
    write('Deep/er/Note.MD', 'back');
    await library.refresh();
    expect(byPath()['Deep/er/Note.MD']).toMatchObject({
      id: before['Deep/er/Note.MD']!.id,
      missingSince: null,
      title: 'Note',
    });
  });

  it('swaps two files without breaking the unique path', async () => {
    write('a.md', 'A');
    write('b.md', 'B');
    await library.addFolder();
    const before = byPath();
    renameSync(join(vault, 'a.md'), join(vault, 'tmp.md'));
    renameSync(join(vault, 'b.md'), join(vault, 'a.md'));
    renameSync(join(vault, 'tmp.md'), join(vault, 'b.md'));
    await library.refresh();
    // Same paths seen again: the rows keep their paths, with the new content.
    expect(byPath()['a.md']!.id).toBe(before['a.md']!.id);
    expect(byPath()['a.md']!.contentHash).toBe(before['b.md']!.contentHash);
  });

  it('keeps the index when the folder cannot be read, and says why', async () => {
    write('a.md', 'A');
    await library.addFolder();
    renameSync(vault, `${vault}-gone`);
    await library.refresh();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.missingSince).toBeNull();
    expect(library.folders()[0]!.error).toMatch(/cannot be read \(ENOENT\)/);
    renameSync(`${vault}-gone`, vault);
    await library.refresh();
    expect(library.folders()[0]!.error).toBeNull();
  });
});

describe('folders', () => {
  it('adds, refuses overlaps, opens, and removes only index rows', async () => {
    write('a.md', 'A');
    mkdirSync(join(vault, 'Sub'));
    chosen = null;
    expect(await library.addFolder()).toBe(false);
    chosen = vault;
    await library.addFolder();
    expect(settings.get().library.folders).toEqual([{ id: 'id-1', path: vault }]);
    for (const again of [vault, join(vault, 'Sub'), base]) {
      chosen = again;
      await expect(library.addFolder()).rejects.toMatchObject({ reason: 'duplicate' });
    }
    await library.openFolder('id-1');
    expect(opened).toEqual([vault]);
    await library.removeFolder('id-1');
    expect(settings.get().library.folders).toEqual([]);
    expect(rows()).toEqual([]);
    expect(readFileSync(join(vault, 'a.md'), 'utf8')).toBe('A');
    await expect(library.removeFolder('id-1')).rejects.toMatchObject({ reason: 'not_found' });
  });

  it('never writes to the folder: scans, refreshes, watching and removal', async () => {
    seed();
    const before = snapshot(vault);
    const outsideBefore = snapshot(outside);
    await library.addFolder();
    await library.refresh();
    await Promise.all([library.refresh(), library.refresh(), library.refresh()]);
    const ipc = new FakeIpcMain();
    const router = new IpcRouter(ipc, { isTrustedUrl: () => true });
    registerLibraryHandlers(router, library, { debounceMs: 5 });
    const p = page();
    const stream = ipc.invoke(p.event, STREAM_START, {
      id: 'w',
      channel: 'library:watch',
      request: undefined,
    });
    await new Promise((r) => setTimeout(r, 50));
    ipc.send(p.event, STREAM_CANCEL, 'w');
    await stream;
    await library.removeFolder('id-1');
    expect(snapshot(vault)).toEqual(before);
    expect(snapshot(outside)).toEqual(outsideBefore);
  });
});

describe('IPC', () => {
  let ipc: FakeIpcMain;
  let changes: (() => void)[];
  let failures: ((e: unknown) => void)[];
  let closed: number;
  const fakeWatch: WatchFn = (_path, onChange, onError) => {
    changes.push(onChange);
    failures.push(onError);
    return { close: () => void (closed += 1) };
  };
  const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

  async function call<T>(channel: string, payload?: unknown): Promise<T> {
    const r = (await ipc.invoke(page().event, channel, payload)) as IpcResult<T>;
    if (!r.ok) throw Object.assign(new Error(r.error.message), r.error);
    return r.value;
  }

  beforeEach(() => {
    changes = [];
    failures = [];
    closed = 0;
    ipc = new FakeIpcMain();
    const router = new IpcRouter(ipc, { isTrustedUrl: () => true });
    registerLibraryHandlers(router, library, { watch: fakeWatch, debounceMs: 5, retryMs: 10 });
  });

  it('gives ids, names and titles, never an absolute path', async () => {
    seed();
    const added = await call<{ added: boolean }>('library:add-folder');
    expect(added.added).toBe(true);
    const replies = [
      await call('library:folders'),
      await call('library:tree'),
      await call('library:refresh'),
    ];
    const text = JSON.stringify([added, ...replies]);
    expect(text).not.toContain(base);
    expect(text).toContain('Binary search, step by step');
    await expect(call('library:add-folder')).rejects.toMatchObject({ reason: 'duplicate' });
    await expect(call('library:remove-folder', { id: '' })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(call('library:open-folder', { id: 'nope' })).rejects.toMatchObject({
      reason: 'not_found',
    });
  });

  it('library:watch rescans on open, on (debounced) changes, and when watching fails', async () => {
    write('a.md', 'A');
    await library.addFolder();
    const p = page();
    const stream = ipc.invoke(p.event, STREAM_START, {
      id: 'w',
      channel: 'library:watch',
      request: undefined,
    });
    await tick();
    const titles = () =>
      (
        p.events().at(-1) as { event: { folders: { root: { articles: { title: string }[] } }[] } }
      ).event.folders[0]!.root.articles.map((a) => a.title);
    expect(p.events()).toHaveLength(1);
    expect(titles()).toEqual(['a']);

    write('b.md', 'B');
    changes[0]!();
    changes[0]!();
    changes[0]!();
    await tick();
    expect(p.events()).toHaveLength(2);
    expect(titles()).toEqual(['a', 'b']);

    write('c.md', 'C');
    failures[0]!(new Error('watch broke'));
    await tick();
    expect(titles()).toEqual(['a', 'b', 'c']);
    // Watched again after the retry delay.
    expect(changes).toHaveLength(2);

    // A new folder is watched too.
    const second = join(base, 'Second');
    mkdirSync(second);
    chosen = second;
    await call('library:add-folder');
    expect(changes).toHaveLength(4);

    ipc.send(p.event, STREAM_CANCEL, 'w');
    await stream;
    expect(closed).toBeGreaterThanOrEqual(3);
  });
});
