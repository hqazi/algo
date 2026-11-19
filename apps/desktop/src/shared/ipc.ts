/**
 * The IPC contract between the UI renderer and the main process (SPEC §3,
 * §10). Every channel is listed here with zod schemas; the main process
 * validates each request (and its own responses and stream events) against
 * them, and the renderer's types come from them.
 *
 * Two kinds of channel:
 * - invoke: one request, one response.
 * - stream: one request, any number of events, then one result. The
 *   renderer can cancel; the handler sees an `AbortSignal`.
 *
 * Replies cross the bridge as an `IpcResult` envelope, never as a thrown
 * error, so the renderer always gets a code it can act on.
 *
 * Shared by main and renderer (types); imports nothing but zod. The preload
 * imports only `channels.ts` and types from here.
 */
import { z } from 'zod';
import { INVOKE_CHANNELS, STREAM_CHANNELS } from './channels';
import * as P from './practice';
import * as T from './tutor';

export {
  INVOKE_CHANNELS,
  STREAM_CHANNELS,
  STREAM_START,
  STREAM_EVENT,
  STREAM_CANCEL,
  isInvokeChannel,
  isStreamChannel,
} from './channels';

export const invokeChannels = {
  /** App and runtime versions (the example channel from T02). */
  'app:version': {
    request: z.undefined(),
    response: z.strictObject({
      app: z.string(),
      electron: z.string(),
      chrome: z.string(),
      node: z.string(),
    }),
  },

  // ---- practice (T08): progress, problems, workspace files, runs, attempts
  /** Topics in teaching order, with the learner's level in each. */
  'catalog:topics': {
    request: z.undefined(),
    response: z.strictObject({ topics: z.array(P.topicView) }),
  },
  'profile:get': { request: z.undefined(), response: P.profileResponse },
  /** Save the default profile (onboarding's "use defaults"; T09 adds the questions). */
  'profile:defaults': { request: z.undefined(), response: P.profileResponse },
  'status:get': { request: z.undefined(), response: P.statusResponse },
  'problems:list': {
    request: P.problemFilters,
    response: z.strictObject({ problems: z.array(P.problemListItem) }),
  },
  'problems:get': { request: P.slugRequest, response: P.problemDetail },
  /** Recommend the next problem (SPEC §9.2); may move the focus topic. */
  'problems:next': { request: P.nextRequest, response: P.nextResponse },
  /** Open (or resume) an attempt and create the starter file. */
  'problems:start': { request: P.slugRequest, response: P.startResponse },
  /** Refused (`locked`) until an attempt on the problem is recorded. */
  'problems:reference': { request: P.slugRequest, response: P.referenceResponse },
  'workspace:get': { request: P.slugRequest, response: P.workspaceResponse },
  /** Save as you type. Refused (`busy`) while the problem's tests run. */
  'workspace:save': { request: P.saveRequest, response: P.saveResponse },
  /** Visible tests only; stored as a `run` when an attempt is open. */
  'runs:run': { request: P.slugRequest, response: P.reportView },
  /** Every test; records the attempt only when all pass. */
  'runs:submit': { request: P.slugRequest, response: P.submitResponse },
  /** Runs every test once more and records the attempt as gave up. */
  'attempts:give-up': { request: P.giveUpRequest, response: P.giveUpResponse },
  /** Recorded attempts, oldest first. */
  'attempts:list': {
    request: P.attemptsRequest,
    response: z.strictObject({ attempts: z.array(P.attemptView) }),
  },
  'settings:theme': { request: z.undefined(), response: P.themeView },
  'settings:set-theme': { request: P.themeView, response: P.themeView },

  // ---- tutor (T10): status, chat threads, explanation pages
  /** Which backend is in use and whether it can run. */
  'tutor:status': { request: z.undefined(), response: T.tutorStatus },
  /** A thread's current transcript. */
  'chat:thread': { request: T.threadRequest, response: T.threadResponse },
  /** Archive the thread ("Reset chat"). Refused (`busy`) while a reply streams. */
  'chat:reset': { request: T.threadRequest, response: T.resetResponse },
  /** A problem's explanation versions, newest first. */
  'explanations:list': { request: P.slugRequest, response: T.explanationsResponse },
  /** One version's HTML (the latest without `version`); shown only in a sandboxed iframe. */
  'explanations:page': { request: T.pageRequest, response: T.pageResponse },
  /** The learner opened an explanation: an open attempt counts as explained. */
  'explanations:viewed': { request: P.slugRequest, response: T.viewedResponse },
} as const;

