/**
 * Export, import and reset (SPEC §4.5).
 *
 * - **Export** writes one zip: `manifest.json`, `tutor.db` (a consistent copy
 *   from `VACUUM INTO`), `settings.json`, and the folders `workspace/`,
 *   `problems/generated/`, `problems/imported/`, `explanations/`. Never
 *   `secrets.bin`.
 * - **Import** validates a zip completely (names, sizes, the manifest, that
 *   `tutor.db` is ours and not newer than this app) and stages it in
 *   `pending/`. The swap happens at the next start, before the database is
 *   opened (`applyPending`), so no file is replaced while it is in use; the
 *   caller exports the current data to `backups/` first and restarts the app.
 * - **Reset everything** is staged the same way; **reset progress** happens
 *   at once in the database (`Storage.resetProgress`).
 *
 * `backups/` and `pending/` are never exported, imported or reset.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { strToU8, strFromU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { schemaVersion } from '../storage/database';
import { MIGRATIONS } from '../storage/migrations';
import type { DataPaths } from '../storage/paths';

export const EXPORT_FORMAT = 'algorithm-tutor-export';
export const EXPORT_VERSION = 1;

/** Files and folders an export holds, relative to the data folder (`/` separated). */
export const EXPORT_FILES = ['tutor.db', 'settings.json'] as const;
export const EXPORT_DIRS = [
  'workspace',
  'problems/generated',
  'problems/imported',
  'explanations',
] as const;
/** What an import replaces: the exported items plus the database's side files. */
const IMPORT_REPLACES = [...EXPORT_FILES, 'tutor.db-wal', 'tutor.db-shm', ...EXPORT_DIRS];
/** What "reset everything" removes besides that: the key, caches, old copies. */
const RESET_ALSO = ['secrets.bin', 'cache', 'settings.json.invalid'];

export const LIMITS = {
  entries: 20_000,
  fileBytes: 256 * 1024 * 1024,
  totalBytes: 1024 * 1024 * 1024,
};

export interface Manifest {
  format: typeof EXPORT_FORMAT;
  version: number;
  app: string;
  schema: number;
  created_at: string;
}

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveError';
  }
}

/** Something that can copy the open database consistently (`SqliteStorage`). */
export interface Snapshotter {
  snapshot(path: string): Promise<void>;
}

// ---------------------------------------------------------------- export

function collect(dir: string, prefix: string, out: Zippable): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const st = lstatSync(full);
    // Temp files from atomic writes are not data.
    if (name.includes('.tmp-')) continue;
    if (st.isDirectory()) n += collect(full, `${prefix}${name}/`, out);
    else if (st.isFile()) {
      out[`${prefix}${name}`] = readFileSync(full);
      n += 1;
    }
    // Symlinks and anything else are left out.
  }
  return n;
}

/** A file name for an export made at `now`, e.g. `algorithm-tutor-2026-11-19-1430.zip`. */
export function exportName(now: string, label = ''): string {
  const stamp = now.slice(0, 16).replace('T', '-').replace(':', '');
  return `algorithm-tutor-${stamp}${label ? `-${label}` : ''}.zip`;
}

