/**
 * Runs a built Rust/Go harness over a job's tests (SPEC §6.4), shared by the
 * local and container executors. One process runs all remaining tests; each
 * test gets its limit from the previous result line; past it the process is
 * killed, that test is `timeout`, and a fresh process runs the rest (a crash
 * continues the same way).
 */
import {
  encodeHarnessInput,
  newNonce,
  parseHarnessStream,
  RECORD_MARK,
  type CancelSignal,
  type HarnessCaseResult,
  type HarnessOutput,
} from '@algo/core';
import type { ProcessResult } from './process';

export interface BatchRun {
  input: string;
  /** Kill after this long unless `onStdout` re-arms it. */
  timeoutMs: number;
  onStdout: (stdout: string) => number | undefined;
  signal?: CancelSignal | undefined;
}

export interface BatchOptions {
  inputs: readonly string[];
  /** Per test, kill slack included. */
  perTestMs: number;
  /** Time for a process to start before its first test. */
  startupMs: number;
  signal?: CancelSignal | undefined;
  /** Starts one harness process with `run.input` on stdin. */
  spawn: (run: BatchRun, index: number) => Promise<ProcessResult>;
  onSpawn?: (tests: number) => void;
}

export async function runHarnessBatches(opts: BatchOptions): Promise<HarnessOutput> {
  const { inputs, perTestMs, signal } = opts;
  const cases: HarnessCaseResult[] = [];
  let index = 0;
  while (cases.length < inputs.length) {
    const batch = inputs.slice(cases.length);
    const nonce = newNonce();
    const mark = `${RECORD_MARK}${nonce} `;
    let records = 0;
    let scanned = 0;
    opts.onSpawn?.(batch.length);
    const r = await opts.spawn(
      {
        input: encodeHarnessInput(nonce, batch),
        timeoutMs: opts.startupMs + perTestMs,
        signal,
        // Each result line gives the next test its full limit.
        onStdout: (out) => {
          const before = records;
          for (;;) {
            const at = out.indexOf(mark, scanned);
            if (at < 0) {
              // A mark cut in half by the chunk boundary is found next time.
              scanned = Math.max(scanned, out.length - mark.length + 1);
              break;
            }
            if (out.indexOf('\n', at) < 0) {
              scanned = at;
              break;
            }
            records += 1;
            scanned = at + mark.length;
          }
          return records > before ? perTestMs : undefined;
        },
      },
      index++,
    );
    if (r.spawnError) return harnessError(`the harness could not start: ${r.spawnError}`, cases);
    const stderr = r.overflowed
      ? `${r.stderr}\nprinted more output than the app keeps (32 MB)`
      : r.stderr;
    const parsed = parseHarnessStream(
      r.stdout,
      nonce,
      batch.length,
      r.timedOut ? { kind: 'timeout' } : { kind: 'exited', code: r.code, stderr },
    );
    if (r.cancelled) {
      const done = parsed.kind === 'ran' || parsed.kind === 'failed' ? (parsed.cases ?? []) : [];
      return cancelled([...cases, ...done.slice(0, records)]);
    }
    if (parsed.kind !== 'ran') {
      return parsed.kind === 'failed'
        ? { ...parsed, cases: [...cases, ...(parsed.cases ?? [])] }
        : parsed;
    }
    const skipped = parsed.cases.findIndex((c) => c.status === 'skipped');
    cases.push(...(skipped < 0 ? parsed.cases : parsed.cases.slice(0, skipped)));
    if (skipped === 0) return harnessError('the harness stopped without running a test', cases);
  }
  return { kind: 'ran', cases };
}

export function missing(message: string): HarnessOutput {
  return { kind: 'failed', error: { kind: 'runtime-missing', message } };
}

export function cancelled(cases: HarnessCaseResult[]): HarnessOutput {
  return { kind: 'failed', error: { kind: 'cancelled', message: 'the run was cancelled' }, cases };
}

export function harnessError(message: string, cases: HarnessCaseResult[] = []): HarnessOutput {
  return { kind: 'failed', error: { kind: 'harness', message }, cases };
}
