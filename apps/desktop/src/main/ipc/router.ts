/**
 * The main-process side of the IPC contract (`shared/ipc.ts`).
 *
 * `handle()` and `handleStream()` register a handler for one channel. Before a
 * handler runs, the router checks that the message came from the app's own
 * page (main frame, trusted origin) and parses the request with the channel's
 * schema; replies and stream events are parsed too, so a bug in main cannot
 * send the renderer something the contract does not allow. Every reply is an
 * `IpcResult` envelope.
 *
 * Written against `IpcMainLike` rather than Electron's `ipcMain` so it can be
 * tested without Electron.
 */
import type { z } from 'zod';
import {
  invokeChannels,
  isStreamChannel,
  STREAM_CANCEL,
  STREAM_EVENT,
  STREAM_START,
  streamChannels,
  streamStart,
  type InvokeChannel,
  type InvokeResponse,
  type IpcErrorCode,
  type IpcResult,
  type StreamChannel,
  type StreamEvent,
  type StreamEventMessage,
  type StreamResult,
} from '../../shared/ipc';

/** The parts of an Electron `IpcMainInvokeEvent` the router reads. */
export interface IpcEventLike {
  sender: {
    id: number;
    send(channel: string, ...args: unknown[]): void;
    isDestroyed(): boolean;
    once(event: 'destroyed', listener: () => void): unknown;
  };
  senderFrame: { url: string; parent: unknown } | null;
}

