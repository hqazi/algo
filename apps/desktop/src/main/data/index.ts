/**
 * The Data section of Settings (SPEC §4.5): export, import, reset, with an
 * automatic export to `backups/` before anything is replaced or removed.
 * File choosers, confirmations and restarting are injected (`DataUi`), so
 * this runs in tests without Electron.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Storage } from '@algo/core';
import type { DataPaths } from '../storage/paths';
import {
  exportData,
  exportName,
  readArchive,
  stageImport,
  stageReset,
  type Snapshotter,
} from './archive';

export {
  applyPending,
  ArchiveError,
  exportData,
  exportName,
  readArchive,
  stageImport,
  stageReset,
  type PendingOp,
} from './archive';

export interface DataUi {
  /** A path to save the export to, or `null` if cancelled. */
  chooseExportPath(defaultName: string): Promise<string | null>;
  /** A zip to import, or `null` if cancelled. */
  chooseImportFile(): Promise<string | null>;
  /** `true` to go ahead. */
  confirm(opts: { message: string; detail: string; ok: string }): Promise<boolean>;
  openFolder(path: string): Promise<boolean>;
  /** Restarts the app (after the reply has been sent). */
  restart(): void;
}

export interface DataDeps {
  paths: DataPaths;
  storage: Storage & Snapshotter;
  appVersion: string;
  now: () => string;
  ui: DataUi;
}

export class DataService {
  constructor(private readonly deps: DataDeps) {}

  info(): { dir: string; backups: string } {
    return { dir: this.deps.paths.root, backups: this.deps.paths.backups };
  }

  openFolder(): Promise<boolean> {
    return this.deps.ui.openFolder(this.deps.paths.root);
  }

  /** Exports to `backups/` (before import and reset); returns the path. */
  async backup(label: string): Promise<string> {
    const now = this.deps.now();
    const dest = join(this.deps.paths.backups, exportName(now, label));
    await exportData({ ...this.base(now), dest });
    return dest;
  }

  private base(now: string) {
    return {
      paths: this.deps.paths,
      db: this.deps.storage,
      appVersion: this.deps.appVersion,
      now,
    };
  }

  async exportTo(dest: string): Promise<string> {
    return (await exportData({ ...this.base(this.deps.now()), dest })).path;
  }

  /** Export with a save dialog; `null` if cancelled. */
  async exportInteractive(): Promise<string | null> {
    const dest = await this.deps.ui.chooseExportPath(exportName(this.deps.now()));
    return dest ? this.exportTo(dest) : null;
  }

  /**
   * Validates `src` (throws `ArchiveError`), backs up the current data and
   * stages the import for the next start. Does not restart.
   */
  async stageImportFrom(src: string): Promise<{ backup: string }> {
    const archive = readArchive(readFileSync(src));
    const backup = await this.backup('before-import');
    stageImport(this.deps.paths, archive, { op: 'import', source: src, at: this.deps.now() });
    return { backup };
  }

  async importInteractive(): Promise<{ staged: boolean; backup: string | null }> {
    const src = await this.deps.ui.chooseImportFile();
    if (!src) return { staged: false, backup: null };
    const archive = readArchive(readFileSync(src)); // check before asking
    const ok = await this.deps.ui.confirm({
      message: 'Replace all your data with this export?',
      detail:
        `Progress, chats, solutions, settings and your own problems will be replaced by the ` +
        `contents of ${src} (made ${archive.manifest.created_at.slice(0, 10)}). ` +
        `Your current data is exported to the backups folder first. The app restarts to finish.`,
      ok: 'Import and restart',
    });
    if (!ok) return { staged: false, backup: null };
    const { backup } = await this.stageImportFrom(src);
    this.deps.ui.restart();
    return { staged: true, backup };
  }

  /** Deletes attempts, hints, test runs and topic levels, after a backup. */
  async resetProgress(): Promise<{ backup: string }> {
    const backup = await this.backup('before-reset-progress');
    await this.deps.storage.write((db) => db.resetProgress());
    return { backup };
  }

  /** Backs up, then stages removing everything (applied at the next start). */
  async stageResetEverything(): Promise<{ backup: string }> {
    const backup = await this.backup('before-reset');
    stageReset(this.deps.paths, this.deps.now());
    return { backup };
  }

  async resetInteractive(
    scope: 'progress' | 'everything',
  ): Promise<{ done: boolean; backup: string | null; restarting: boolean }> {
    const everything = scope === 'everything';
    const ok = await this.deps.ui.confirm(
      everything
        ? {
            message: 'Reset everything?',
            detail:
              'Removes your profile, progress, chats, solutions, settings, your own problems, ' +
              'explanations and the stored API key. Everything except the key is exported to ' +
              'the backups folder first. The app restarts as new.',
            ok: 'Reset everything',
          }
        : {
            message: 'Reset progress?',
            detail:
              'Removes every attempt, hint and topic level. Your profile, solutions, chats and ' +
              'settings stay. Your data is exported to the backups folder first.',
            ok: 'Reset progress',
          },
    );
    if (!ok) return { done: false, backup: null, restarting: false };
    if (!everything) return { done: true, restarting: false, ...(await this.resetProgress()) };
    const { backup } = await this.stageResetEverything();
    this.deps.ui.restart();
    return { done: true, backup, restarting: true };
  }
}
