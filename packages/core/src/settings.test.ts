import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  applySettingsPatch,
  changedSettings,
  defaultSettings,
  parseSettings,
  settingsForFile,
} from './settings';

describe('parseSettings', () => {
  it('uses the SPEC §4.3 defaults for a missing or empty file', () => {
    expect(parseSettings(undefined)).toEqual({ settings: DEFAULT_SETTINGS, issues: [] });
    expect(parseSettings({})).toEqual({ settings: DEFAULT_SETTINGS, issues: [] });
    expect(DEFAULT_SETTINGS).toEqual({
      tutor: { backend: 'auto', model: null, effort: 'medium' },
      execution: { runtime: 'local', timeScale: 1 },
      editor: { fontSize: 14, keymap: 'default' },
      ui: { theme: 'system' },
      updates: { channel: 'stable', auto: true },
    });
  });

  it('reads valid values and fills in the rest', () => {
    const { settings, issues } = parseSettings({
      tutor: { backend: 'anthropic', model: 'some-model' },
      ui: { theme: 'dark' },
      execution: { timeScale: 2.5 },
    });
    expect(issues).toEqual([]);
    expect(settings.tutor).toEqual({ backend: 'anthropic', model: 'some-model', effort: 'medium' });
    expect(settings.ui.theme).toBe('dark');
    expect(settings.execution).toEqual({ runtime: 'local', timeScale: 2.5 });
    expect(settings.editor).toEqual(DEFAULT_SETTINGS.editor);
  });

  it('replaces each invalid value with its default and reports it', () => {
    const { settings, issues } = parseSettings({
      tutor: { backend: 'openai', effort: 'medium' },
      execution: { timeScale: 100 },
      editor: { fontSize: '14', keymap: 'vim' },
      updates: { auto: 'yes' },
    });
    expect(settings).toEqual({
      ...DEFAULT_SETTINGS,
      editor: { fontSize: 14, keymap: 'vim' },
    });
    expect(issues.map((i) => i.key)).toEqual([
      'tutor.backend',
      'execution.timeScale',
      'editor.fontSize',
      'updates.auto',
    ]);
    expect(issues[0]!.message).toMatch(/^"openai" is not valid .*; using "auto"$/);
  });

  it('reports a group or file that is not an object', () => {
    expect(parseSettings({ ui: 'dark' }).issues).toEqual([
      { key: 'ui', message: 'expected an object, got "dark"; using defaults' },
    ]);
    const r = parseSettings([1, 2]);
    expect(r.settings).toEqual(DEFAULT_SETTINGS);
    expect(r.issues[0]!.key).toBe('');
  });

  it('ignores unknown keys (the file store keeps them)', () => {
    expect(parseSettings({ ui: { theme: 'light', sidebar: 'left' }, plugins: {} }).issues).toEqual(
      [],
    );
  });

  it('never hands out the shared defaults object', () => {
    const a = defaultSettings();
    a.ui.theme = 'dark';
    expect(DEFAULT_SETTINGS.ui.theme).toBe('system');
    expect(parseSettings({}).settings.ui).not.toBe(DEFAULT_SETTINGS.ui);
  });
});

describe('applySettingsPatch', () => {
  it('applies valid changes without touching the input', () => {
    const before = defaultSettings();
    const r = applySettingsPatch(before, { ui: { theme: 'dark' }, editor: { fontSize: 16 } });
    expect(r).toEqual({
      ok: true,
      settings: { ...before, ui: { theme: 'dark' }, editor: { fontSize: 16, keymap: 'default' } },
    });
    expect(before.ui.theme).toBe('system');
  });

  it('refuses invalid values and unknown keys, changing nothing', () => {
    const r = applySettingsPatch(defaultSettings(), {
      ui: { theme: 'blue' },
      editor: { fontSize: 15.5 },
      tutor: { colour: 'red' },
      nope: {},
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.map((i) => i.key)).toEqual([
        'ui.theme',
        'editor.fontSize',
        'tutor.colour',
        'nope',
      ]);
    }
    expect(applySettingsPatch(defaultSettings(), 'x').ok).toBe(false);
    expect(applySettingsPatch(defaultSettings(), { ui: 1 }).ok).toBe(false);
  });

  it('allows clearing the model back to the backend default', () => {
    const s = applySettingsPatch(defaultSettings(), { tutor: { model: 'm' } });
    expect(s.ok && applySettingsPatch(s.settings, { tutor: { model: null } })).toMatchObject({
      ok: true,
      settings: { tutor: { model: null } },
    });
    expect(applySettingsPatch(defaultSettings(), { tutor: { model: '  ' } }).ok).toBe(false);
  });
});

describe('settingsForFile', () => {
  it('keeps unknown keys at every level and writes every known setting', () => {
    const raw = { ui: { theme: 'nonsense', sidebar: 'left' }, plugins: { x: 1 }, tutor: 'bad' };
    const settings = { ...defaultSettings(), ui: { theme: 'dark' as const } };
    expect(settingsForFile(raw, settings)).toEqual({
      ...settings,
      ui: { theme: 'dark', sidebar: 'left' },
      plugins: { x: 1 },
    });
    expect(settingsForFile(undefined, settings)).toEqual(settings);
  });
});

describe('changedSettings', () => {
  it('lists the dotted keys that differ', () => {
    const a = defaultSettings();
    const b = {
      ...a,
      ui: { theme: 'dark' as const },
      updates: { channel: 'beta' as const, auto: true },
    };
    expect(changedSettings(a, b)).toEqual(['ui.theme', 'updates.channel']);
    expect(changedSettings(a, defaultSettings())).toEqual([]);
  });
});
