/**
 * Schemas for the tutor channels (T10): status, chat threads and turns, and
 * explanation pages. A chat turn is a stream: its events are core's
 * `ChatEvent`s (SPEC §7.3), with `show_results` carrying the practice
 * `reportView` (so hidden cases cross with id, category and status only,
 * as every other report does).
 */
import { z } from 'zod';
import { reportView } from './practice';

const slug = z
  .string()
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'invalid slug');
/** `home` or a problem slug. */
export const threadId = z.union([z.literal('home'), slug]);
export const chatAction = z.enum(['hint', 'review', 'explain']);
const errorKind = z.enum([
  'auth',
  'rate_limit',
  'network',
  'refusal',
  'max_tokens',
  'cancelled',
  'other',
]);

export const tutorStatus = z.strictObject({
  backend: z.enum(['anthropic', 'claude-code', 'fake', 'none']),
  available: z.boolean(),
  reason: z.string().nullable(),
  model: z.string().nullable(),
});

/** Where Claude Code is and whether the tutor can use it (T11); never a secret. */
export const claudeCodeInfo = z.strictObject({
  found: z.boolean(),
  path: z.string().nullable(),
  version: z.string().nullable(),
  usable: z.boolean(),
  reason: z.string().nullable(),
  min_version: z.string(),
});
export const claudeCodeRequest = z.strictObject({ recheck: z.boolean() });

export const toolChip = z.strictObject({
  id: z.string(),
  name: z.string(),
  summary: z.string(),
  ok: z.boolean().nullable(),
});

export const chatMessage = z.strictObject({
  seq: z.int(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  action: chatAction.optional(),
  slug: z.string().optional(),
  tools: z.array(toolChip).optional(),
  stop: z.string().optional(),
  error: z.strictObject({ kind: z.string(), message: z.string() }).optional(),
  created_at: z.string(),
});

export const threadRequest = z.strictObject({ thread: threadId });
export const threadResponse = z.strictObject({
  thread: z.string(),
  running: z.boolean(),
  messages: z.array(chatMessage),
});
export const resetResponse = z.strictObject({ thread: z.string(), archived: z.boolean() });

export const sendRequest = z.strictObject({
  thread: threadId,
  text: z.string().max(20_000).optional(),
  action: chatAction.optional(),
  /** The editor's current code for the thread's problem (the user's own). */
  code: z.string().max(200_000).optional(),
});

export const uiEvent = z.discriminatedUnion('action', [
  z.strictObject({ type: z.literal('ui'), action: z.literal('open_problem'), slug }),
  z.strictObject({ type: z.literal('ui'), action: z.literal('open_explanation'), slug }),
  z.strictObject({ type: z.literal('ui'), action: z.literal('refresh_state') }),
  z.strictObject({
    type: z.literal('ui'),
    action: z.literal('show_results'),
    slug,
    report: reportView,
  }),
]);

export const chatEvent = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text_delta'), text: z.string() }),
  z.strictObject({
    type: z.literal('tool_start'),
    id: z.string(),
    name: z.string(),
    summary: z.string(),
  }),
  z.strictObject({
    type: z.literal('tool_end'),
    id: z.string(),
    ok: z.boolean(),
    summary: z.string(),
  }),
  z.strictObject({ type: z.literal('ui_event'), event: uiEvent }),
  z.strictObject({ type: z.literal('error'), kind: errorKind, message: z.string() }),
  z.strictObject({ type: z.literal('done'), stop: z.string() }),
]);

export const sendResult = z.strictObject({ message: chatMessage });

export const explanationVersion = z.strictObject({
  id: z.string(),
  created_at: z.string(),
  latest: z.boolean(),
});
export const explanationsResponse = z.strictObject({
  slug: z.string(),
  versions: z.array(explanationVersion),
});
export const pageRequest = z.strictObject({
  slug,
  version: z
    .string()
    .regex(/^\d{8}T\d{9}Z$/)
    .optional(),
});
export const pageResponse = z.strictObject({
  slug: z.string(),
  version: z.string(),
  html: z.string(),
});
export const viewedResponse = z.strictObject({
  slug: z.string(),
  attempt_marked_explained: z.boolean(),
});

export type TutorStatusView = z.output<typeof tutorStatus>;
export type ClaudeCodeInfoView = z.output<typeof claudeCodeInfo>;
export type ChatMessageView = z.output<typeof chatMessage>;
export type ChatEventView = z.output<typeof chatEvent>;
export type UiEventView = z.output<typeof uiEvent>;
export type ToolChipView = z.output<typeof toolChip>;
export type ChatActionView = z.output<typeof chatAction>;
export type ExplanationVersionView = z.output<typeof explanationVersion>;
