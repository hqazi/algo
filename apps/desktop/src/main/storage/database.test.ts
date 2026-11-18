import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync as Database } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DatabaseTooNewError,
  MigrationError,
  NotATutorDatabaseError,
  checkMigrations,
  openDatabase,
  schemaVersion,
  type Db,
} from './database';
import { MIGRATIONS, type Migration } from './migrations';

const V2: Migration = {
  version: 2,
  name: '0002-sample',
  sql: `
    ALTER TABLE attempts ADD COLUMN duration_ms INTEGER;
    CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL) STRICT;
    UPDATE attempts SET duration_ms = 0;
  `,
};
const BROKEN_V2: Migration = {
  version: 2,
  name: '0002-broken',
  sql: `CREATE TABLE half_done (id INTEGER) STRICT; UPDATE no_such_table SET x = 1;`,
};

let dir: string;
let dbPath: string;
const open: Db[] = [];
const track = (db: Db): Db => (open.push(db), db);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tutor-db-'));
  dbPath = join(dir, 'tutor.db');
});
afterEach(() => {
  for (const db of open.splice(0)) if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

const tables = (db: Db): string[] =>
  (
    db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((r) => r.name);

function seedV1(): void {
  const { db } = openDatabase(dbPath, { migrations: MIGRATIONS.slice(0, 1) });
  db.prepare(
    "INSERT INTO attempts (slug, language, started_at) VALUES ('two-sum', 'python', '2026-11-18T10:00:00Z')",
  ).run();
  db.close();
}

describe('migration files', () => {
  it('lists every .sql file in the folder, numbered 1, 2, 3…', () => {
    const files = readdirSync(join(import.meta.dirname, 'migrations'))
      .filter((f) => f.endsWith('.sql'))
      .sort();
    expect(MIGRATIONS.map((m) => `${m.name}.sql`)).toEqual(files);
    MIGRATIONS.forEach((m) =>
      expect(m.name.startsWith(String(m.version).padStart(4, '0'))).toBe(true),
    );
    expect(() => checkMigrations(MIGRATIONS)).not.toThrow();
  });

  it('rejects gaps and repeats', () => {
    expect(() => checkMigrations([MIGRATIONS[0]!, { ...V2, version: 3 }])).toThrow(/expected 2/);
    expect(() => checkMigrations([MIGRATIONS[0]!, { ...V2, version: 1 }])).toThrow(/expected 2/);
  });
});

describe('openDatabase', () => {
  it('creates a fresh database at the latest version with every table', () => {
    const r = openDatabase(dbPath, { newInstallId: () => 'install-1' });
    track(r.db);
    expect(r).toMatchObject({ from: 0, to: MIGRATIONS.length, backupPath: null });
    expect(schemaVersion(r.db)).toBe(MIGRATIONS.length);
    expect(tables(r.db)).toEqual(
      expect.arrayContaining([
        'meta',
        'profile',
        'topic_progress',
        'problems',
        'attempts',
        'hints',
        'threads',
        'messages',
        'test_runs',
      ]),
    );
    expect(r.db.prepare("SELECT value FROM meta WHERE key = 'install_id'").get()).toEqual({
      value: 'install-1',
    });
    expect(r.db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    expect(r.db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    expect(readdirSync(dir).some((f) => f.includes('.bak-'))).toBe(false);
  });

  it('creates missing parent folders', () => {
    const nested = join(dir, 'a', 'b', 'tutor.db');
    track(openDatabase(nested).db);
    expect(existsSync(nested)).toBe(true);
  });

  it('reopens an up-to-date database without migrating or backing up', () => {
    openDatabase(dbPath, { newInstallId: () => 'first' }).db.close();
    const r = openDatabase(dbPath, { newInstallId: () => 'second' });
    track(r.db);
    expect(r).toMatchObject({ from: MIGRATIONS.length, to: MIGRATIONS.length, backupPath: null });
    expect(r.db.prepare("SELECT value FROM meta WHERE key = 'install_id'").get()).toEqual({
      value: 'first',
    });
  });

  it('migrates v1 to v2, keeping data, after writing tutor.db.bak-1', () => {
    seedV1();
    const r = openDatabase(dbPath, { migrations: [MIGRATIONS[0]!, V2] });
    track(r.db);
    expect(r).toMatchObject({ from: 1, to: 2, backupPath: `${dbPath}.bak-1` });
    expect(schemaVersion(r.db)).toBe(2);
    expect(tables(r.db)).toContain('notes');
    expect(r.db.prepare('SELECT slug, duration_ms FROM attempts').all()).toEqual([
      { slug: 'two-sum', duration_ms: 0 },
    ]);

    // The backup is the v1 database as it was.
    const bak = track(new Database(`${dbPath}.bak-1`, { readOnly: true }));
    expect(schemaVersion(bak)).toBe(1);
    expect(tables(bak)).not.toContain('notes');
    expect(bak.prepare('SELECT slug FROM attempts').all()).toEqual([{ slug: 'two-sum' }]);
  });

  it('does not overwrite an earlier backup of the same version', () => {
    seedV1();
    // A leftover from an earlier upgrade that was rolled back.
    const leftover = track(new Database(`${dbPath}.bak-1`));
    leftover.exec('CREATE TABLE marker (x INTEGER)');
    leftover.close();
    const r = openDatabase(dbPath, { migrations: [MIGRATIONS[0]!, V2] });
    track(r.db);
    expect(r.backupPath).toBe(`${dbPath}.bak-1-2`);
    expect(tables(track(new Database(`${dbPath}.bak-1`, { readOnly: true })))).toEqual(['marker']);
  });

  it('rolls a failed migration back and leaves the database at the last good version', () => {
    seedV1();
    let error: unknown;
    try {
      openDatabase(dbPath, { migrations: [MIGRATIONS[0]!, BROKEN_V2] });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(MigrationError);
    expect((error as Error).message).toMatch(/0002-broken failed: no such table/);
    expect((error as Error).message).toContain(`${dbPath}.bak-1`);

    const db = track(new Database(dbPath));
    expect(schemaVersion(db)).toBe(1);
    expect(tables(db)).not.toContain('half_done');
    expect(db.prepare('SELECT slug FROM attempts').all()).toEqual([{ slug: 'two-sum' }]);
  });

  it('refuses a database newer than the app, leaving it untouched', () => {
    openDatabase(dbPath, { migrations: [MIGRATIONS[0]!, V2] }).db.close();
    const before = readFileSync(dbPath);
    expect(() => openDatabase(dbPath, { migrations: MIGRATIONS.slice(0, 1) })).toThrow(
      DatabaseTooNewError,
    );
    try {
      openDatabase(dbPath, { migrations: MIGRATIONS.slice(0, 1) });
    } catch (e) {
      expect(e).toMatchObject({ version: 2, supported: 1 });
      expect((e as Error).message).toMatch(/schema version 2.*supports up to 1/);
    }
    expect(readFileSync(dbPath).equals(before)).toBe(true);
    expect(readdirSync(dir).some((f) => f.includes('.bak-'))).toBe(false);
  });

  it('refuses a SQLite file that is not ours', () => {
    const other = new Database(dbPath);
    other.exec('CREATE TABLE something (x INTEGER)');
    other.close();
    expect(() => openDatabase(dbPath)).toThrow(NotATutorDatabaseError);
  });

  it('works in memory', () => {
    const r = openDatabase(':memory:');
    track(r.db);
    expect(r).toMatchObject({ from: 0, to: MIGRATIONS.length, backupPath: null });
  });
});
