/**
 * `settings.json` in the data folder (SPEC §4.3). Loading never fails:
 * invalid values fall back to their defaults and are reported in `issues`
 * (for a notice in the UI); unknown keys are kept when saving. Changes are
 * validated, written atomically and announced to listeners at once.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import {
  applySettingsPatch,
  changedSettings,
  parseSettings,
  settingsForFile,
  type Settings,
  type SettingsIssue,
} from '@algo/core';

export interface SettingsChange {
  settings: Settings;
  previous: Settings;
  /** Dotted keys that changed, e.g. `['ui.theme']`. */
  changed: string[];
}

export class InvalidSettingsError extends Error {
  constructor(readonly issues: SettingsIssue[]) {
    super(
      `invalid settings: ${issues.map((i) => `${i.key || '(root)'}: ${i.message}`).join('; ')}`,
    );
    this.name = 'InvalidSettingsError';
  }
}

export class SettingsStore {
  private raw: unknown;
  private current: Settings;
  private readonly listeners = new Set<(change: SettingsChange) => void>();
  /** Problems found when the file was loaded. */
  readonly issues: readonly SettingsIssue[];

  private constructor(
    readonly path: string,
    raw: unknown,
    settings: Settings,
    issues: SettingsIssue[],
  ) {
    this.raw = raw;
    this.current = settings;
    this.issues = issues;
  }

  /**
   * Reads the file. A missing file means defaults (nothing is written until
   * the first change). A file that is not JSON is copied to
   * `settings.json.invalid` so the next save does not lose it.
   */
  static load(path: string): SettingsStore {
    if (!existsSync(path)) {
      const { settings } = parseSettings(undefined);
      return new SettingsStore(path, {}, settings, []);
    }
    const text = readFileSync(path, 'utf8');
    let raw: unknown;
    try {
      raw = JSON.parse(text.startsWith('\uFEFF') ? text.slice(1) : text);
    } catch (e) {
      const keep = `${path}.invalid`;
      copyFileSync(path, keep);
      const { settings } = parseSettings(undefined);
      const why = e instanceof Error ? e.message : String(e);
      return new SettingsStore(path, {}, settings, [
        { key: '', message: `not valid JSON (${why}); using defaults, a copy is at ${keep}` },
      ]);
    }
    const { settings, issues } = parseSettings(raw);
    return new SettingsStore(path, raw, settings, issues);
  }

  get(): Settings {
    return this.current;
  }

  /**
   * Applies a partial change, e.g. `{ ui: { theme: 'dark' } }`. Throws
   * `InvalidSettingsError` (and changes nothing) if any value is invalid.
   */
  update(patch: unknown): Settings {
    const result = applySettingsPatch(this.current, patch);
    if (!result.ok) throw new InvalidSettingsError(result.issues);
    const previous = this.current;
    const changed = changedSettings(previous, result.settings);
    if (!changed.length) return previous;
    const raw = settingsForFile(this.raw, result.settings);
    writeAtomic(this.path, `${JSON.stringify(raw, null, 2)}\n`);
    this.raw = raw;
    this.current = result.settings;
    const change: SettingsChange = { settings: result.settings, previous, changed };
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch (e) {
        console.error('settings listener failed:', e);
      }
    }
    return result.settings;
  }

  /** Calls `listener` after every change; returns a function that stops it. */
  onChange(listener: (change: SettingsChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, path);
}
