/**
 * Schemas for Settings → Updates (T13, SPEC §11): where the updater is, as
 * one state the UI renders. Shared by main and renderer; imports only zod.
 */
import { z } from 'zod';

const version = z.string().max(100);

export const updateState = z.discriminatedUnion('state', [
  /** No updater: a development build, or an install type that cannot update itself. */
  z.strictObject({ state: z.literal('unsupported'), reason: z.string().max(500) }),
  /** Nothing checked yet since start. */
  z.strictObject({ state: z.literal('idle') }),
  z.strictObject({ state: z.literal('checking') }),
  /** Up to date at `checkedAt`. */
  z.strictObject({ state: z.literal('none'), checkedAt: z.string() }),
  /** Found, not downloading (automatic updates are off). */
  z.strictObject({ state: z.literal('available'), version }),
  z.strictObject({
    state: z.literal('downloading'),
    version,
    percent: z.number().min(0).max(100),
  }),
  /** Installs on quit, or now with "Restart to update". */
  z.strictObject({ state: z.literal('downloaded'), version }),
  z.strictObject({ state: z.literal('error'), message: z.string().max(2000) }),
]);

export const restartResponse = z.strictObject({ restarting: z.boolean() });

export type UpdateState = z.output<typeof updateState>;