/** Writes an export of the data folder to `dest` (atomically). */
export async function exportData(opts: {
  paths: DataPaths;
  db: Snapshotter;
  appVersion: string;
  now: string;
  dest: string;
}): Promise<{ path: string; files: number; bytes: number }> {
  const { paths } = opts;
  const tmp = mkdtempSync(join(tmpdir(), 'algotutor-export-'));
  try {
    const dbCopy = join(tmp, 'tutor.db');
    await opts.db.snapshot(dbCopy);
    const manifest: Manifest = {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      app: opts.appVersion,
      schema: MIGRATIONS.length,
      created_at: opts.now,
    };
    const entries: Zippable = {
      'manifest.json': strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
      'tutor.db': readFileSync(dbCopy),
    };
    let files = 1;
    if (existsSync(paths.settings)) {
      entries['settings.json'] = readFileSync(paths.settings);
      files += 1;
    }
    for (const dir of EXPORT_DIRS) files += collect(join(paths.root, dir), `${dir}/`, entries);
    const zip = zipSync(entries, { level: 6 });
    mkdirSync(dirname(opts.dest), { recursive: true });
    const part = `${opts.dest}.tmp-${process.pid}`;
    writeFileSync(part, zip);
    renameSync(part, opts.dest);
    return { path: opts.dest, files, bytes: zip.length };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- validate

/** A safe relative name inside the export layout, or an error message. */
export function checkEntryName(name: string): string | null {
  if (name.length > 400) return 'name too long';
  if (/[\\\0:]/.test(name) || name.startsWith('/')) return 'not a relative path';
  const parts = name.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return 'not a plain path';
  if (name === 'manifest.json' || (EXPORT_FILES as readonly string[]).includes(name)) return null;
  if (EXPORT_DIRS.some((d) => name.startsWith(`${d}/`) && name.length > d.length + 1)) return null;
  return 'not part of an export';
}

export interface ValidArchive {
  manifest: Manifest;
  /** Every file by its relative name (`manifest.json` excluded). */
  files: Map<string, Uint8Array>;
}

function checkDatabase(bytes: Uint8Array): number {
  const tmp = mkdtempSync(join(tmpdir(), 'algotutor-import-'));
  const path = join(tmp, 'tutor.db');
  try {
    writeFileSync(path, bytes);
    let db: DatabaseSync;
    try {
      db = new DatabaseSync(path, { readOnly: true });
    } catch {
      throw new ArchiveError('tutor.db in the file is not a database.');
    }
    try {
      const ok = db.prepare('PRAGMA quick_check').get() as Record<string, unknown> | undefined;
      if (!ok || Object.values(ok)[0] !== 'ok')
        throw new ArchiveError('tutor.db in the file is damaged.');
      const v = schemaVersion(db, 'tutor.db in the file');
      if (v < 1) throw new ArchiveError('tutor.db in the file is empty.');
      if (v > MIGRATIONS.length)
        throw new ArchiveError(
          `The file was made by a newer version of the app (database version ${v}; ` +
            `this app knows up to ${MIGRATIONS.length}). Update the app first.`,
        );
      return v;
    } catch (e) {
      if (e instanceof ArchiveError) throw e;
      throw new ArchiveError(
        `tutor.db in the file is not this app's database (${e instanceof Error ? e.message : String(e)}).`,
      );
    } finally {
      db.close();
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Reads and checks an export; throws `ArchiveError` with a readable reason. */
export function readArchive(bytes: Uint8Array): ValidArchive {
  let entries: Record<string, Uint8Array>;
  let count = 0;
  let declared = 0;
  const bad: string[] = [];
  try {
    entries = unzipSync(bytes, {
      filter: (f) => {
        count += 1;
        declared += f.originalSize;
        if (f.name.endsWith('/')) return false; // folder entries
        const why = checkEntryName(f.name);
        if (why) bad.push(`${f.name}: ${why}`);
        if (f.originalSize > LIMITS.fileBytes) bad.push(`${f.name}: too large`);
        return (
          !why &&
          count <= LIMITS.entries &&
          declared <= LIMITS.totalBytes &&
          f.originalSize <= LIMITS.fileBytes
        );
      },
    });
  } catch (e) {
    throw new ArchiveError(
      `The file is not a readable zip (${e instanceof Error ? e.message : String(e)}).`,
    );
  }
  if (count > LIMITS.entries) throw new ArchiveError('The file has too many entries.');
  if (declared > LIMITS.totalBytes) throw new ArchiveError('The file is too large to import.');
  if (bad.length)
    throw new ArchiveError(`The file is not an export of this app: ${bad.slice(0, 3).join('; ')}.`);
  let total = 0;
  for (const v of Object.values(entries)) total += v.length;
  if (total > LIMITS.totalBytes) throw new ArchiveError('The file is too large to import.');

  const rawManifest = entries['manifest.json'];
  if (!rawManifest) throw new ArchiveError('The file is not an export of this app (no manifest).');
  let manifest: Manifest;
  try {
    manifest = JSON.parse(strFromU8(rawManifest)) as Manifest;
  } catch {
    throw new ArchiveError('The export manifest is not valid JSON.');
  }
  if (manifest.format !== EXPORT_FORMAT)
    throw new ArchiveError('The file is not an export of this app.');
  if (!Number.isInteger(manifest.version) || manifest.version > EXPORT_VERSION)
    throw new ArchiveError('The export was made by a newer version of the app. Update first.');

  const db = entries['tutor.db'];
  if (!db) throw new ArchiveError('The export has no tutor.db.');
  checkDatabase(db);
  const settings = entries['settings.json'];
  if (settings) {
    try {
      JSON.parse(strFromU8(settings));
    } catch {
      throw new ArchiveError('settings.json in the export is not valid JSON.');
    }
  }
  const files = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(entries))
    if (name !== 'manifest.json') files.set(name, data);
  return { manifest, files };
}

// ---------------------------------------------------------------- pending

export type PendingOp = { op: 'import'; source: string; at: string } | { op: 'reset'; at: string };

const opFile = (paths: DataPaths) => join(paths.pending, 'op.json');
const stagedDir = (paths: DataPaths) => join(paths.pending, 'data');

/** Writes the archive's files into `pending/` for the next start. */
export function stageImport(paths: DataPaths, archive: ValidArchive, op: PendingOp): void {
  rmSync(paths.pending, { recursive: true, force: true });
  const root = stagedDir(paths);
  for (const [name, data] of archive.files) {
    const target = join(root, ...name.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
  mkdirSync(root, { recursive: true });
  // Written last: a stage without it is incomplete and is discarded.
  writeFileSync(opFile(paths), JSON.stringify(op));
}

export function stageReset(paths: DataPaths, at: string): void {
  rmSync(paths.pending, { recursive: true, force: true });
  mkdirSync(paths.pending, { recursive: true });
  writeFileSync(opFile(paths), JSON.stringify({ op: 'reset', at } satisfies PendingOp));
}

function remove(paths: DataPaths, names: readonly string[]): void {
  for (const name of names)
    rmSync(join(paths.root, ...name.split('/')), {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  // Copies made before migrations (`tutor.db.bak-N`) belong to the old database.
  if (existsSync(paths.root))
    for (const f of readdirSync(paths.root))
      if (f.startsWith('tutor.db.bak-')) rmSync(join(paths.root, f), { force: true });
}

/**
 * Applies a staged import or reset. Call before opening storage. Returns
 * what was applied, or `null`. Throws if a stage could not be applied (the
 * automatic export in `backups/` still holds the earlier data).
 */
export function applyPending(paths: DataPaths): PendingOp | null {
  if (!existsSync(paths.pending)) return null;
  if (!existsSync(opFile(paths))) {
    rmSync(paths.pending, { recursive: true, force: true });
    return null;
  }
  const op = JSON.parse(readFileSync(opFile(paths), 'utf8')) as PendingOp;
  if (op.op === 'reset') {
    remove(paths, [...IMPORT_REPLACES, ...RESET_ALSO]);
  } else if (op.op === 'import') {
    const staged = stagedDir(paths);
    if (!existsSync(join(staged, 'tutor.db')))
      throw new ArchiveError('The staged import has no tutor.db; nothing was changed.');
    remove(paths, IMPORT_REPLACES);
    for (const name of [...EXPORT_FILES, ...EXPORT_DIRS]) {
      const from = join(staged, ...name.split('/'));
      if (!existsSync(from)) continue;
      const to = join(paths.root, ...name.split('/'));
      mkdirSync(dirname(to), { recursive: true });
      renameSync(from, to);
    }
  } else {
    rmSync(paths.pending, { recursive: true, force: true });
    return null;
  }
  rmSync(paths.pending, { recursive: true, force: true });
  return op;
}
