/**
 * Typed access to the main process through the preload's `window.tutor`
 * bridge. Unwraps `IpcResult` envelopes: failures become `IpcError`s.
 */
import type {
  InvokeChannel,
  InvokeRequest,
  InvokeResponse,
  IpcErrorCode,
  IpcResult,
  StreamChannel,
  StreamEvent,
  StreamRequest,
  StreamResult,
} from '../../shared/ipc';

export class IpcError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string,
    /** For code `refused`: why, e.g. `busy`, `locked`, `not_onboarded`. */
    readonly reason?: string,
  ) {
    super(message);
    this.name = 'IpcError';
  }
}

function unwrap<T>(r: IpcResult<T>): T {
  if (r.ok) return r.value;
  throw new IpcError(r.error.code, r.error.message, r.error.reason);
}

/** True if `err` is a refusal with this reason. */
export function isRefusal(err: unknown, reason: string): boolean {
  return err instanceof IpcError && err.code === 'refused' && err.reason === reason;
}

export async function invoke<C extends InvokeChannel>(
  channel: C,
  ...[request]: undefined extends InvokeRequest<C>
    ? [request?: InvokeRequest<C>]
    : [request: InvokeRequest<C>]
): Promise<InvokeResponse<C>> {
  return unwrap(await window.tutor.invoke(channel, request as InvokeRequest<C>));
}

export interface Stream<R> {
  /** Resolves with the result; rejects with an `IpcError` (code `cancelled` after `cancel()`). */
  result: Promise<R>;
  cancel(): void;
}

export function stream<C extends StreamChannel>(
  channel: C,
  request: StreamRequest<C>,
  onEvent: (event: StreamEvent<C>) => void,
): Stream<StreamResult<C>> {
  const handle = window.tutor.stream(channel, request, onEvent);
  return { result: handle.result.then(unwrap), cancel: () => handle.cancel() };
}
