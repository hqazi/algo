/**
 * Opening `tutor.db` and bringing its schema up to date (SPEC §4.2).
 *
 * - The schema version is `meta.schema_version` (0 for an empty file).
 * - A database newer than the app knows is refused untouched.
 * - Before migrating an existing database, a copy is written next to it as
 *   `tutor.db.bak-<version>` (with `-2`, `-3`… if that name is taken).
 * - Each migration runs in its own transaction together with the version
 *   bump, so a failure leaves the database at the last good version.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, type Migration } from './migrations';

/** Node's built-in SQLite (D-20): nothing native to install or rebuild. */
export type Db = DatabaseSync;

/**
 * Runs `fn` in a transaction (a savepoint if one is already open): committed
 * if it returns, rolled back if it throws.
 */
export function transaction<T>(db: Db, fn: () => T): T {
  const nested = db.isTransaction;
  db.exec(nested ? 'SAVEPOINT nested' : 'BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec(nested ? 'RELEASE nested' : 'COMMIT');
    return result;
  } catch (e) {
    db.exec(nested ? 'ROLLBACK TO nested; RELEASE nested' : 'ROLLBACK');
    throw e;
  }
}

export class DatabaseTooNewError extends Error {
  constructor(
    readonly path: string,
    readonly version: number,
    readonly supported: number,
  ) {
    super(
      `${path} has schema version ${version}, but this version of the app supports up to ` +
        `${supported}. Update the app, or restore an older copy of your data.`,
    );
    this.name = 'DatabaseTooNewError';
  }
}

export class NotATutorDatabaseError extends Error {
  constructor(readonly path: string) {
    super(`${path} is not an Algo database (it has tables but no schema version)`);
    this.name = 'NotATutorDatabaseError';
  }
}

export class MigrationError extends Error {
  constructor(
    readonly migration: Migration,
    readonly backupPath: string | null,
    cause: unknown,
  ) {
    super(
      `migration ${migration.name} failed: ${cause instanceof Error ? cause.message : String(cause)}` +
        (backupPath ? ` (a copy of the database from before is at ${backupPath})` : ''),
      { cause },
    );
    this.name = 'MigrationError';
  }
}

export interface OpenedDatabase {
  db: Db;
  /** Schema version found on disk (0 for a new database). */
  from: number;
  /** Schema version now. */
  to: number;
  /** The copy made before migrating, if one was made. */
  backupPath: string | null;
}

/** Checks the list is 1, 2, 3… with no gaps or repeats. */
export function checkMigrations(migrations: readonly Migration[]): void {
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new Error(`migration ${m.name} has version ${m.version}, expected ${i + 1}`);
    }
  });
}

function tableExists(db: Db, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(name);
}

/** The schema version stored in the database: 0 for an empty one. */
export function schemaVersion(db: Db, path = 'the database'): number {
  if (!tableExists(db, 'meta')) {
    const any = db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' LIMIT 1").get();
    if (any) throw new NotATutorDatabaseError(path);
    return 0;
  }
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
    { value: string } | undefined;
  const v = Number(row?.value);
  if (!row || !Number.isInteger(v) || v < 1) throw new NotATutorDatabaseError(path);
  return v;
}

function freeBackupPath(dbPath: string, version: number): string {
  const base = `${dbPath}.bak-${version}`;
  if (!existsSync(base)) return base;
  for (let n = 2; ; n++) {
    const p = `${base}-${n}`;
    if (!existsSync(p)) return p;
  }
}

/**
 * Opens (creating if needed) the database at `path` and applies any pending
 * migrations. `':memory:'` works too (no backup is made).
 */
export function openDatabase(
  path: string,
  opts: { migrations?: readonly Migration[]; newInstallId?: () => string } = {},
): OpenedDatabase {
  const migrations = opts.migrations ?? MIGRATIONS;
  checkMigrations(migrations);
  const latest = migrations.length;
  const inMemory = path === ':memory:';
  if (!inMemory) mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  try {
    // Read the version before changing anything, so a newer database is left as it was.
    const from = schemaVersion(db, path);
    if (from > latest) throw new DatabaseTooNewError(path, from, latest);

    db.exec(
      'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; ' +
        'PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;',
    );

    let backupPath: string | null = null;
    if (from > 0 && from < latest && !inMemory) {
      backupPath = freeBackupPath(path, from);
      db.prepare('VACUUM INTO ?').run(backupPath);
    }

    for (const m of migrations.slice(from)) {
      try {
        transaction(db, () => {
          db.exec(m.sql);
          db.prepare(
            "INSERT INTO meta (key, value) VALUES ('schema_version', ?) " +
              'ON CONFLICT (key) DO UPDATE SET value = excluded.value',
          ).run(String(m.version));
          if (m.version === 1) {
            db.prepare("INSERT INTO meta (key, value) VALUES ('install_id', ?)").run(
              (opts.newInstallId ?? randomUUID)(),
            );
          }
        });
      } catch (e) {
        throw new MigrationError(m, backupPath, e);
      }
    }

    const fk = db.prepare('PRAGMA foreign_key_check').all();
    if (fk.length)
      throw new Error(`foreign key check failed after migrating: ${JSON.stringify(fk)}`);

    return { db, from, to: latest, backupPath };
  } catch (e) {
    db.close();
    throw e;
  }
}
