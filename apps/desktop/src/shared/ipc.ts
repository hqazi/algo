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
  | 'internal'; // the handler threw, or its reply failed its schema

export type IpcResult<T> =
  { ok: true; value: T } | { ok: false; error: { code: IpcErrorCode; message: string } };

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
