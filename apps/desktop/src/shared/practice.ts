/**
 * Schemas for the practice channels (T08): problems, workspace files, runs,
 * attempts and progress. Field names are snake_case, like `dsa-tutor`'s HTTP
 * contract and core's tool results, so the ported UI keeps its names.
 *
 * Test values cross IPC as JSON text made by core's `stringifyJson` (exact
 * 64-bit integers, DECISIONS D-11), never as live values.
 *
 * Hidden cases have their own strict schema with only `id`, `visibility`,
 * `category`, `status` and `time_ms`: the router parses every reply, so a
 * hidden input or expected value cannot reach the renderer even if a handler
 * forgot to redact (SPEC §10).
 */
import { z } from 'zod';

const slug = z
  .string()
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'invalid slug');
const iso = z.string();
const difficulty = z.enum(['easy', 'medium', 'hard']);
const source = z.enum(['curated', 'generated', 'pasted', 'imported']);
const language = z.enum(['python', 'rust', 'go']);
const level = z.enum(['new', 'learning', 'comfortable']);
const outcome = z.enum(['unaided', 'with_hints', 'gave_up']);
export const PROBLEM_STATUSES = ['new', 'active', 'solved', 'gave_up'] as const;
const problemStatus = z.enum(PROBLEM_STATUSES);
const caseStatus = z.enum(['pass', 'fail', 'error', 'timeout']);

export const slugRequest = z.strictObject({ slug });
export const languageRequest = z.strictObject({ slug, language });

/** A language the problem is offered in, and whether it can run here (T16). */
export const languageOption = z.strictObject({
  language,
  available: z.boolean(),
  /** Why not, e.g. "cargo was not found on PATH; install Rust from …". */
  reason: z.string().optional(),
  /** e.g. "cargo 1.97.0". */
  version: z.string().optional(),
});

const stats = {
  attempted: z.int(),
  solved: z.int(),
  solved_unaided: z.int(),
  last_practised: iso.nullable(),
  level,
};

export const topicView = z.strictObject({
  id: z.string(),
  name: z.string(),
  group: z.string(),
  prerequisites: z.array(z.string()),
  ...stats,
});

export const profileView = z.strictObject({
  goal: z.string(),
  interview_date: z.string().nullable(),
  experience: z.string(),
  comfort: z.record(z.string(), z.string()),
  hint_preference: z.string(),
  focus_topic: z.string().nullable(),
  language,
  created_at: iso,
  updated_at: iso,
});

export const profileResponse = z.strictObject({
  onboarded: z.boolean(),
  profile: profileView.nullable(),
});

export const statusResponse = z.strictObject({
  onboarded: z.boolean(),
  topics: z.array(z.strictObject({ topic: z.string(), ...stats })),
  untouched_topics: z.int(),
  active: z.array(
    z.strictObject({
      slug: z.string(),
      topic: z.string().nullable(),
      hints_used: z.int(),
      started_at: iso,
    }),
  ),
  recent: z.array(
    z.strictObject({ slug: z.string(), outcome: outcome.nullable(), ended_at: iso.nullable() }),
  ),
});

export const problemFilters = z.strictObject({
  topic: slug.optional(),
  difficulty: difficulty.optional(),
  source: source.optional(),
  status: problemStatus.optional(),
});

export const problemListItem = z.strictObject({
  slug: z.string(),
  title: z.string(),
  topic: z.string(),
  difficulty,
  source,
  languages: z.array(language),
  status: problemStatus,
});

export const exampleView = z.strictObject({
  id: z.string(),
  /** Parameter name → JSON text. */
  input: z.record(z.string(), z.string()),
  expected: z.string(),
  explanation: z.string().optional(),
});

export const originView = z.strictObject({
  kind: z.enum(['paste', 'open-set']),
  name: z.string().optional(),
  url: z.string().optional(),
  license: z.string().optional(),
  attribution: z.string().optional(),
});

export const problemDetail = z.strictObject({
  meta: z.strictObject({
    slug: z.string(),
    title: z.string(),
    topic: z.string(),
    difficulty,
    source,
    languages: z.array(language),
    expected_complexity: z.strictObject({ time: z.string(), space: z.string() }),
    time_limit_ms: z.int(),
  }),
  /** `problem.md`: visible examples only. */
  statement_md: z.string(),
  examples: z.array(exampleView),
  origin: originView.nullable(),
  status: problemStatus,
  /** The attempt's language, else the profile's. */
  language,
  /** A recorded attempt exists, so the reference may be shown. */
  attempt_recorded: z.boolean(),
});

export const nextRequest = z.strictObject({
  topic: slug.optional(),
  difficulty: difficulty.optional(),
});

const nextCommon = {
  topic: z.string(),
  topic_name: z.string(),
  difficulty,
  focus_changed: z.boolean(),
  reason: z.string(),
  unfinished: z.array(z.string()).optional(),
};
export const nextResponse = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('solve'),
    slug: z.string(),
    title: z.string(),
    source,
    ...nextCommon,
  }),
  z.strictObject({ action: z.literal('generate'), ...nextCommon }),
]);

