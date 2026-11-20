/**
 * The Library index (SPEC §15.1, T21): which articles are in the folders the
 * user chose, kept up to date by rescanning. The folders are never written:
 * scans only list, stat and read, and removing a folder drops its index
 * rows (and, from T24, its chats), never its files.
 *
 * The renderer gets folder ids and names, article ids and titles; never an
 * absolute path.
 */
import { realpath } from 'node:fs/promises';
import { basename, isAbsolute, relative } from 'node:path';
import {
  articleMeta,
  buildTree,
  MAX_LIBRARY_FOLDERS,
  parseNote,
  planScan,
  type LibraryFolder,
  type TreeFolder,
} from '@algorithm-tutor/core';
import type { SettingsStore, SqliteStorage } from '../storage';
import {
  applyScan,
  countArticles,
  deleteFolderRows,
  listArticles,
  type IndexedNote,
} from './index-store';
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
  error: string | null;
  root: TreeFolder;
}

export class LibraryError extends Error {
  constructor(
    readonly reason: 'not_found' | 'duplicate' | 'too_many' | 'unavailable',
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
  log?: (message: string) => void;
}

const overlaps = (a: string, b: string): boolean => {
  const rel = relative(a, b);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

export class LibraryService {
  private readonly errors = new Map<string, string>();
  private running: Promise<void> | null = null;
  private again = false;

  constructor(private readonly deps: LibraryDeps) {}

  private list(): LibraryFolder[] {
    return this.deps.settings.get().library.folders;
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
    return this.list().map((f) => {
      const mine = rows
        .filter((r) => r.folderId === f.id)
        .map((r) => ({
          id: r.id,
          relPath: r.relPath,
          title: r.title,
          tags: articleMeta(r.frontmatter, r.relPath).tags,
          missing: r.missingSince !== null,
        }));
      return {
        id: f.id,
        name: basename(f.path) || f.path,
        error: this.errors.get(f.id) ?? null,
        root: buildTree(mine),
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
        for (const f of this.list()) await this.scanOne(f);
      } while (this.again);
    };
    this.running = run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async scanOne(f: LibraryFolder): Promise<void> {
    let files;
    try {
      ({ files } = await scanFolder(f.path));
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
      if (!this.list().some((x) => x.id === f.id)) return;
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

  /** Absolute paths of the folders, for watching (main only). */
  paths(): { id: string; path: string }[] {
    return this.list().map((f) => ({ ...f }));
  }
}
