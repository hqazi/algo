import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS } from '@algo/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvalidSettingsError, SettingsStore, type SettingsChange } from './settings-store';

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tutor-settings-'));
  path = join(dir, 'settings.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const readFile = (): unknown => JSON.parse(readFileSync(path, 'utf8'));

describe('SettingsStore.load', () => {
  it('uses defaults when there is no file, and writes nothing yet', () => {
    const store = SettingsStore.load(path);
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(store.issues).toEqual([]);
    expect(existsSync(path)).toBe(false);
  });

  it('falls back to defaults for invalid values and reports them', () => {
    writeFileSync(
      path,
      JSON.stringify({ ui: { theme: 'neon' }, editor: { fontSize: 99, keymap: 'vim' } }),
    );
    const store = SettingsStore.load(path);
    expect(store.get().ui.theme).toBe('system');
    expect(store.get().editor).toEqual({ fontSize: 14, keymap: 'vim' });
    expect(store.issues.map((i) => i.key)).toEqual(['editor.fontSize', 'ui.theme']);
  });

  it('keeps a copy of a file that is not JSON and reports it', () => {
    writeFileSync(path, '{ "ui": { "theme": "dark", } ');
    const store = SettingsStore.load(path);
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(store.issues).toHaveLength(1);
    expect(store.issues[0]!.message).toMatch(/not valid JSON .*settings\.json\.invalid/);
    expect(readFileSync(`${path}.invalid`, 'utf8')).toBe('{ "ui": { "theme": "dark", } ');
  });

  it('accepts a byte-order mark', () => {
    writeFileSync(path, '\uFEFF{"ui":{"theme":"light"}}');
    expect(SettingsStore.load(path).get().ui.theme).toBe('light');
  });
});

describe('SettingsStore.update', () => {
  it('writes the change, keeping unknown keys, and notifies listeners', () => {
    writeFileSync(path, JSON.stringify({ ui: { theme: 'light', sidebar: 'left' }, mine: [1] }));
    const store = SettingsStore.load(path);
    const seen: SettingsChange[] = [];
    store.onChange((c) => seen.push(c));

    const next = store.update({ ui: { theme: 'dark' }, editor: { keymap: 'emacs' } });
    expect(next.ui.theme).toBe('dark');
    expect(store.get()).toBe(next);
    expect(readFile()).toEqual({
      ...DEFAULT_SETTINGS,
      ui: { theme: 'dark', sidebar: 'left' },
      editor: { fontSize: 14, keymap: 'emacs' },
      mine: [1],
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.changed).toEqual(['editor.keymap', 'ui.theme']);
    expect(seen[0]!.previous.ui.theme).toBe('light');
    expect(readdirSync(dir)).toEqual(['settings.json']); // no temp files left
  });

  it('a later load reads back what was saved', () => {
    SettingsStore.load(path).update({ execution: { timeScale: 2 }, updates: { auto: false } });
    const again = SettingsStore.load(path);
    expect(again.get().execution.timeScale).toBe(2);
    expect(again.get().updates.auto).toBe(false);
    expect(again.issues).toEqual([]);
  });

  it('replaces invalid values from the file with defaults on the first save', () => {
    writeFileSync(path, JSON.stringify({ ui: { theme: 'neon' } }));
    SettingsStore.load(path).update({ editor: { fontSize: 16 } });
    expect((readFile() as typeof DEFAULT_SETTINGS).ui.theme).toBe('system');
  });

  it('refuses an invalid change: nothing written, nobody notified', () => {
    const store = SettingsStore.load(path);
    const listener = vi.fn();
    store.onChange(listener);
    expect(() => store.update({ ui: { theme: 'dark' }, editor: { fontSize: 2 } })).toThrow(
      InvalidSettingsError,
    );
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(existsSync(path)).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('does nothing for a change to the current values', () => {
    const store = SettingsStore.load(path);
    const listener = vi.fn();
    store.onChange(listener);
    store.update({ ui: { theme: 'system' } });
    expect(existsSync(path)).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe, and a failing listener does not stop the others', () => {
    const store = SettingsStore.load(path);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = vi.fn(() => {
      throw new Error('listener bug');
    });
    const good = vi.fn();
    const stop = store.onChange(bad);
    store.onChange(good);
    store.update({ ui: { theme: 'dark' } });
    expect(good).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    stop();
    store.update({ ui: { theme: 'light' } });
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
});
