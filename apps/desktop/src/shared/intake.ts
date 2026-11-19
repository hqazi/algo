/**
 * Schemas for the new-problem channels (T12): start an intake job (generate,
 * paste, import), follow its progress, and list the open sets.
 *
 * Progress events carry no spec, no pasted text and no test data: a failing
 * self-check crosses as test id, category, status and error type only (plus
 * a visible test's message at the end). The strict schemas below make the
 * router drop a reply that carries anything else (SPEC §10).
 */
import { z } from 'zod';

const slug = z
  .string()
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'invalid slug');
const difficulty = z.enum(['easy', 'medium', 'hard']);
export const JOB_ID_RE = /^job_[0-9a-f]{24}$/;
const jobId = z.string().regex(JOB_ID_RE, 'invalid job id');

export const MAX_PASTE_CHARS = 50_000;
export const MIN_PASTE_CHARS = 20;
export const MAX_IDEA_CHARS = 2_000;

export const intakeRequest = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('generate'),
    topic: slug,
    difficulty,
    idea: z.string().max(MAX_IDEA_CHARS).optional(),
  }),
  z.strictObject({
    kind: z.literal('paste'),
    text: z.string().max(MAX_PASTE_CHARS + 1000),
    topic: slug.optional(),
    difficulty: difficulty.optional(),
  }),
  z.strictObject({
    kind: z.literal('import'),
    set: slug,
    entry: slug,
    topic: slug.optional(),
    difficulty: difficulty.optional(),
  }),
]);

export const jobRequest = z.strictObject({ jobId });
export const startResponse = z.strictObject({ jobId });
export const currentResponse = z.strictObject({ jobId: jobId.nullable() });
export const cancelResponse = z.strictObject({ cancelled: z.boolean() });

const failureItem = z.strictObject({
  id: z.string().optional(),
  category: z.string().optional(),
  status: z.string().optional(),
  error_type: z.string().optional(),
  message: z.string().optional(),
});
export const failureDetail = z.strictObject({
  error: z.string(),
  problems: z.array(z.string()).optional(),
  failures: z.array(failureItem).optional(),
  more_failures: z.int().optional(),
});

const progressEvent = z.strictObject({
  type: z.literal('progress'),
  stage: z.enum(['started', 'fetching', 'writing', 'checking', 'repair']),
  message: z.string(),
  attempt: z.int().optional(),
  max_attempts: z.int().optional(),
  detail: failureDetail.optional(),
});
const doneEvent = z.strictObject({ type: z.literal('done'), slug, title: z.string() });
const errorEvent = z.strictObject({
  type: z.literal('error'),
  code: z.enum([
    'self_check',
    'not_a_problem',
    'fetch',
    'auth',
    'rate_limit',
    'refusal',
    'network',
    'backend',
    'timeout',
    'cancelled',
  ]),
  message: z.string(),
  detail: failureDetail.optional(),
});
export const intakeEvent = z.discriminatedUnion('type', [progressEvent, doneEvent, errorEvent]);
/** How a job ended. */
export const intakeOutcome = z.discriminatedUnion('type', [doneEvent, errorEvent]);

export const openSetView = z.strictObject({
  id: slug,
  name: z.string(),
  url: z.string(),
  license: z.string(),
  attribution: z.string(),
  entries: z.int(),
});
export const openSetsResponse = z.strictObject({ sets: z.array(openSetView) });
export const entriesRequest = z.strictObject({ set: slug });
export const openSetEntry = z.strictObject({
  id: slug,
  title: z.string(),
  blurb: z.string(),
  topic: z.string(),
  difficulty,
  url: z.string(),
  /** Slug of a problem already imported from this entry. */
  imported: slug.nullable(),
});
export const entriesResponse = z.strictObject({ set: slug, entries: z.array(openSetEntry) });

export type IntakeRequestView = z.input<typeof intakeRequest>;
export type IntakeEventView = z.output<typeof intakeEvent>;
export type IntakeOutcomeView = z.output<typeof intakeOutcome>;
export type FailureDetailView = z.output<typeof failureDetail>;
export type OpenSetView = z.output<typeof openSetView>;
export type OpenSetEntryView = z.output<typeof openSetEntry>;