/** The parts of Electron's `ipcMain` the router uses. */
export interface IpcMainLike {
  handle(channel: string, listener: (event: IpcEventLike, ...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
  on(channel: string, listener: (event: IpcEventLike, ...args: unknown[]) => void): unknown;
  removeListener(
    channel: string,
    listener: (event: IpcEventLike, ...args: unknown[]) => void,
  ): unknown;
}

export interface RouterOptions {
  /** True if a page at this URL may use the bridge (the app's own UI). */
  isTrustedUrl(url: string): boolean;
  /** Called with handler failures (logging); the renderer only gets a message. */
  onError?: (channel: string, error: unknown) => void;
}

export interface StreamContext<C extends StreamChannel> {
  signal: AbortSignal;
  emit(event: StreamEvent<C>): void;
}

type InvokeHandler<C extends InvokeChannel> = (
  request: z.output<(typeof invokeChannels)[C]['request']>,
) => InvokeResponse<C> | Promise<InvokeResponse<C>>;

type StreamHandler<C extends StreamChannel> = (
  request: z.output<(typeof streamChannels)[C]['request']>,
  context: StreamContext<C>,
) => Promise<StreamResult<C>>;

const fail = (code: IpcErrorCode, message: string): IpcResult<never> => ({
  ok: false,
  error: { code, message },
});

function describe(error: z.ZodError): string {
  return error.issues
    .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ');
}

export class IpcRouter {
  private readonly streamHandlers = new Map<
    string,
    (request: unknown, ctx: StreamContext<StreamChannel>) => Promise<unknown>
  >();
  /** Running streams, keyed by `${webContentsId}:${streamId}`. */
  private readonly running = new Map<string, AbortController>();
  private readonly watched = new Set<number>();
  private readonly invokeNames: string[] = [];

  constructor(
    private readonly ipc: IpcMainLike,
    private readonly opts: RouterOptions,
  ) {
    ipc.handle(STREAM_START, (event, payload) => this.startStream(event, payload));
    ipc.on(STREAM_CANCEL, this.onCancel);
  }

  /** Register the handler for an invoke channel. */
  handle<C extends InvokeChannel>(channel: C, handler: InvokeHandler<C>): void {
    const schemas = invokeChannels[channel];
    this.invokeNames.push(channel);
    this.ipc.handle(channel, async (event, payload): Promise<IpcResult<unknown>> => {
      const denied = this.checkSender(event);
      if (denied) return denied;
      const parsed = schemas.request.safeParse(payload);
      if (!parsed.success) return fail('invalid_request', describe(parsed.error));
      try {
        const value = await handler(parsed.data as never);
        const out = schemas.response.safeParse(value);
        if (!out.success) {
          this.opts.onError?.(channel, out.error);
          return fail('internal', 'the main process sent a reply that breaks the contract');
        }
        return { ok: true, value: out.data };
      } catch (e) {
        this.opts.onError?.(channel, e);
        return fail('internal', e instanceof Error ? e.message : String(e));
      }
    });
  }

  /** Register the handler for a stream channel. */
  handleStream<C extends StreamChannel>(channel: C, handler: StreamHandler<C>): void {
    this.streamHandlers.set(channel, handler as never);
  }

  /** Cancel every stream and remove every handler. */
  dispose(): void {
    for (const c of this.running.values()) c.abort();
    this.running.clear();
    for (const name of this.invokeNames) this.ipc.removeHandler(name);
    this.ipc.removeHandler(STREAM_START);
    this.ipc.removeListener(STREAM_CANCEL, this.onCancel);
  }

  /** Number of streams still running (tests and checks). */
  get activeStreams(): number {
    return this.running.size;
  }

  private checkSender(event: IpcEventLike): IpcResult<never> | undefined {
    const frame = event.senderFrame;
    // Only the top frame of the app's own page; never a subframe or a page the
    // window was somehow navigated to.
    if (!frame || frame.parent !== null || !this.opts.isTrustedUrl(frame.url)) {
      return fail('forbidden', 'IPC is only available to the app’s own page');
    }
    return undefined;
  }

  private async startStream(event: IpcEventLike, payload: unknown): Promise<IpcResult<unknown>> {
    const denied = this.checkSender(event);
    if (denied) return denied;
    const start = streamStart.safeParse(payload);
    if (!start.success) return fail('invalid_request', describe(start.error));
    const { id, channel, request } = start.data;
    const handler = this.streamHandlers.get(channel);
    if (!isStreamChannel(channel) || !handler) {
      return fail('unknown_channel', `no stream channel "${channel}"`);
    }
    const schemas = streamChannels[channel];
    const parsed = schemas.request.safeParse(request);
    if (!parsed.success) return fail('invalid_request', describe(parsed.error));

    const sender = event.sender;
    const key = `${sender.id}:${id}`;
    if (this.running.has(key)) return fail('invalid_request', `stream id "${id}" is in use`);
    const controller = new AbortController();
    this.running.set(key, controller);
    if (!this.watched.has(sender.id)) {
      // A closed or crashed page cancels its streams.
      this.watched.add(sender.id);
      sender.once('destroyed', () => {
        this.watched.delete(sender.id);
        for (const [k, c] of this.running) {
          if (k.startsWith(`${sender.id}:`)) {
            c.abort();
            this.running.delete(k);
          }
        }
      });
    }

    const { signal } = controller;
    const emit = (value: unknown): void => {
      if (signal.aborted || sender.isDestroyed()) return;
      const out = schemas.event.safeParse(value);
      if (!out.success) {
        this.opts.onError?.(channel, out.error);
        return;
      }
      sender.send(STREAM_EVENT, { id, event: out.data } satisfies StreamEventMessage);
    };
    const cancelled = new Promise<IpcResult<never>>((resolve) => {
      signal.addEventListener('abort', () => resolve(fail('cancelled', 'cancelled')), {
        once: true,
      });
    });
    const run = (async (): Promise<IpcResult<unknown>> => {
      try {
        const value = await handler(parsed.data, { signal, emit });
        if (signal.aborted) return fail('cancelled', 'cancelled');
        const out = schemas.result.safeParse(value);
        if (!out.success) {
          this.opts.onError?.(channel, out.error);
          return fail('internal', 'the main process sent a reply that breaks the contract');
        }
        return { ok: true, value: out.data };
      } catch (e) {
        if (signal.aborted) return fail('cancelled', 'cancelled');
        this.opts.onError?.(channel, e);
        return fail('internal', e instanceof Error ? e.message : String(e));
      }
    })();
    try {
      // A cancel answers at once, even if the handler ignores its signal.
      return await Promise.race([run, cancelled]);
    } finally {
      this.running.delete(key);
      controller.abort(); // stops a handler that finished by error or by result
    }
  }

  private readonly onCancel = (event: IpcEventLike, id: unknown): void => {
    if (typeof id !== 'string') return;
    // A page can only cancel its own streams: the key includes its id.
    this.running.get(`${event.sender.id}:${id}`)?.abort();
  };
}