export const streamChannels = {
  /**
   * Example stream: counts from 1 to `to`, one event every `intervalMs`.
   * Exists to exercise streaming and cancel until chat and job progress
   * (T08, T10) use the same mechanism.
   */
  'example:count': {
    request: z.strictObject({
      to: z.int().min(1).max(1000),
      intervalMs: z.int().min(0).max(10_000),
    }),
    event: z.strictObject({ n: z.int() }),
    result: z.strictObject({ counted: z.int() }),
  },
  /**
   * Edits to a problem's solution file made outside the app (another
   * editor): one event per change, until the renderer cancels.
   */
  'workspace:watch': {
    request: P.slugRequest,
    event: P.watchEvent,
    result: P.watchResult,
  },
  /**
   * One chat turn: the tutor's events (text, tool chips, UI events), ending
   * with `done` or `error`; the result is the stored reply. Cancel stops the
   * turn. Refused before it starts: `busy`, `unavailable`, `empty`…
   */
  'chat:send': { request: T.sendRequest, event: T.chatEvent, result: T.sendResult },
} as const;

export type InvokeChannel = keyof typeof invokeChannels;
export type StreamChannel = keyof typeof streamChannels;

export type InvokeRequest<C extends InvokeChannel> = z.input<(typeof invokeChannels)[C]['request']>;
export type InvokeResponse<C extends InvokeChannel> = z.output<
  (typeof invokeChannels)[C]['response']
>;
export type StreamRequest<C extends StreamChannel> = z.input<(typeof streamChannels)[C]['request']>;
export type StreamEvent<C extends StreamChannel> = z.output<(typeof streamChannels)[C]['event']>;
export type StreamResult<C extends StreamChannel> = z.output<(typeof streamChannels)[C]['result']>;

// The preload's name lists (`channels.ts`) must match the contract exactly.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const namesMatch: [
  Same<(typeof INVOKE_CHANNELS)[number], InvokeChannel>,
  Same<(typeof STREAM_CHANNELS)[number], StreamChannel>,
] = [true, true];
void namesMatch;

export const streamStart = z.strictObject({
  id: z.string().min(1).max(64),
  channel: z.string(),
  request: z.unknown(),
});
export type StreamStart = z.infer<typeof streamStart>;
export type StreamEventMessage = { id: string; event: unknown };

export type IpcErrorCode =
  | 'invalid_request' // the payload failed its schema
  | 'unknown_channel'
  | 'forbidden' // the sender is not the app's own page
  | 'cancelled'
  | 'refused' // the handler declined on purpose; `reason` says why (e.g. `busy`, `locked`)
  | 'internal'; // the handler threw, or its reply failed its schema

export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: IpcErrorCode; message: string; reason?: string } };

/** What a running stream gives the renderer. */
export interface StreamHandle<R> {
  readonly result: Promise<IpcResult<R>>;
  cancel(): void;
}

/** The `window.tutor` bridge exposed by the preload. */
export interface TutorBridge {
  invoke<C extends InvokeChannel>(
    channel: C,
    request: InvokeRequest<C>,
  ): Promise<IpcResult<InvokeResponse<C>>>;
  stream<C extends StreamChannel>(
    channel: C,
    request: StreamRequest<C>,
    onEvent: (event: StreamEvent<C>) => void,
  ): StreamHandle<StreamResult<C>>;
}
