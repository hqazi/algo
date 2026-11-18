/**
 * `npm run check:storage`: open storage inside the real Electron main
 * process, as the app does, and exercise it (T05). Unit tests run on plain
 * Node; this proves better-sqlite3 loads under Electron's Node too.
 *
 *   electron out/main/storage-check.js
 *
 * Works in a fresh temporary data folder. Prints JSON lines; exits 1 if a
 * check fails.
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';
import Database from 'better-sqlite3';
import { openDatabase } from './database';
import { MIGRATIONS } from './migrations';
import { DatabaseTooNewError, openAppStorage } from '.';

const failures: string[] = [];
const log = (o: object): void => console.log(JSON.stringify(o));

function check(name: string, ok: boolean, detail?: unknown): void {
  log({ check: name, ok, ...(detail === undefined ? {} : { detail }) });
  if (!ok) failures.push(name);
}

async function checks(dir: string): Promise<void> {
  log({
    electron: process.versions.electron,
    node: process.versions.node,
    modules: process.versions.modules,
    platform: `${process.platform}-${process.arch}`,
  });

  // The app's own path: fresh data folder, latest schema, a write and a read.
  const s = openAppStorage(join(dir, 'data'));
  check('fresh database at the latest schema', s.database.to === MIGRATIONS.length, s.database);
  const mem = new Database(':memory:');
  const sqlite = (mem.prepare('SELECT sqlite_version() AS v').get() as { v: string }).v;
  mem.close();
  check('better-sqlite3 loads under Electron', typeof sqlite === 'string', { sqlite });
  const attempt = await s.storage.write((db) =>
    db.createAttempt({ slug: 'two-sum', language: 'python', startedAt: new Date().toISOString() }),
  );
  await s.storage.write((db) =>
    db.addTestRun({
      attemptId: attempt.id,
      kind: 'run',
      report: { big: 4660046610375530309n },
      createdAt: new Date().toISOString(),
    }),
  );
  const report = s.storage.read((db) => db.listTestRuns(attempt.id)[0]?.report);
  check(
    'write and read back (exact 64-bit integers)',
    JSON.stringify(report, (_k, v: unknown) => (typeof v === 'bigint' ? `${v}n` : v)) ===
      '{"big":"4660046610375530309n"}',
  );
  s.settings.update({ ui: { theme: 'dark' } });
  await s.close();
  const again = openAppStorage(join(dir, 'data'));
  check('settings saved and reloaded', again.settings.get().ui.theme === 'dark');
  check(
    'reopen does not migrate',
    again.database.from === again.database.to && again.database.backupPath === null,
  );
  await again.close();

  // Upgrade with a backup, then refuse to go back.
  const dbPath = join(dir, 'upgrade', 'tutor.db');
  openDatabase(dbPath).db.close();
  const v2 = { version: MIGRATIONS.length + 1, name: 'sample', sql: 'CREATE TABLE x (a INTEGER);' };
  const up = openDatabase(dbPath, { migrations: [...MIGRATIONS, v2] });
  up.db.close();
  check('migrates with a backup', up.backupPath !== null, {
    files: readdirSync(join(dir, 'upgrade')).sort(),
  });
  let refused: unknown;
  try {
    openDatabase(dbPath).db.close();
  } catch (e) {
    refused = e;
  }
  check('refuses a newer database', refused instanceof DatabaseTooNewError);
}

void app.whenReady().then(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tutor-storage-check-'));
  try {
    await checks(dir);
  } catch (e) {
    check('no unexpected error', false, e instanceof Error ? e.stack : String(e));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  log({ done: true, failures });
  app.exit(failures.length ? 1 : 0);
});
