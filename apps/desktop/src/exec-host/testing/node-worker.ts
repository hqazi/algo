/**
 * Test-only: the execution host's worker on a Node worker thread, running the
 * same `runtime.ts` and harness with the same Pyodide package. Started by
 * `nodeWorkerFactory` through tsx.
 */
import { readFileSync } from 'node:fs';
import { parentPort } from 'node:worker_threads';
import { loadPyodide } from 'pyodide';
import type { WorkerMessage, WorkerRunMessage } from '../protocol';
import { startPython, type LoadPyodide } from '../runtime';
import { HARNESS_PATH } from './paths';

const port = parentPort!;
const emit = (m: WorkerMessage): void => port.postMessage(m);

try {
  const runtime = await startPython(
    loadPyodide as unknown as LoadPyodide,
    readFileSync(HARNESS_PATH, 'utf8'),
  );
  port.once('message', (msg: WorkerRunMessage) => {
    try {
      runtime.run(msg, emit);
    } catch (e) {
      emit({ type: 'fatal', message: String(e) });
    }
  });
  emit({ type: 'ready', versions: runtime.versions });
} catch (e) {
  emit({ type: 'fatal', message: String(e) });
}
