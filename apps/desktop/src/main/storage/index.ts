/**
 * Local state for the main process (SPEC §4): `tutor.db` behind the core
 * `Storage` interface, and `settings.json`.
 */
import { mkdirSync } from 'node:fs';
import { openDatabase } from './database';
import { dataPaths, type DataPaths } from './paths';
import { SettingsStore } from './settings-store';
import { SqliteStorage } from './sqlite-storage';

export { DATA_DIR_ENV, dataPaths, resolveDataDir, type DataPaths } from './paths';
export { DatabaseTooNewError, MigrationError, NotATutorDatabaseError } from './database';
export { InvalidSettingsError, SettingsStore, type SettingsChange } from './settings-store';
export { SqliteStorage } from './sqlite-storage';

export interface AppStorage {
  paths: DataPaths;
  storage: SqliteStorage;
  settings: SettingsStore;
  /** Schema versions before and after opening, and the backup made if any. */
  database: { from: number; to: number; backupPath: string | null };
  close(): Promise<void>;
}

/**
 * Opens everything in `dataDir`, migrating the database if needed. Throws
 * `DatabaseTooNewError`, `NotATutorDatabaseError` or `MigrationError` when
 * the database cannot be used; the caller tells the user and quits.
 */
export function openAppStorage(dataDir: string): AppStorage {
  const paths = dataPaths(dataDir);
  mkdirSync(paths.root, { recursive: true });
  const settings = SettingsStore.load(paths.settings);
  const { db, from, to, backupPath } = openDatabase(paths.db);
  const storage = new SqliteStorage(db);
  return {
    paths,
    storage,
    settings,
    database: { from, to, backupPath },
    close: () => storage.close(),
  };
}
