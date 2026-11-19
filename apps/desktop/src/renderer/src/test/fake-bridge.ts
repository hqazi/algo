/**
 * A fake `window.tutor` for UI tests: invoke handlers by channel, and streams
 * the test can push events into. Replies go through the real contract
 * schemas, so a test cannot hand the UI something main never could.
 */
import {
  invokeChannels,
  type InvokeChannel,
  type InvokeRequest,
  type InvokeResponse,
  type IpcResult,
  type StreamChannel,
  type StreamEvent,
  type TutorBridge,
} from '../../../shared/ipc';

type Handler<C extends InvokeChannel> = (
  request: InvokeRequest<C>,
) => InvokeResponse<C> | Promise<InvokeResponse<C>>;

export class Refused extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

interface OpenStream {
  channel: StreamChannel;
  request: unknown;
  emit(event: unknown): void;
  cancelled: boolean;
}

export class FakeBridge implements TutorBridge {
  readonly calls: { channel: string; request: unknown }[] = [];
  readonly streams: OpenStream[] = [];
  private readonly handlers = new Map<string, (r: unknown) => unknown>();

  on<C extends InvokeChannel>(channel: C, handler: Handler<C>): this {
    this.handlers.set(channel, handler as (r: unknown) => unknown);
    return this;
  }

  async invoke<C extends InvokeChannel>(
    channel: C,
    request: InvokeRequest<C>,
  ): Promise<IpcResult<InvokeResponse<C>>> {
    this.calls.push({ channel, request });
    const h = this.handlers.get(channel);
    if (!h) return { ok: false, error: { code: 'unknown_channel', message: channel } };
    try {
      const value = await h(request);
      const parsed = invokeChannels[channel].response.parse(value);
      return { ok: true, value: parsed as InvokeResponse<C> };
    } catch (e) {
      if (e instanceof Refused)
        return { ok: false, error: { code: 'refused', message: e.message, reason: e.reason } };
      return { ok: false, error: { code: 'internal', message: String(e) } };
    }
  }

  stream<C extends StreamChannel>(
    channel: C,
    request: unknown,
    onEvent: (event: StreamEvent<C>) => void,
  ) {
    let resolve!: (r: IpcResult<never>) => void;
    const result = new Promise<IpcResult<never>>((r) => (resolve = r));
    const s: OpenStream = {
      channel,
      request,
      emit: (e) => {
        if (!s.cancelled) onEvent(e as StreamEvent<C>);
      },
      cancelled: false,
    };
    this.streams.push(s);
    return {
      result,
      cancel: () => {
        s.cancelled = true;
        resolve({ ok: false, error: { code: 'cancelled', message: 'cancelled' } });
      },
    };
  }

  /** The channels called, in order. */
  channels(): string[] {
    return this.calls.map((c) => c.channel);
  }
}

export function installBridge(bridge: FakeBridge): void {
  Object.defineProperty(window, 'tutor', { value: bridge, configurable: true });
}
