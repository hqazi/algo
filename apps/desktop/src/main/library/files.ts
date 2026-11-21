/**
 * Changing a library folder on the user's request (T42, SPEC §15.1): make a
 * folder, move a file or folder, send one to the trash. The renderer names
 * things by a path inside a library folder; every path is checked as names
 * first (`pathParts`), then by real path: what is changed must be inside the
 * folder's real path, so a `..`, an absolute path or a symlink cannot reach
 * anything outside. Nothing is ever overwritten; files are never deleted
 * outright (the trash), except the source of a file copied across drives.
 */
import { constants } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { Stats } from 'node:fs';
import { entryName, entryNameProblem, noteFileName, pathParts } from '@algo/core';

export type FileOpReason = 'invalid' | 'exists' | 'not_found' | 'unavailable';

export class FileOpError extends Error {
  constructor(
    readonly reason: FileOpReason,
    message: string,
  ) {
    super(message);
    this.name = 'FileOpError';
  }
}

const code = (e: unknown): string | undefined => (e as NodeJS.ErrnoException)?.code;

const inside = (root: string, p: string): boolean => {
  const rel = relative(root, p);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
};

function parts(path: string): string[] {
  const p = pathParts(path);
  if (!p) throw new FileOpError('invalid', 'That is not a path inside the folder.');
  return p;
}

async function rootOf(folder: string): Promise<string> {
  try {
    const r = await realpath(folder);
    if ((await stat(r)).isDirectory()) return r;
  } catch {
    // below
  }
  throw new FileOpError('unavailable', 'The library folder cannot be read.');
}

/** The real path of the folder at `path` inside `root` (a real path). */
async function dirAt(root: string, path: string): Promise<string> {
  let real: string;
  try {
    real = await realpath(join(root, ...parts(path)));
  } catch (e) {
    if (e instanceof FileOpError) throw e;
    throw new FileOpError('not_found', 'That folder is not there any more.');
  }
  if (!inside(root, real)) throw new FileOpError('invalid', 'That folder is outside the library.');
  if (!(await stat(real)).isDirectory()) throw new FileOpError('invalid', 'That is not a folder.');
  return real;
}

/**
 * The file or folder at `path` (not the root): its parent's real path is
 * inside `root`, and the entry itself is not followed (a symlink is moved or
 * trashed as a link).
 */
async function entryAt(root: string, path: string): Promise<{ abs: string; st: Stats }> {
  const p = parts(path);
  if (p.length === 0)
    throw new FileOpError('invalid', 'A library folder itself cannot be changed.');
  const parent = await dirAt(root, p.slice(0, -1).join('/'));
  const abs = join(parent, p[p.length - 1]!);
  try {
    return { abs, st: await lstat(abs) };
  } catch {
    throw new FileOpError('not_found', 'That file is not there any more.');
  }
}

async function free(abs: string): Promise<void> {
  try {
    await lstat(abs);
  } catch (e) {
    if (code(e) === 'ENOENT') return;
    throw e;
  }
  throw new FileOpError(
    'exists',
    `There is already a “${entryName(abs.split(sep).join('/'))}” there.`,
  );
}

/** Makes folder `name` in the folder at `parent`. */
export async function makeFolder(folder: string, parent: string, name: string): Promise<void> {
  const problem = entryNameProblem(name);
  if (problem) throw new FileOpError('invalid', problem);
  const root = await rootOf(folder);
  const target = join(await dirAt(root, parent), name);
  await free(target);
  try {
    await mkdir(target);
  } catch (e) {
    if (code(e) === 'EEXIST')
      throw new FileOpError('exists', `There is already a “${name}” there.`);
    throw e;
  }
}

/**
 * Moves the file or folder at `from.path` into the folder at `to.dir`,
 * keeping its name. `false` if it is there already (nothing to do).
 */
export async function moveEntry(
  from: { folder: string; path: string },
  to: { folder: string; dir: string },
): Promise<boolean> {
  const srcRoot = await rootOf(from.folder);
  const destRoot = await rootOf(to.folder);
  const { abs, st } = await entryAt(srcRoot, from.path);
  const destDir = await dirAt(destRoot, to.dir);
  const target = join(destDir, entryName(from.path));
  if (target === abs) return false;
  if (st.isDirectory()) {
    const real = await realpath(abs);
    if (inside(real, destDir))
      throw new FileOpError('invalid', 'A folder cannot be moved into itself.');
  }
  await free(target);
  try {
    await rename(abs, target);
  } catch (e) {
    if (code(e) !== 'EXDEV') throw e;
    // Another drive: a file is copied (never over another), then removed.
    if (!st.isFile())
      throw new FileOpError(
        'invalid',
        'A folder cannot be moved to another drive; move its files.',
      );
    await copyFile(abs, target, constants.COPYFILE_EXCL);
    await unlink(abs);
  }
  return true;
}

/** Sends the file or folder at `path` to the OS trash with `trash`. */
export async function trashEntry(
  folder: string,
  path: string,
  trash: (abs: string) => Promise<void>,
): Promise<void> {
  const root = await rootOf(folder);
  const { abs } = await entryAt(root, path);
  try {
    await trash(abs);
  } catch {
    throw new FileOpError('unavailable', 'It could not be moved to the trash.');
  }
}

const exists = async (abs: string): Promise<boolean> => {
  try {
    await lstat(abs);
    return true;
  } catch (e) {
    if (code(e) === 'ENOENT') return false;
    throw e;
  }
};

/**
 * T43: makes a new folder for a series titled `title` in the folder at
 * `parent`, named after the title (` 2`, ` 3`… if taken). Resolves to its
 * name.
 */
export async function makeNamedFolder(
  folder: string,
  parent: string,
  title: string,
): Promise<string> {
  const root = await rootOf(folder);
  const dir = await dirAt(root, parent);
  const taken = new Set<string>();
  for (;;) {
    const name = noteFileName(title, (n) => taken.has(n)).slice(0, -3);
    try {
      await mkdir(join(dir, name));
      return name;
    } catch (e) {
      if (code(e) !== 'EEXIST') throw e;
      taken.add(`${name}.md`);
    }
  }
}

/**
 * T43: writes a new note in the folder at `dir`: named `file`.md if given,
 * else after `title`, made unique. Never replaces a file (`wx`). Resolves
 * to its name.
 */
export async function writeNewNote(
  folder: string,
  dirPath: string,
  note: { title: string; markdown: string; file?: string },
): Promise<string> {
  const root = await rootOf(folder);
  const dir = await dirAt(root, dirPath);
  const taken = new Set<string>();
  for (;;) {
    // A series part's name (`01 Title`) passes through unchanged.
    const name = noteFileName(note.file ?? note.title, (n) => taken.has(n));
    if (await exists(join(dir, name))) {
      taken.add(name);
      continue;
    }
    try {
      await writeFile(join(dir, name), note.markdown, { encoding: 'utf8', flag: 'wx' });
      return name;
    } catch (e) {
      if (code(e) !== 'EEXIST') throw e;
      taken.add(name);
    }
  }
}
