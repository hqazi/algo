/**
 * Runs harness requests in single-use Pyodide workers (SPEC §6.2).
 *
 * - Every job gets a fresh worker; it is terminated when the job ends, so
 *   nothing a solution does survives into the next job.
 * - Spare workers (one by default) are started ahead ("warm"): taking one
 *   starts its replacement, so a job only pays Pyodide's start-up when the
 *   previous job came less than a start-up ago.
 * - Each test has a kill timer (`timeLimitMs` + a grace for conversions and
 *   messaging). On timeout the worker is terminated, the test is marked
 *   `timeout`, and a new worker resumes from the next test.
 * - Jobs run one at a time.
 *
 * Workers come from an injected factory, so the same logic runs on Web
 * Workers in the execution host and on Node worker threads in tests.
 */
import type {
  HarnessCaseResult,
  HarnessOutput,
  HarnessRequest,
  RuntimeVersions,
  WorkerMessage,
  WorkerRunMessage,
} from './protocol';

export interface WorkerHandle {
  post(msg: WorkerRunMessage): void;
  /** Called with every message, and once with an error if the worker dies. */
  listen(onMessage: (m: WorkerMessage) => void, onError: (message: string) => void): void;
  terminate(): void;
}

export type WorkerFactory = () => WorkerHandle;

export interface PoolOptions {
  /** How long a worker may take to start Pyodide. */
  startupTimeoutMs?: number;
  /** Added to each test's limit before the worker is killed. */
  graceMs?: number;
  /** Started workers kept ready between jobs (default 1; 0 starts each on demand). */
  spares?: number;
}

export interface CancelToken {
  readonly cancelled: boolean;
  onCancel(cb: () => void): void;
}

type Started = { ok: true; worker: LiveWorker } | { ok: false; message: string };

/** A worker plus a queue of its messages, so nothing is missed between steps. */
class LiveWorker {
  versions: RuntimeVersions | undefined;
  private queue: (WorkerMessage | { type: 'died'; message: string })[] = [];
  private waiter: (() => void) | undefined;
  private dead = false;

  constructor(readonly handle: WorkerHandle) {
    handle.listen(
      (m) => this.push(m),
      (message) => {
        if (!this.dead) this.push({ type: 'died', message });
        this.dead = true;
      },
    );
  }

  private push(m: WorkerMessage | { type: 'died'; message: string }): void {
    this.queue.push(m);
    const w = this.waiter;
    this.waiter = undefined;
    w?.();
  }

  /** The next message, or `null` after `ms`. */
  async next(ms: number): Promise<WorkerMessage | { type: 'died'; message: string } | null> {
    if (this.queue.length) return this.queue.shift()!;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arrived = await new Promise<boolean>((resolve) => {
      this.waiter = () => resolve(true);
      timer = setTimeout(() => resolve(false), ms);
    });
    clearTimeout(timer);
    this.waiter = undefined;
    return arrived ? (this.queue.shift() ?? null) : null;
  }

  /** Wake a pending `next` so it can notice a cancellation. */
  interrupt(): void {
    const w = this.waiter;
    this.waiter = undefined;
    w?.();
  }

  kill(): void {
    this.dead = true;
    this.handle.terminate();
  }
}

