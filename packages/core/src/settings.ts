/**
 * `settings.json` (SPEC §4.3): the schema, its defaults, and lenient parsing.
 *
 * Reading is forgiving: a missing key takes its default, an invalid value
 * takes its default and is reported as an issue, unknown keys are ignored here
 * and kept by the file store. Changes from the app (`applySettingsPatch`) are
 * strict: an invalid value is refused, not replaced.
 */
import { z } from 'zod';
import { MAX_TIME_SCALE, MIN_TIME_SCALE } from './exec/time-limit';

export const TUTOR_BACKENDS = ['auto', 'anthropic', 'claude-code', 'none'] as const;
export const TUTOR_EFFORTS = ['low', 'medium', 'high'] as const;
export const EXECUTION_RUNTIMES = ['local', 'podman', 'docker'] as const;
export const EDITOR_KEYMAPS = ['default', 'vim', 'emacs'] as const;
export const UI_THEMES = ['system', 'light', 'dark'] as const;
export const UPDATE_CHANNELS = ['stable', 'beta'] as const;
export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 40;

/** One schema per setting, grouped as they are nested in the file. */
const FIELDS = {
  tutor: {
    backend: z.enum(TUTOR_BACKENDS),
    /** `null`: the backend's default model (chosen in T10). */
    model: z.string().trim().min(1).nullable(),
    effort: z.enum(TUTOR_EFFORTS),
  },
  execution: {
    runtime: z.enum(EXECUTION_RUNTIMES),
    timeScale: z.number().min(MIN_TIME_SCALE).max(MAX_TIME_SCALE),
  },
  editor: {
    fontSize: z.number().int().min(MIN_FONT_SIZE).max(MAX_FONT_SIZE),
    keymap: z.enum(EDITOR_KEYMAPS),
  },
  ui: {
    theme: z.enum(UI_THEMES),
  },
  updates: {
    channel: z.enum(UPDATE_CHANNELS),
    auto: z.boolean(),
  },
} as const;

type Fields = typeof FIELDS;
export type Settings = {
  -readonly [G in keyof Fields]: { -readonly [K in keyof Fields[G]]: z.infer<Fields[G][K]> };
};
export type SettingsPatch = { [G in keyof Settings]?: Partial<Settings[G]> };

export const DEFAULT_SETTINGS: Settings = {
  tutor: { backend: 'auto', model: null, effort: 'medium' },
  execution: { runtime: 'local', timeScale: 1.0 },
  editor: { fontSize: 14, keymap: 'default' },
  ui: { theme: 'system' },
  updates: { channel: 'stable', auto: true },
};

export interface SettingsIssue {
  /** Dotted key, e.g. `tutor.backend`; empty for the whole file. */
  key: string;
  message: string;
}

type AnyRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is AnyRecord =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const groups = Object.keys(FIELDS) as (keyof Fields)[];
const fieldsOf = (g: keyof Fields): [string, z.ZodType][] => Object.entries(FIELDS[g]);

function describe(value: unknown): string {
  try {
    const s = JSON.stringify(value);
    return s.length > 60 ? `${s.slice(0, 57)}...` : s;
  } catch {
    return String(value);
  }
}

/** A deep copy of the defaults. */
export function defaultSettings(): Settings {
  return cloneSettings(DEFAULT_SETTINGS);
}

function cloneSettings(s: Settings): Settings {
  const out: AnyRecord = {};
  for (const g of groups) out[g] = { ...s[g] };
  return out as Settings;
}

/**
 * Reads settings from parsed JSON. Never fails: anything missing or invalid
 * takes its default, and every invalid value (not a missing one) is reported.
 */
export function parseSettings(raw: unknown): { settings: Settings; issues: SettingsIssue[] } {
  const settings = defaultSettings();
  const issues: SettingsIssue[] = [];
  if (raw === undefined) return { settings, issues };
  if (!isRecord(raw)) {
    issues.push({ key: '', message: `expected an object, got ${describe(raw)}; using defaults` });
    return { settings, issues };
  }
  for (const g of groups) {
    const group = raw[g];
    if (group === undefined) continue;
    if (!isRecord(group)) {
      issues.push({
        key: g,
        message: `expected an object, got ${describe(group)}; using defaults`,
      });
      continue;
    }
    const target = settings[g] as AnyRecord;
    for (const [k, schema] of fieldsOf(g)) {
      if (!(k in group)) continue;
      const parsed = schema.safeParse(group[k]);
      if (parsed.success) {
        target[k] = parsed.data;
      } else {
        const why = parsed.error.issues[0]?.message ?? 'invalid';
        issues.push({
          key: `${g}.${k}`,
          message: `${describe(group[k])} is not valid (${why}); using ${describe(target[k])}`,
        });
      }
    }
  }
  return { settings, issues };
}

/**
 * Applies a change from the app. Every value must be valid and every key
 * known; otherwise nothing changes and the problems are returned.
 */
export function applySettingsPatch(
  settings: Settings,
  patch: unknown,
): { ok: true; settings: Settings } | { ok: false; issues: SettingsIssue[] } {
  const issues: SettingsIssue[] = [];
  const next = cloneSettings(settings);
  if (!isRecord(patch)) return { ok: false, issues: [{ key: '', message: 'expected an object' }] };
  for (const [g, group] of Object.entries(patch)) {
    if (!(groups as string[]).includes(g)) {
      issues.push({ key: g, message: 'unknown setting group' });
      continue;
    }
    if (!isRecord(group)) {
      issues.push({ key: g, message: 'expected an object' });
      continue;
    }
    const fields = FIELDS[g as keyof Fields] as Record<string, z.ZodType>;
    const target = next[g as keyof Fields] as AnyRecord;
    for (const [k, value] of Object.entries(group)) {
      const schema = fields[k];
      if (!schema) {
        issues.push({ key: `${g}.${k}`, message: 'unknown setting' });
        continue;
      }
      const parsed = schema.safeParse(value);
      if (parsed.success) target[k] = parsed.data;
      else issues.push({ key: `${g}.${k}`, message: parsed.error.issues[0]?.message ?? 'invalid' });
    }
  }
  return issues.length ? { ok: false, issues } : { ok: true, settings: next };
}

/**
 * The object to write to `settings.json`: `raw` (what was read, with any
 * unknown keys) with every known setting replaced by its current value.
 */
export function settingsForFile(raw: unknown, settings: Settings): AnyRecord {
  const out: AnyRecord = isRecord(raw) ? { ...raw } : {};
  for (const g of groups) {
    const prev = out[g];
    out[g] = { ...(isRecord(prev) ? prev : {}), ...settings[g] };
  }
  return out;
}

/** Dotted keys whose values differ, e.g. `['ui.theme']`. */
export function changedSettings(a: Settings, b: Settings): string[] {
  const out: string[] = [];
  for (const g of groups) {
    for (const [k] of fieldsOf(g)) {
      if ((a[g] as AnyRecord)[k] !== (b[g] as AnyRecord)[k]) out.push(`${g}.${k}`);
    }
  }
  return out;
}
