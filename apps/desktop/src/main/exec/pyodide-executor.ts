/**
 * The Pyodide executor (SPEC §6.1, §6.2), main-process side.
 *
 * Turns a `RunJob` into a `HarnessRequest` (inputs only), sends it to the
 * execution host through a transport, and grades the answer in core. The
 * report it returns still holds hidden tests' data: callers that pass it to
 * the renderer or the tutor must `redactReport` it first (the IPC handlers in
 * T08 do).
 */
import {
  gradeRun,
  toHarnessRequest,
  type CancelSignal,
  type Executor,
  type ExecutorStatus,
  type HarnessOutput,
  type HarnessRequest,
  type RunJob,
  type RunReport,
} from '@algorithm-tutor/core';

/** How the executor reaches the execution host. */
export interface HarnessTransport {
  run(request: HarnessRequest, signal?: CancelSignal): Promise<HarnessOutput>;
  status(): Promise<ExecutorStatus>;
}

export class PyodideExecutor implements Executor {
  readonly id = 'pyodide' as const;

  constructor(
    private readonly transport: HarnessTransport,
    private readonly now: () => number = () => performance.now(),
  ) {}

  status(): Promise<ExecutorStatus> {
    return this.transport.status().catch((e: unknown) => ({
      available: false,
      reason: `the execution host failed: ${errorText(e)}`,
    }));
  }

  async run(job: RunJob, signal?: CancelSignal): Promise<RunReport> {
    const t0 = this.now();
    const done = (output: HarnessOutput): RunReport =>
      gradeRun(job, output, Math.round(this.now() - t0));
    if (job.language !== 'python') {
      return done({
        kind: 'failed',
        error: {
          kind: 'runtime-missing',
          message: `the Pyodide executor runs Python, not ${job.language}`,
        },
      });
    }
    if (signal?.aborted) {
      return done({
        kind: 'failed',
        error: { kind: 'cancelled', message: 'the run was cancelled' },
      });
    }
    let output: HarnessOutput;
    try {
      output = await this.transport.run(toHarnessRequest(job), signal);
    } catch (e) {
      output = { kind: 'failed', error: { kind: 'harness', message: errorText(e) } };
    }
    return done(output);
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
