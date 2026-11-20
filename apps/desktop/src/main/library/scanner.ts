/**
 * Walks one Library folder (SPEC §15.1). Read only: it lists directories,
 * stats and reads files, and never opens anything for writing.
 *
 * - `*.md` files only; any entry whose name starts with a dot is skipped
 *   (`.obsidian/`, `.trash/`, `.git/`).
 * - A symlink is followed only if its real path is inside the folder's real
 *   path; directories are visited once by real path, so links cannot loop.
 * - Files over 5 MB are skipped.
 */
import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { isNoteFile, isSkippedName, MAX_NOTE_BYTES } from '@algorithm-tutor/core';

export interface ScannedFile {
  /** Inside the folder, with `/`. */
  relPath: string;
  content: string;
  /** sha256 of the bytes, hex. */
  contentHash: string;
}

export interface FolderScan {
  files: ScannedFile[];
  skipped: { large: number; outside: number; unreadable: number };
}

export class FolderUnavailableError extends Error {
  constructor(override readonly cause: unknown) {
    super(`The folder cannot be read (${(cause as NodeJS.ErrnoException)?.code ?? 'error'}).`);
    this.name = 'FolderUnavailableError';
  }
}

const inside = (root: string, p: string): boolean => {
  const rel = relative(root, p);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
};

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function scanFolder(folder: string): Promise<FolderScan> {
  let root: string;
  try {
    root = await realpath(folder);
    if (!(await stat(root)).isDirectory()) throw Object.assign(new Error(), { code: 'ENOTDIR' });
  } catch (e) {
    throw new FolderUnavailableError(e);
  }
  const out: FolderScan = { files: [], skipped: { large: 0, outside: 0, unreadable: 0 } };
  const visited = new Set<string>([root]);

  async function addFile(path: string, rel: string, size: number): Promise<void> {
    if (size > MAX_NOTE_BYTES) {
      out.skipped.large += 1;
      return;
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch {
      out.skipped.unreadable += 1;
      return;
    }
    // It may have grown since the stat.
    if (bytes.length > MAX_NOTE_BYTES) {
      out.skipped.large += 1;
      return;
    }
    out.files.push({
      relPath: rel.split(sep).join('/'),
      content: bytes.toString('utf8'),
      contentHash: sha256(bytes),
    });
  }

  async function walk(dir: string, relDir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      out.skipped.unreadable += 1;
      return;
    }
    for (const e of entries) {
      if (isSkippedName(e.name)) continue;
      const path = join(dir, e.name);
      const rel = relDir ? join(relDir, e.name) : e.name;
      if (e.isSymbolicLink()) {
        let real: string;
        let st;
        try {
          real = await realpath(path);
          st = await stat(real);
        } catch {
          out.skipped.unreadable += 1;
          continue;
        }
        if (!inside(root, real)) {
          out.skipped.outside += 1;
          continue;
        }
        if (st.isDirectory()) {
          if (visited.has(real)) continue;
          visited.add(real);
          await walk(real, rel);
        } else if (st.isFile() && isNoteFile(e.name)) {
          await addFile(real, rel, st.size);
        }
      } else if (e.isDirectory()) {
        let real: string;
        try {
          real = await realpath(path);
        } catch {
          out.skipped.unreadable += 1;
          continue;
        }
        if (visited.has(real)) continue;
        visited.add(real);
        await walk(path, rel);
      } else if (e.isFile() && isNoteFile(e.name)) {
        let size: number;
        try {
          size = (await stat(path)).size;
        } catch {
          out.skipped.unreadable += 1;
          continue;
        }
        await addFile(path, rel, size);
      }
    }
  }

  await walk(root, '');
  return out;
}
