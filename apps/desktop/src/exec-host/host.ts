/**
 * The execution host page (SPEC §6.2): a hidden, sandboxed window with no
 * network. It receives a MessagePort from the main process (through
 * `preload.ts`), runs each request in fresh Pyodide workers and answers with
 * the raw harness output. It never sees expected values.
 */
import { PyodidePool, type CancelToken, type WorkerHandle } from './pool';
import type { HostToMain, MainToHost, WorkerMessage } from './protocol';

function webWorker(): WorkerHandle {
  const w = new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
    name: 'pyodide',
  });
  return {
    post: (msg) => w.postMessage(msg),
    listen(onMessage, onError) {
      w.onmessage = (e: MessageEvent<WorkerMessage>) => onMessage(e.data);
      w.onerror = (e) => {
        e.preventDefault();
        onError(e.message || 'the worker failed');
      };
      w.onmessageerror = () => onError('a worker message could not be read');
    },
    terminate: () => w.terminate(),
  };
}

const pool = new PyodidePool(webWorker);
const cancels = new Map<number, () => void>();

function token(id: number): CancelToken {
  let cancelled = false;
  const callbacks: (() => void)[] = [];
  cancels.set(id, () => {
    cancelled = true;
    for (const cb of callbacks) cb();
  });
  return {
    get cancelled() {
      return cancelled;
    },
    onCancel: (cb) => void callbacks.push(cb),
  };
}

function serve(port: MessagePort): void {
  const send = (m: HostToMain): void => port.postMessage(m);
  port.onmessage = (e: MessageEvent<MainToHost>) => {
    const msg = e.data;
    if (msg.type === 'run') {
      void pool
        .run(msg.request, token(msg.id))
        .catch(
          (err: unknown) =>
            ({
              kind: 'failed',
              error: { kind: 'harness', message: String(err) },
            }) as const,
        )
        .then((output) => {
          cancels.delete(msg.id);
          send({ type: 'output', id: msg.id, output });
        });
    } else if (msg.type === 'cancel') {
      cancels.get(msg.id)?.();
    } else if (msg.type === 'status') {
      void pool
        .status()
        .then((s) =>
          send(
            s.available
              ? { type: 'status', id: msg.id, available: true, versions: s.versions }
              : { type: 'status', id: msg.id, available: false, reason: s.reason },
          ),
        );
    }
  };
  send({ type: 'hello' });
}

let connected = false;
window.addEventListener('message', (e) => {
  if (connected || e.source !== window || e.data !== 'exec-host:port' || !e.ports[0]) return;
  connected = true;
  serve(e.ports[0]);
});

pool.warm();
