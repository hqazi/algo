/**
 * The Library index (SPEC §15.1, T21): which articles are in the folders the
 * user chose, kept up to date by rescanning. Scans only list, stat and read,
 * and removing a folder drops its index rows (and, from T24, its chats),
 * never its files. T42: the folders change only when the user asks, from
 * the tree (new folder, move, delete to the trash; `files.ts`), and the
 * index follows at once, so chats stay with their articles.
 *
 * The renderer gets folder ids and names, article ids and titles; never an
 * absolute path.
 */
import { realpath } from 'node:fs/promises';
import { basename, isAbsolute, relative } from 'node:path';
import {
  articleMeta,
  buildTree,
  entryName,
  isWithin,
  joinPath,
  GENERATED_FOLDER_ID,
  GENERATED_GROUP_NAME,
  MAX_LIBRARY_FOLDERS,
  parseNote,
  planScan,
  type LibraryFolder,
  type TreeFolder,
} from '@algo/core';
import type { SettingsStore, SqliteStorage } from '../storage';
import {
  applyScan,
  countArticles,
  deleteArticleRow,
  deleteFolderRows,
  listArticles,
  markGenerated,
  moveRows,
  rowsUnder,
  trashedRows,
  type ArticleRow,
  type IndexedNote,
} from './index-store';
import {
  FileOpError,
  makeFolder,
  makeNamedFolder,
  moveEntry,
  trashEntry,
  writeNewNote,
} from './files';
import { FolderUnavailableError, scanFolder } from './scanner';

export interface FolderInfo {
  id: string;
  name: string;
  articles: number;
  missing: number;
  /** Why the last scan could not read the folder; `null` if it could. */
  error: string | null;
}

export interface FolderTree {
  id: string;
  name: string;
  /** T25: the app's own folder of articles the tutor wrote. */
  generated?: true;
  error: string | null;
  root: TreeFolder;
}

export class LibraryError extends Error {
  constructor(
    readonly reason:
      | 'not_found'
      | 'duplicate'
      | 'too_many'
      | 'unavailable'
      // T42: changing the folders.
      | 'invalid'
      | 'exists',
    message: string,
  ) {
    super(message);
    this.name = 'LibraryError';
  }
}

export interface LibraryDeps {
  settings: SettingsStore;
  storage: SqliteStorage;
  now: () => string;
  newId: () => string;
  /** The OS folder picker; `null` if cancelled. */
  chooseFolder: () => Promise<string | null>;
  /** Opens a folder in the file manager. */
  openPath: (path: string) => Promise<boolean>;
  /**
   * T25: `<data>/articles/generated`, indexed as folder `generated` (shown
   * as "Written by the tutor" once it holds an article). Not a setting: it
   * cannot be removed or opened from Settings.
   */
  generatedDir?: string;
  /** T42: sends a file or folder to the OS trash (`shell.trashItem`). */
  trash?: (path: string) => Promise<void>;
  log?: (message: string) => void;
}

/** T42: a file or folder in the tree, as the renderer names it. */
export type LibraryItem =
  { kind: 'article'; id: string } | { kind: 'folder'; folderId: string; path: string };

