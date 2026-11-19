/**
 * Handlers for the channels in `shared/ipc.ts`. Later tickets add theirs
 * here (or in a sibling module registered from `registerHandlers`).
 */
import type { IpcRouter } from '../router';

export interface AppInfo {
  version: string;
  versions: { electron: string; chrome: string; node: string };
}

/** Resolves after `ms`, or rejects when `signal` aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('cancelled'));
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('cancelled'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function registerHandlers(router: IpcRouter, info: AppInfo): void {
  router.handle('app:version', () => ({ app: info.version, ...info.versions }));

  router.handleStream('example:count', async ({ to, intervalMs }, { signal, emit }) => {
    let n = 0;
    while (n < to) {
      await sleep(intervalMs, signal);
      n += 1;
      emit({ n });
    }
    return { counted: n };
  });
}
