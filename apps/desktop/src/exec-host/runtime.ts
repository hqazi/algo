/**
 * Pyodide inside one worker: start it locked down, load the harness, run a job.
 *
 * Shared by the browser worker (`worker.ts`) and the Node test worker
 * (`testing/node-worker.ts`), so tests exercise the same code with the same
 * Pyodide. Nothing here touches the DOM or Node.
 *
 * Lock-down (DECISIONS D-14):
 * - `jsglobals: {}`: Python's `js` module is an empty object, so `js.fetch`,
 *   `js.eval` and `pyodide.code.run_js` reach nothing.
 * - `loadPackage`, `loadPackagesFromImports` and the file-system mounts throw.
 * - The harness blocks importing `micropip`, `pyodide_js`, `pyodide.http`,
 *   `pyodide.code` and `pyodide.webloop`, and stdin is empty.
 * The browser worker also removes the network APIs from its global scope.
 */
import type {
  HarnessCaseResult,
  RuntimeVersions,
  WorkerMessage,
  WorkerRunMessage,
} from './protocol';

/** The part of the Pyodide API used here. */
export interface PyodideLike {
  version: string;
  runPython(code: string, options?: { globals?: unknown; filename?: string }): unknown;
  globals: { get(name: string): unknown };
  toPy(value: unknown): unknown;
  [key: string]: unknown;
}

export type LoadPyodide = (options: Record<string, unknown>) => Promise<PyodideLike>;

interface HarnessProxy {
  load(code: string): string;
  run(inputJson: string): string;
}

type MakeHarness = (specJson: string) => HarnessProxy;

const DISABLED = [
  'loadPackage',
  'loadPackagesFromImports',
  'mountNativeFS',
  'mountNodeFS',
  'unpackArchive',
] as const;

export interface PythonRuntime {
  versions: RuntimeVersions;
  /** Run `msg.request` from test `msg.start`, reporting each step through `emit`. */
  run(msg: WorkerRunMessage, emit: (m: WorkerMessage) => void): void;
}

export async function startPython(
  loadPyodide: LoadPyodide,
  harnessSource: string,
  options: { indexURL?: string } = {},
): Promise<PythonRuntime> {
  const py = await loadPyodide({
    ...(options.indexURL ? { indexURL: options.indexURL } : {}),
    jsglobals: {},
    packages: [],
    env: { HOME: '/home/pyodide' },
    // Solutions' output is captured by the harness; anything else is dropped.
    stdout: () => {},
    stderr: () => {},
  });
  for (const name of DISABLED) {
    py[name] = () => {
      throw new Error(`${name} is disabled in the execution host`);
    };
  }
  const ns = py.runPython('dict()');
  py.runPython(harnessSource, { globals: ns, filename: 'harness.py' });
  const get = (ns as { get(name: string): unknown }).get.bind(ns);
  (get('install_guards') as () => void)();
  const makeHarness = get('make_harness') as MakeHarness;
  const python = String(py.runPython('import sys; sys.version.split()[0]'));

  return {
    versions: { pyodide: py.version, python },
    run(msg, emit) {
      const { request, start } = msg;
      const harness = makeHarness(
        JSON.stringify({
          function: request.function,
          params: request.params,
          returns: request.returns,
        }),
      );
      const loaded = JSON.parse(harness.load(request.code)) as {
        ok: boolean;
        error_type?: string;
        message?: string;
        line?: number | null;
        stdout?: string;
        stdout_dropped?: number;
      };
      if (!loaded.ok) {
        emit({
          type: 'load-error',
          errorType: loaded.error_type ?? 'Error',
          message: loaded.message ?? '',
          line: loaded.line ?? undefined,
          stdout: loaded.stdout || undefined,
          stdoutDropped: loaded.stdout_dropped || undefined,
        });
        return;
      }
      emit({ type: 'loaded' });
      for (let i = start; i < request.inputs.length; i++) {
        emit({ type: 'begin', index: i });
        emit({ type: 'result', index: i, result: toCaseResult(harness.run(request.inputs[i]!)) });
      }
      emit({ type: 'done' });
    },
  };
}

interface RawCase {
  status: 'ok' | 'error';
  actual_json?: string;
  time_ms?: number;
  error_type?: string;
  message?: string;
  line?: number | null;
  stdout?: string;
  stdout_dropped?: number;
}

function toCaseResult(text: string): HarnessCaseResult {
  const r = JSON.parse(text) as RawCase;
  const stdout = r.stdout ?? '';
  const stdoutDropped = r.stdout_dropped || undefined;
  if (r.status === 'ok') {
    return {
      status: 'ok',
      actualJson: r.actual_json!,
      timeMs: r.time_ms ?? 0,
      stdout,
      stdoutDropped,
    };
  }
  return {
    status: 'error',
    errorType: r.error_type ?? 'Error',
    message: r.message ?? '',
    line: r.line ?? undefined,
    timeMs: r.time_ms,
    stdout,
    stdoutDropped,
  };
}