const overlaps = (a: string, b: string): boolean => {
  const rel = relative(a, b);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

export class LibraryService {
  private readonly errors = new Map<string, string>();
  private running: Promise<void> | null = null;
  private again = false;
  /** T42: folder paths from each folder's last scan (empty folders show). */
  private readonly dirs = new Map<string, string[]>();
  /** Scans and changes to the folders run one at a time. */
  private lock: Promise<unknown> = Promise.resolve();

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  constructor(private readonly deps: LibraryDeps) {}

  private list(): LibraryFolder[] {
    return this.deps.settings.get().library.folders;
  }

  /** The user's folders plus the generated one (scanned, read and watched alike). */
  private all(): LibraryFolder[] {
    const dir = this.deps.generatedDir;
    return dir ? [...this.list(), { id: GENERATED_FOLDER_ID, path: dir }] : this.list();
  }

  private folder(id: string): LibraryFolder {
    const f = this.list().find((x) => x.id === id);
    if (!f) throw new LibraryError('not_found', 'That folder is not in the library.');
    return f;
  }

  folders(): FolderInfo[] {
    const counts = this.deps.storage.readSql(countArticles);
    return this.list().map((f) => ({
      id: f.id,
      name: basename(f.path) || f.path,
      articles: counts.get(f.id)?.articles ?? 0,
      missing: counts.get(f.id)?.missing ?? 0,
      error: this.errors.get(f.id) ?? null,
    }));
  }

  tree(): FolderTree[] {
    const rows = this.deps.storage.readSql((db) => listArticles(db));
    const folders = this.all().filter(
      (f) =>
        f.id !== GENERATED_FOLDER_ID ||
        rows.some((r) => r.folderId === f.id) ||
        (this.dirs.get(f.id)?.length ?? 0) > 0,
    );
    return folders.map((f) => {
      const mine = rows
        .filter((r) => r.folderId === f.id)
        .map((r) => ({
          id: r.id,
          relPath: r.relPath,
          title: r.title,
          tags: articleMeta(r.frontmatter, r.relPath).tags,
          missing: r.missingSince !== null,
          generated: r.generated && f.id !== GENERATED_FOLDER_ID,
          // T43: the tutor's series parts list in order (only notes the app marked).
          ...(r.generated && Number.isInteger(r.frontmatter['part'])
            ? { order: r.frontmatter['part'] as number }
            : {}),
        }));
      const dirs = this.dirs.get(f.id) ?? [];
      if (f.id === GENERATED_FOLDER_ID)
        return {
          id: f.id,
          name: GENERATED_GROUP_NAME,
          generated: true as const,
          error: this.errors.get(f.id) ?? null,
          root: buildTree(mine, '', dirs),
        };
      return {
        id: f.id,
        name: basename(f.path) || f.path,
        error: this.errors.get(f.id) ?? null,
        root: buildTree(mine, '', dirs),
      };
    });
  }

  /**
   * Rescans every folder. Scans run one at a time; a request while
   * one runs is folded into one more full scan after it.
   */
  refresh(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    const run = async (): Promise<void> => {
      do {
        this.again = false;
        for (const f of this.all()) await this.scanOne(f);
      } while (this.again);
    };
    this.running = this.exclusive(run).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async scanOne(f: LibraryFolder): Promise<void> {
    let files;
    try {
      let dirs;
      ({ files, dirs } = await scanFolder(f.path));
      this.dirs.set(f.id, dirs);
    } catch (e) {
      // An unplugged drive or a moved folder: keep the index as it was.
      const why =
        e instanceof FolderUnavailableError ? e.message : 'The folder could not be scanned.';
      this.errors.set(f.id, why);
      this.deps.log?.(`library: ${f.id}: ${String(e)}`);
      return;
    }
    this.errors.delete(f.id);
    const notes: IndexedNote[] = files.map((file) => {
      const n = parseNote(file.content, file.relPath);
      return {
        relPath: file.relPath,
        contentHash: file.contentHash,
        sourceUrl: n.meta.source,
        title: n.meta.title,
        frontmatter: n.frontmatter,
      };
    });
    const now = this.deps.now();
    await this.deps.storage.writeSql((db) => {
      // Removed while scanning: nothing to write.
      if (!this.all().some((x) => x.id === f.id)) return;
      const plan = planScan(listArticles(db, f.id), notes);
      applyScan(db, f.id, plan, now, this.deps.newId);
    });
  }

  /** Asks for a folder with the OS picker and adds it; `false` if cancelled. */
  async addFolder(): Promise<boolean> {
    const chosen = await this.deps.chooseFolder();
    if (!chosen) return false;
    let path: string;
    try {
      path = await realpath(chosen);
    } catch {
      throw new LibraryError('unavailable', 'That folder cannot be read.');
    }
    const current = this.list();
    if (current.length >= MAX_LIBRARY_FOLDERS) {
      throw new LibraryError(
        'too_many',
        `The library holds at most ${MAX_LIBRARY_FOLDERS} folders.`,
      );
    }
    for (const f of current) {
      if (overlaps(f.path, path) || overlaps(path, f.path)) {
        throw new LibraryError(
          'duplicate',
          `That folder is, contains or is inside "${basename(f.path)}", already in the library.`,
        );
      }
    }
    const folder = { id: this.deps.newId(), path };
    this.deps.settings.update({ library: { folders: [...current, folder] } });
    await this.refresh();
    return true;
  }

  /** Removes a folder from the library: its index rows go, its files stay. */
  async removeFolder(id: string): Promise<void> {
    this.folder(id);
    this.deps.settings.update({
      library: { folders: this.list().filter((f) => f.id !== id) },
    });
    this.errors.delete(id);
    this.dirs.delete(id);
    await this.deps.storage.writeSql((db) => deleteFolderRows(db, id));
  }

  async openFolder(id: string): Promise<boolean> {
    return this.deps.openPath(this.folder(id).path);
  }

  /** Calls `fn` whenever the folder list changes; returns the unsubscribe. */
  onFoldersChange(fn: () => void): () => void {
    return this.deps.settings.onChange((c) => {
      if (c.changed.includes('library.folders')) fn();
    });
  }

  /**
   * An article's row, its folder's path and the folder's other articles
   * (main only: the reader resolves images and wikilinks with them).
   */
  article(id: string): { folderPath: string; row: ArticleRow; siblings: ArticleRow[] } {
    const rows = this.deps.storage.readSql((db) => listArticles(db));
    const row = rows.find((r) => r.id === id);
    const folder = row && this.all().find((f) => f.id === row.folderId);
    if (!row || !folder) throw new LibraryError('not_found', 'That article is not in the library.');
    return {
      folderPath: folder.path,
      row,
      siblings: rows.filter((r) => r.folderId === row.folderId),
    };
  }

  /** The id of the indexed article at `relPath` in a folder, or `null`. */
  articleAt(folderId: string, relPath: string): string | null {
    const rows = this.deps.storage.readSql((db) => listArticles(db, folderId));
    return rows.find((r) => r.relPath === relPath && r.missingSince === null)?.id ?? null;
  }

  /** Absolute paths of the folders, for watching (main only). */
  paths(): { id: string; path: string }[] {
    return this.all().map((f) => ({ ...f }));
  }

  // ---- T42: changing the folders from the tree

  /** A library folder (the user's or the tutor's) by id. */
  private anyFolder(id: string): LibraryFolder {
    const f = this.all().find((x) => x.id === id);
    if (!f) throw new LibraryError('not_found', 'That folder is not in the library.');
    return f;
  }

  /** Runs a change to the folders between scans, then rescans. */
  private async change(fn: () => Promise<void>): Promise<void> {
    try {
      await this.exclusive(fn);
    } catch (e) {
      if (e instanceof FileOpError) {
        throw new LibraryError(e.reason === 'not_found' ? 'not_found' : e.reason, e.message);
      }
      throw e;
    }
    await this.refresh();
  }

  /** Makes folder `name` inside `parent` (a folder path in library folder `folderId`). */
  async createFolder(folderId: string, parent: string, name: string): Promise<void> {
    const f = this.anyFolder(folderId);
    return this.change(() => makeFolder(f.path, parent, name));
  }

  /** Moves an article or a folder into folder `to.path` of library folder `to.folderId`. */
  async move(item: LibraryItem, to: { folderId: string; path: string }): Promise<void> {
    const dest = this.anyFolder(to.folderId);
    return this.change(async () => {
      const src = this.source(item);
      const name = entryName(src.path);
      if (src.folderId === to.folderId && src.folder && isWithin(to.path, src.path))
        throw new LibraryError('invalid', 'A folder cannot be moved into itself.');
      const targetBase = joinPath(to.path, name);
      const moves = this.deps.storage
        .readSql((db) => rowsUnder(db, src.folderId, src.path, src.folder))
        .map((r) => ({
          id: r.id,
          folderId: to.folderId,
          relPath: targetBase + r.relPath.slice(src.path.length),
        }));
      // A missing article listed where these would land keeps the place.
      const moving = new Set(moves.map((m) => m.id));
      const there = this.deps.storage
        .readSql((db) => rowsUnder(db, to.folderId, targetBase, src.folder))
        .filter((r) => !moving.has(r.id));
      if (there.length)
        throw new LibraryError(
          'exists',
          'An article whose file is missing is still listed there. Delete it first.',
        );
      const moved = await moveEntry(
        { folder: src.root, path: src.path },
        { folder: dest.path, dir: to.path },
      );
      if (moved) await this.deps.storage.writeSql((db) => moveRows(db, moves));
    });
  }

  /**
   * Sends an article's file, or a folder, to the OS trash. Articles with
   * chats stay listed as "file missing"; the others leave the index. An
   * article whose file is already missing is deleted with its chats.
   */
  remove(item: LibraryItem): Promise<void> {
    return this.change(async () => {
      if (item.kind === 'article') {
        const { row } = this.article(item.id);
        if (row.missingSince !== null) {
          await this.deps.storage.writeSql((db) => deleteArticleRow(db, row.id));
          return;
        }
      }
      const src = this.source(item);
      const trash = this.deps.trash;
      if (!trash) throw new LibraryError('unavailable', 'The trash is not available.');
      await trashEntry(src.root, src.path, trash);
      const ids = this.deps.storage
        .readSql((db) => rowsUnder(db, src.folderId, src.path, src.folder))
        .map((r) => r.id);
      await this.deps.storage.writeSql((db) => trashedRows(db, ids, this.deps.now()));
    });
  }

  // ---- T43: the tutor's articles, saved where the user chose

  /** Checks that `at` names a library folder (or the tutor's); throws if not. */
  place(at: { folderId: string; path: string }): void {
    this.anyFolder(at.folderId);
  }

  /** Makes a folder for a series in `at`, named after its title; resolves to its place. */
  async seriesFolder(
    at: { folderId: string; path: string },
    title: string,
  ): Promise<{ folderId: string; path: string }> {
    const f = this.anyFolder(at.folderId);
    let name = '';
    await this.change(async () => {
      name = await makeNamedFolder(f.path, at.path, title);
    });
    return { folderId: at.folderId, path: at.path ? `${at.path}/${name}` : name };
  }

  /**
   * Writes a note the tutor wrote into `at` (never over a file), indexes it
   * and marks it AI-written; resolves to its article id.
   */
  async saveGenerated(
    at: { folderId: string; path: string },
    note: { title: string; markdown: string; file?: string },
  ): Promise<string> {
    const f = this.anyFolder(at.folderId);
    let name = '';
    await this.change(async () => {
      name = await writeNewNote(f.path, at.path, note);
    });
    const relPath = at.path ? `${at.path}/${name}` : name;
    const id = this.articleAt(at.folderId, relPath);
    if (!id) throw new LibraryError('unavailable', 'The new article was not indexed.');
    await this.deps.storage.writeSql((db) => markGenerated(db, id));
    return id;
  }

  private source(item: LibraryItem): {
    folderId: string;
    root: string;
    path: string;
    folder: boolean;
  } {
    if (item.kind === 'article') {
      const { folderPath, row } = this.article(item.id);
      if (row.missingSince !== null)
        throw new LibraryError('not_found', 'The article’s file is missing.');
      return { folderId: row.folderId, root: folderPath, path: row.relPath, folder: false };
    }
    if (item.path === '')
      throw new LibraryError('invalid', 'A library folder itself cannot be moved or deleted.');
    const f = this.anyFolder(item.folderId);
    return { folderId: f.id, root: f.path, path: item.path, folder: true };
  }
}
