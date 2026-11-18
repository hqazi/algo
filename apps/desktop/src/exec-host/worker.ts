/**
 * One Pyodide worker (SPEC §6.2): starts Pyodide from the app's bundled files,
 * removes the network APIs from its global scope, then runs one job and is
 * terminated by the host.
 */
import harnessSource from '../../../../content/runners/python/harness.py?raw';
import type { WorkerMessage, WorkerRunMessage } from './protocol';
import { startPython, type LoadPyodide } from './runtime';

interface Scope {
  postMessage(m: WorkerMessage): void;
  onmessage: ((e: { data: WorkerRunMessage }) => void) | null;
  location: { href: string };
}

const scope = globalThis as unknown as Scope;
const post = scope.postMessage.bind(scope);

// Everything a worker could use to reach the network, storage or other
// contexts. Python cannot reach the global scope (`jsglobals: {}`); this is a
// second layer under the CSP and the session's request blocking.
const REMOVED = [
  'fetch',
  'Request',
  'XMLHttpRequest',
  'WebSocket',
  'WebSocketStream',
  'WebTransport',
  'EventSource',
  'importScripts',
  'indexedDB',
  'caches',
  'cookieStore',
  'BroadcastChannel',
  'Worker',
  'SharedWorker',
  'RTCPeerConnection',
  'RTCDataChannel',
] as const;

function removeNetworkApis(): void {
  for (
    let obj: object | null = globalThis;
    obj;
    obj = Object.getPrototypeOf(obj) as object | null
  ) {
    for (const name of REMOVED) {
      if (!Object.prototype.hasOwnProperty.call(obj, name) && obj !== globalThis) continue;
      try {
        Object.defineProperty(obj, name, {
          value: undefined,
          writable: false,
          configurable: false,
        });
      } catch {
        // Not configurable here; shadowed on the global object instead.
      }
    }
  }
}

async function main(): Promise<void> {
  const base = new URL('/pyodide/', scope.location.href).href;
  const mod = (await import(/* @vite-ignore */ `${base}pyodide.mjs`)) as {
    loadPyodide: LoadPyodide;
  };
  const runtime = await startPython(mod.loadPyodide, harnessSource, { indexURL: base });
  removeNetworkApis();
  scope.onmessage = (e) => {
    scope.onmessage = null; // one job per worker
    try {
      runtime.run(e.data, post);
    } catch (err) {
      post({ type: 'fatal', message: String(err) });
    }
  };
  post({ type: 'ready', versions: runtime.versions });
}

main().catch((err: unknown) => post({ type: 'fatal', message: String(err) }));
