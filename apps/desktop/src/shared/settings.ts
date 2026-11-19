/**
 * Schemas for Settings and onboarding (T09): `settings.json` values, the API
 * key's status (never the key), the tutor connection test, the executor's
 * status, the profile questionnaire, and data export / import / reset.
 *
 * The API key crosses IPC once, renderer to main, when the user saves it;
 * no response carries it (only `…abcd`).
 */
import { z } from 'zod';
import {
  EDITOR_KEYMAPS,
  EXECUTION_RUNTIMES,
  MAX_FONT_SIZE,
  MAX_TIME_SCALE,
  MIN_FONT_SIZE,
  MIN_TIME_SCALE,
  TUTOR_BACKENDS,
  TUTOR_EFFORTS,
  UI_THEMES,
  UPDATE_CHANNELS,
} from '@algorithm-tutor/core';

const groups = {
  tutor: {
    backend: z.enum(TUTOR_BACKENDS),
    model: z.string().max(200).nullable(),
    effort: z.enum(TUTOR_EFFORTS),
    claudeCodePath: z.string().max(1000).nullable(),
  },
  execution: {
    runtime: z.enum(EXECUTION_RUNTIMES),
    timeScale: z.number().min(MIN_TIME_SCALE).max(MAX_TIME_SCALE),
  },
  editor: {
    fontSize: z.int().min(MIN_FONT_SIZE).max(MAX_FONT_SIZE),
    keymap: z.enum(EDITOR_KEYMAPS),
  },
  ui: { theme: z.enum(UI_THEMES) },
  updates: { channel: z.enum(UPDATE_CHANNELS), auto: z.boolean() },
};

export const settingsView = z.strictObject({
  tutor: z.strictObject(groups.tutor),
  execution: z.strictObject(groups.execution),
  editor: z.strictObject(groups.editor),
  ui: z.strictObject(groups.ui),
  updates: z.strictObject(groups.updates),
});

/** A change from the UI: any subset of keys; main validates it again with core's rules. */
export const settingsPatch = z.strictObject({
  tutor: z.strictObject(groups.tutor).partial().optional(),
  execution: z.strictObject(groups.execution).partial().optional(),
  editor: z.strictObject(groups.editor).partial().optional(),
  ui: z.strictObject(groups.ui).partial().optional(),
  updates: z.strictObject(groups.updates).partial().optional(),
});

export const settingsResponse = z.strictObject({
  settings: settingsView,
  /** Problems found in `settings.json` when the app started (values replaced by defaults). */
  issues: z.array(z.strictObject({ key: z.string(), message: z.string() })),
  /** The Anthropic backend's model when `tutor.model` is `null`. */
  default_model: z.string(),
});

export const keyStatus = z.strictObject({
  source: z.enum(['environment', 'stored', 'none']),
  hint: z
    .string()
    .regex(/^….{0,4}$/)
    .nullable(),
  stored: z.boolean(),
  storage: z.strictObject({
    available: z.boolean(),
    backend: z.string().nullable(),
    weak: z.boolean(),
  }),
  problem: z.string().nullable(),
});

export const setKeyRequest = z.strictObject({ key: z.string().min(1).max(400) });

export const testResult = z.strictObject({
  ok: z.boolean(),
  /** e.g. `auth`, `network`, `rate_limit`, `no_key`. */
  kind: z.string().nullable(),
  message: z.string(),
  model: z.string().nullable(),
});

export const execStatus = z.strictObject({
  python: z.strictObject({
    available: z.boolean(),
    reason: z.string().nullable(),
    versions: z.record(z.string(), z.string()),
  }),
});

export const profileUpdate = z.strictObject({
  goal: z.enum(['general', 'interview']),
  interview_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  experience: z.enum(['beginner', 'intermediate', 'advanced']),
  comfort: z.record(z.string().max(40), z.enum(['none', 'some', 'solid'])),
  hint_preference: z.enum(['early', 'struggle']),
  focus_topic: z.string().max(80).nullable(),
});

export const dataInfo = z.strictObject({ dir: z.string(), backups: z.string() });
export const exportResponse = z.strictObject({ path: z.string().nullable() });
export const importResponse = z.strictObject({
  /** `false` when the user cancelled. */
  staged: z.boolean(),
  backup: z.string().nullable(),
});
export const resetRequest = z.strictObject({ scope: z.enum(['progress', 'everything']) });
export const resetResponse = z.strictObject({
  done: z.boolean(),
  backup: z.string().nullable(),
  /** The app restarts to finish ("everything"). */
  restarting: z.boolean(),
});

export type SettingsView = z.output<typeof settingsView>;
export type SettingsPatchView = z.input<typeof settingsPatch>;
export type SettingsResponse = z.output<typeof settingsResponse>;
export type KeyStatusView = z.output<typeof keyStatus>;
export type TestResultView = z.output<typeof testResult>;
export type ExecStatusView = z.output<typeof execStatus>;
export type ProfileUpdate = z.input<typeof profileUpdate>;
