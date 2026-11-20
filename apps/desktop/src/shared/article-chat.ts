/**
 * Schemas for chats on passages (T24, SPEC §15.5): an article's threads, a
 * new thread for a passage, renaming, and the one-time provider notice. The
 * transcript and turns use the chat channels with an `article:<uuid>`
 * thread id. Imports only zod.
 */
import { z } from 'zod';

const articleId = z.string().min(1).max(100);
export const articleThreadId = z
  .string()
  .regex(
    /^article:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    'invalid thread',
  );

/** core's `Anchor`: heading path, quote and 32 characters of context each side. */
export const anchor = z.strictObject({
  kind: z.enum(['quote', 'heading']),
  heading: z.array(z.string().max(500)).max(6),
  quote: z.string().max(1000),
  prefix: z.string().max(128),
  suffix: z.string().max(128),
});

export const articleThread = z.strictObject({
  id: articleThreadId,
  /** The first question, or the user's name for it; `null` before the first message. */
  title: z.string().max(200).nullable(),
  /** `null` only for a row that is not a valid anchor (shown as detached). */
  anchor: anchor.nullable(),
  created_at: z.string(),
  last_at: z.string().nullable(),
  messages: z.int().min(0),
});

export const threadsRequest = z.strictObject({ article: articleId });
export const threadsResponse = z.strictObject({
  article: articleId,
  threads: z.array(articleThread),
});

export const createThreadRequest = z.strictObject({ article: articleId, anchor });
export const createThreadResponse = z.strictObject({ thread: articleThreadId });

export const renameRequest = z.strictObject({
  thread: articleThreadId,
  title: z.string().min(1).max(200),
});
export const renameResponse = z.strictObject({ thread: articleThreadId, title: z.string() });

/** `ack: true` records that the user has seen the notice. */
export const noticeRequest = z.strictObject({ ack: z.boolean() });
export const noticeResponse = z.strictObject({ seen: z.boolean() });

export type AnchorView = z.output<typeof anchor>;
export type ArticleThreadView = z.output<typeof articleThread>;
