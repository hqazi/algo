/** Test-only: a `WorkerFactory` backed by Node worker threads. */
import { Worker } from 'node:worker_threads';
import type { WorkerFactory } from '../pool';
import type { WorkerMessage } from '../protocol';

const WORKER = new URL('./node-worker.ts', import.meta.url);

export const nodeWorkerFactory: WorkerFactory = () => {
  const worker = new Worker(WORKER, { execArgv: ['--import', 'tsx'] });
  let onError: ((message: string) => void) | undefined;
  let exited = false;
  worker.on('error', (e) => onError?.(String(e)));
  worker.on('exit', (code) => {
    exited = true;
    onError?.(`worker exited (code ${code})`);
  });
  return {
    post: (msg) => worker.postMessage(msg),
    listen(onMessage, err) {
      onError = err;
      worker.on('message', (m: WorkerMessage) => onMessage(m));
    },
    terminate: () => {
      if (!exited) void worker.terminate();
    },
  };
};
