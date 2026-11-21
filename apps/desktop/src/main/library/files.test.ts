/**
 * T42: changing library folders from the tree, on a temp folder: new
 * folders (empty ones show), moves within and across folders (chats
 * follow), deletes to a fake trash, and every path that must be refused.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../storage/database';
import { SettingsStore, SqliteStorage } from '../storage';
import { listArticles, markGenerated } from './index-store';
import { LibraryService, type FolderTree } from './service';
import type { TreeFolder } from '@algo/core';

let base: string;
let vault: string;
let second: string;
let outside: string;
let trashDir: string;
let storage: SqliteStorage;
let library: LibraryService;
let ids: number;
let next: string;

const write = (dir: string, rel: string, text: string): void => {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

beforeEach(async () => {
  base = realpathSync.native(mkdtempSync(join(tmpdir(), 'tutor-library-files-')));
  vault = join(base, 'Vault');
  second = join(base, 'Second');
  outside = join(base, 'Elsewhere');
  trashDir = join(base, 'Trash');
  for (const d of [vault, second, outside, trashDir]) mkdirSync(d);
  storage = new SqliteStorage(openDatabase(':memory:').db);
  ids = 0;
  library = new LibraryService({
    settings: SettingsStore.load(join(base, 'data', 'settings.json')),
    storage,
    now: () => '2026-11-21T10:00:00.000Z',
    newId: () => `id-${++ids}`,
    chooseFolder: async () => next,
    openPath: async () => true,
    trash: async (p) => renameSync(p, join(trashDir, basename(p))),
  });
  write(vault, 'Compilers/Lexing.md', '---\ntitle: Lexing\n---\nTokens.\n');
  write(vault, 'Compilers/Parsing.md', '# Parsing\n');
  write(vault, 'Top.md', 'Top note\n');
  write(second, 'Other.md', 'Other\n');
  next = vault;
  await library.addFolder();
  next = second;
  await library.addFolder();
  const byName = Object.fromEntries(library.folders().map((f) => [f.name, f.id]));
  VAULT = byName['Vault']!;
  SECOND = byName['Second']!;
});

afterEach(async () => {
  await storage.close();
  rmSync(base, { recursive: true, force: true });
});

const rows = () => storage.readSql((db) => listArticles(db));
const row = (title: string) => rows().find((r) => r.title === title)!;
let VAULT: string;
let SECOND: string;
const tree = (id: string): FolderTree => library.tree().find((f) => f.id === id)!;
const names = (f: TreeFolder): unknown => ({
  dirs: f.folders.map((x) => [x.name, names(x)]),
  notes: f.articles.map((a) => a.title),
});

function addThread(articleId: string): void {
  void storage.writeSql((db) =>
    db
      .prepare(
        `INSERT INTO threads (id, backend, backend_state, created_at, kind, article_id)
         VALUES (?, 'fake', '{}', '2026-11-21', 'article', ?)`,
      )
      .run(`article:${articleId}`, articleId),
  );
}

describe('new folder', () => {
  it('makes a folder that shows in the tree while empty', async () => {
    await library.createFolder(VAULT, 'Compilers', 'Back end');
    await library.createFolder(VAULT, '', 'Inbox');
    expect(existsSync(join(vault, 'Compilers', 'Back end'))).toBe(true);
    expect(names(tree(VAULT).root)).toEqual({
      dirs: [
        [
          'Compilers',
          { dirs: [['Back end', { dirs: [], notes: [] }]], notes: ['Lexing', 'Parsing'] },
        ],
        ['Inbox', { dirs: [], notes: [] }],
      ],
      notes: ['Top'],
    });
    expect(tree(VAULT).root.folders[0]!.folders[0]!.path).toBe('Compilers/Back end');
  });

  it('refuses bad names, existing names and paths out of the folder', async () => {
    await expect(library.createFolder(VAULT, '', '.hidden')).rejects.toMatchObject({
      reason: 'invalid',
    });
    await expect(library.createFolder(VAULT, '', '../Escape')).rejects.toMatchObject({
      reason: 'invalid',
    });
    await expect(library.createFolder(VAULT, '..', 'Escape')).rejects.toMatchObject({
      reason: 'invalid',
    });
    await expect(library.createFolder(VAULT, '', 'Compilers')).rejects.toMatchObject({
      reason: 'exists',
    });
    await expect(library.createFolder(VAULT, 'Nope', 'X')).rejects.toMatchObject({
      reason: 'not_found',
    });
    symlinkSync(outside, join(vault, 'Out'));
    await expect(library.createFolder(VAULT, 'Out', 'X')).rejects.toMatchObject({
      reason: 'invalid',
    });
    expect(existsSync(join(outside, 'X'))).toBe(false);
    expect(existsSync(join(base, 'Escape'))).toBe(false);
    await expect(library.createFolder('nope', '', 'X')).rejects.toMatchObject({
      reason: 'not_found',
    });
  });
});

describe('move', () => {
  it('moves an article and keeps its id and chats', async () => {
    const lexing = row('Lexing');
    addThread(lexing.id);
    await library.createFolder(VAULT, '', 'Done');
    await library.move({ kind: 'article', id: lexing.id }, { folderId: VAULT, path: 'Done' });
    expect(existsSync(join(vault, 'Done', 'Lexing.md'))).toBe(true);
    expect(existsSync(join(vault, 'Compilers', 'Lexing.md'))).toBe(false);
    expect(row('Lexing')).toMatchObject({
      id: lexing.id,
      relPath: 'Done/Lexing.md',
      missingSince: null,
    });
  });

  it('moves a folder with its articles, into another library folder too', async () => {
    const before = rows().filter((r) => r.relPath.startsWith('Compilers/'));
    await library.move(
      { kind: 'folder', folderId: VAULT, path: 'Compilers' },
      { folderId: SECOND, path: '' },
    );
    expect(readFileSync(join(second, 'Compilers', 'Parsing.md'), 'utf8')).toBe('# Parsing\n');
    expect(existsSync(join(vault, 'Compilers'))).toBe(false);
    for (const r of before) {
      const now = rows().find((x) => x.id === r.id)!;
      expect(now).toMatchObject({ folderId: SECOND, relPath: r.relPath, missingSince: null });
    }
    expect(rows()).toHaveLength(4);
  });

  it('keeps an article AI-written when it moves', async () => {
    const top = row('Top');
    await storage.writeSql((db) => markGenerated(db, top.id));
    await library.move({ kind: 'article', id: top.id }, { folderId: SECOND, path: '' });
    expect(row('Top')).toMatchObject({ folderId: SECOND, generated: true });
    expect(tree(SECOND).root.articles.find((a) => a.id === top.id)?.generated).toBe(true);
  });

  it('never overwrites, and refuses moving a folder into itself or a root', async () => {
    write(second, 'Top.md', 'Mine\n');
    await library.refresh();
    await expect(
      library.move({ kind: 'article', id: row('Top').id }, { folderId: SECOND, path: '' }),
    ).rejects.toMatchObject({ reason: 'exists' });
    expect(readFileSync(join(second, 'Top.md'), 'utf8')).toBe('Mine\n');
    await library.createFolder(VAULT, 'Compilers', 'Inner');
    await expect(
      library.move(
        { kind: 'folder', folderId: VAULT, path: 'Compilers' },
        { folderId: VAULT, path: 'Compilers/Inner' },
      ),
    ).rejects.toMatchObject({ reason: 'invalid' });
    await expect(
      library.move({ kind: 'folder', folderId: VAULT, path: '' }, { folderId: SECOND, path: '' }),
    ).rejects.toMatchObject({ reason: 'invalid' });
    await expect(
      library.move(
        { kind: 'folder', folderId: VAULT, path: '../Elsewhere' },
        { folderId: SECOND, path: '' },
      ),
    ).rejects.toMatchObject({ reason: 'invalid' });
    symlinkSync(outside, join(vault, 'Out'));
    await expect(
      library.move({ kind: 'article', id: row('Lexing').id }, { folderId: VAULT, path: 'Out' }),
    ).rejects.toMatchObject({ reason: 'invalid' });
    expect(existsSync(join(vault, 'Compilers', 'Lexing.md'))).toBe(true);
  });

  it('refuses a place a missing article with chats still holds', async () => {
    const top = row('Top');
    addThread(top.id);
    renameSync(join(vault, 'Top.md'), join(outside, 'Top.md'));
    await library.refresh();
    expect(row('Top').missingSince).not.toBeNull();
    write(vault, 'Compilers/Top.md', 'another\n');
    await library.refresh();
    const other = rows().find((r) => r.relPath === 'Compilers/Top.md')!;
    await expect(
      library.move({ kind: 'article', id: other.id }, { folderId: VAULT, path: '' }),
    ).rejects.toMatchObject({ reason: 'exists' });
  });
});

describe('delete', () => {
  it('sends an article to the trash; without chats it leaves the index', async () => {
    await library.remove({ kind: 'article', id: row('Top').id });
    expect(existsSync(join(vault, 'Top.md'))).toBe(false);
    expect(existsSync(join(trashDir, 'Top.md'))).toBe(true);
    expect(rows().some((r) => r.title === 'Top')).toBe(false);
  });

  it('keeps an article with chats as missing, then deletes it with its chats', async () => {
    const lexing = row('Lexing');
    addThread(lexing.id);
    await library.remove({ kind: 'folder', folderId: VAULT, path: 'Compilers' });
    expect(existsSync(join(trashDir, 'Compilers', 'Lexing.md'))).toBe(true);
    expect(row('Lexing').missingSince).not.toBeNull();
    expect(rows().some((r) => r.title === 'Parsing')).toBe(false);
    await library.remove({ kind: 'article', id: lexing.id });
    expect(rows().some((r) => r.id === lexing.id)).toBe(false);
    const threads = storage.readSql((db) =>
      db.prepare('SELECT COUNT(*) AS n FROM threads WHERE article_id = ?').get(lexing.id),
    );
    expect(threads).toEqual({ n: 0 });
  });

  it('never deletes a library folder itself or anything outside', async () => {
    await expect(
      library.remove({ kind: 'folder', folderId: VAULT, path: '' }),
    ).rejects.toMatchObject({ reason: 'invalid' });
    writeFileSync(join(outside, 'Keep.md'), 'keep');
    await expect(
      library.remove({ kind: 'folder', folderId: VAULT, path: '../Elsewhere' }),
    ).rejects.toMatchObject({ reason: 'invalid' });
    symlinkSync(outside, join(vault, 'Out'));
    await expect(
      library.remove({ kind: 'folder', folderId: VAULT, path: 'Out/Keep.md' }),
    ).rejects.toMatchObject({ reason: 'invalid' });
    expect(existsSync(join(outside, 'Keep.md'))).toBe(true);
    expect(existsSync(vault)).toBe(true);
  });
});