export const startResponse = z.strictObject({
  slug: z.string(),
  resumed: z.boolean(),
  language,
  workspace: z.string(),
  workspace_created: z.boolean(),
  hints_used: z.int(),
});

export const workspaceResponse = z.strictObject({
  slug: z.string(),
  language,
  /** A solution file exists; otherwise `code` is the starter. */
  exists: z.boolean(),
  code: z.string(),
  starter: z.string(),
  /** Absolute path of the solution file, for "open in another editor". */
  path: z.string(),
});

export const MAX_CODE_CHARS = 200_000;
export const saveRequest = z.strictObject({ slug, code: z.string().max(MAX_CODE_CHARS) });
export const saveResponse = z.strictObject({ bytes: z.int() });

export const watchEvent = z.strictObject({ code: z.string() });
export const watchResult = z.strictObject({ closed: z.literal(true) });

const visibleCase = z.strictObject({
  id: z.string(),
  visibility: z.literal('visible'),
  category: z.string().optional(),
  status: caseStatus,
  time_ms: z.number().optional(),
  input: z.record(z.string(), z.string()).optional(),
  expected: z.string().optional(),
  actual: z.string().optional(),
  stdout: z.string().optional(),
  message: z.string().optional(),
  error_type: z.string().optional(),
  line: z.int().optional(),
});
const hiddenCase = z.strictObject({
  id: z.string(),
  visibility: z.literal('hidden'),
  category: z.string().optional(),
  status: caseStatus,
  time_ms: z.number().optional(),
});
export const caseView = z.discriminatedUnion('visibility', [visibleCase, hiddenCase]);

export const reportView = z.strictObject({
  slug: z.string(),
  language,
  passed: z.int(),
  total: z.int(),
  all_passed: z.boolean(),
  cases: z.array(caseView),
  /** The solution did not load (syntax error…) or the executor failed. */
  run_error: z.strictObject({ kind: z.string(), message: z.string() }).optional(),
  duration_ms: z.number(),
});

export const recordView = z.strictObject({
  recorded: z.strictObject({
    slug: z.string(),
    outcome,
    hints_used: z.int(),
    tests_passed: z.int(),
    tests_total: z.int(),
  }),
  topic: z.string(),
  level,
  level_changed: z.boolean(),
  solved_unaided: z.int(),
});

export const submitResponse = z.strictObject({
  report: reportView,
  /** Every test passed and the attempt was closed. */
  recorded: z.boolean(),
  record: recordView.optional(),
});

export const giveUpRequest = z.strictObject({ slug, notes: z.string().max(600).optional() });
export const giveUpResponse = z.strictObject({
  /** `null` when no solution was saved. */
  report: reportView.nullable(),
  record: recordView,
});

export const referenceResponse = z.strictObject({
  slug: z.string(),
  language,
  code: z.string(),
});

export const attemptsRequest = z.strictObject({
  slug: slug.optional(),
  last: z.int().min(0).max(1000).optional(),
});
export const attemptView = z.strictObject({
  id: z.int(),
  slug: z.string(),
  topic: z.string().nullable(),
  difficulty: difficulty.nullable(),
  source: source.nullable(),
  language,
  started_at: iso,
  ended_at: iso.nullable(),
  outcome: outcome.nullable(),
  hints_used: z.int(),
  explanation_viewed: z.boolean(),
  tests_passed: z.int().nullable(),
  tests_total: z.int().nullable(),
  notes: z.string(),
});

export const themeView = z.strictObject({ theme: z.enum(['system', 'light', 'dark']) });

export type LanguageOption = z.output<typeof languageOption>;
export type TopicView = z.output<typeof topicView>;
export type ProfileView = z.output<typeof profileView>;
export type ProfileResponse = z.output<typeof profileResponse>;
export type StatusResponse = z.output<typeof statusResponse>;
export type ProblemFilters = z.output<typeof problemFilters>;
export type ProblemListItem = z.output<typeof problemListItem>;
export type ExampleView = z.output<typeof exampleView>;
export type ProblemDetail = z.output<typeof problemDetail>;
export type NextResponse = z.output<typeof nextResponse>;
export type StartResponse = z.output<typeof startResponse>;
export type WorkspaceResponse = z.output<typeof workspaceResponse>;
export type CaseView = z.output<typeof caseView>;
export type ReportView = z.output<typeof reportView>;
export type RecordView = z.output<typeof recordView>;
export type SubmitResponse = z.output<typeof submitResponse>;
export type GiveUpResponse = z.output<typeof giveUpResponse>;
export type ReferenceResponse = z.output<typeof referenceResponse>;
export type AttemptView = z.output<typeof attemptView>;
export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];
export type Theme = z.output<typeof themeView>['theme'];
