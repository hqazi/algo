/** A `HarnessTransport` that runs requests on a `PyodidePool` in the same process. */
import type {
  CancelSignal,
  ExecutorStatus,
  HarnessOutput,
  HarnessRequest,
} from '@algorithm-tutor/core';
import type { CancelToken, PyodidePool } from './pool';

export function cancelToken(signal?: CancelSignal): CancelToken | undefined {
  if (!signal) return undefined;
  return {
    get cancelled() {
      return signal.aborted;
    },
    onCancel(cb) {
      signal.addEventListener('abort', cb, { once: true });
    },
  };
}

export function poolTransport(pool: PyodidePool): {
  run(request: HarnessRequest, signal?: CancelSignal): Promise<HarnessOutput>;
  status(): Promise<ExecutorStatus>;
} {
  return {
    run: (request, signal) => pool.run(request, cancelToken(signal)),
    async status() {
      const s = await pool.status();
      return s.available
        ? { available: true, versions: { pyodide: s.versions.pyodide, python: s.versions.python } }
        : { available: false, reason: s.reason };
    },
  };
}