export class PyodidePool {
  private readonly startupTimeoutMs: number;
  private readonly graceMs: number;
  private readonly spares: number;
  private ready: Promise<Started>[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(
    private readonly factory: WorkerFactory,
    options: PoolOptions = {},
  ) {
    this.startupTimeoutMs = options.startupTimeoutMs ?? 60_000;
    this.graceMs = options.graceMs ?? 250;
    this.spares = Math.max(0, options.spares ?? 1);
  }

  /** Start spare workers until `spares` are running or ready. */
  warm(): void {
    while (!this.disposed && this.ready.length < this.spares) this.ready.push(this.start());
  }

  /** Whether Pyodide starts, and its versions. Uses (and keeps) the spare. */
  async status(): Promise<
    { available: true; versions: RuntimeVersions } | { available: false; reason: string }
  > {
    const pending = this.ready[0] ?? this.start();
    if (!this.ready.length) this.ready.push(pending);
    const started = await pending;
    if (!started.ok) {
      this.ready = this.ready.filter((p) => p !== pending);
      return { available: false, reason: started.message };
    }
    return { available: true, versions: started.worker.versions! };
  }

  run(request: HarnessRequest, cancel?: CancelToken): Promise<HarnessOutput> {
    const result = this.chain.then(() => this.runNow(request, cancel));
    this.chain = result.catch(() => undefined);
    return result;
  }

  dispose(): void {
    this.disposed = true;
    for (const p of this.ready) void p.then((s) => s.ok && s.worker.kill());
    this.ready = [];
  }

  private start(): Promise<Started> {
    let worker: LiveWorker;
    try {
      worker = new LiveWorker(this.factory());
    } catch (e) {
      return Promise.resolve({ ok: false, message: `could not start a worker: ${String(e)}` });
    }
    return (async (): Promise<Started> => {
      const m = await worker.next(this.startupTimeoutMs);
      if (m?.type === 'ready') {
        worker.versions = m.versions;
        return { ok: true, worker };
      }
      worker.kill();
      if (m === null) return { ok: false, message: 'Python (Pyodide) did not start in time' };
      if (m.type === 'fatal' || m.type === 'died')
        return { ok: false, message: `Python (Pyodide) did not start: ${m.message}` };
      return { ok: false, message: `unexpected message from the worker: ${m.type}` };
    })();
  }

  private take(): Promise<Started> {
    const s = this.ready.shift() ?? this.start();
    this.warm();
    return s;
  }

  private async runNow(request: HarnessRequest, cancel?: CancelToken): Promise<HarnessOutput> {
    const n = request.inputs.length;
    const cases: (HarnessCaseResult | undefined)[] = new Array<undefined>(n).fill(undefined);
    const limit = request.timeLimitMs + this.graceMs;
    const cancelled = (): HarnessOutput => ({
      kind: 'failed',
      error: { kind: 'cancelled', message: 'the run was cancelled' },
      cases: cases.map((c) => c ?? { status: 'skipped' }),
    });
    let current: LiveWorker | undefined;
    cancel?.onCancel(() => current?.interrupt());

    try {
      let start = 0;
      while (start < n || (n === 0 && start === 0)) {
        if (cancel?.cancelled) return cancelled();
        const started = await this.take();
        if (cancel?.cancelled) {
          if (started.ok) started.worker.kill();
          return cancelled();
        }
        if (!started.ok) {
          return {
            kind: 'failed',
            error: { kind: 'runtime-missing', message: started.message },
            cases: start > 0 ? cases.map((c) => c ?? { status: 'skipped' }) : undefined,
          };
        }
        current = started.worker;
        const w = current;
        w.handle.post({ type: 'run', request, start });

        let index: number | undefined; // the test now running; undefined while loading
        let resumeAt = n;
        for (;;) {
          const m = await w.next(limit);
          if (cancel?.cancelled) {
            w.kill();
            return cancelled();
          }
          if (m === null) {
            w.kill();
            if (index === undefined) {
              return {
                kind: 'load-error',
                errorType: 'TimeoutError',
                message: `loading the solution took longer than ${request.timeLimitMs} ms`,
              };
            }
            if (index < n) cases[index] = { status: 'timeout' };
            resumeAt = index + 1;
            break;
          }
          if (m.type === 'loaded') {
            index = start;
            continue;
          }
          if (m.type === 'begin') {
            index = m.index;
            continue;
          }
          if (m.type === 'result') {
            cases[m.index] = m.result;
            index = m.index + 1;
            continue;
          }
          if (m.type === 'load-error') {
            w.kill();
            return {
              kind: 'load-error',
              errorType: m.errorType,
              message: m.message,
              line: m.line,
              stdout: m.stdout,
              stdoutDropped: m.stdoutDropped,
            };
          }
          if (m.type === 'done') {
            w.kill();
            break;
          }
          // The runtime crashed (or posted something it should not have).
          w.kill();
          const why =
            m.type === 'fatal' || m.type === 'died' ? m.message : `unexpected message ${m.type}`;
          if (index === undefined || index >= n) {
            return {
              kind: 'failed',
              error: { kind: 'harness', message: `the Python runtime failed: ${why}` },
              cases: cases.map((c) => c ?? { status: 'skipped' }),
            };
          }
          cases[index] = {
            status: 'error',
            errorType: 'RuntimeCrash',
            message: `the Python runtime crashed: ${why}`,
            stdout: '',
          };
          resumeAt = index + 1;
          break;
        }
        current = undefined;
        if (resumeAt >= n) break;
        start = resumeAt;
      }
      return { kind: 'ran', cases: cases.map((c) => c ?? { status: 'skipped' }) };
    } finally {
      current?.kill();
      this.warm();
    }
  }
}
