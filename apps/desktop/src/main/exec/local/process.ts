/**
 * Child processes for the local toolchain executor (SPEC §6.4): spawn with
 * stdin, collect stdout/stderr, and kill the whole process tree on timeout,
 * cancellation or too much output. POSIX: the child leads its own process
 * group and the group gets SIGKILL. Windows: `taskkill /T /F` on the child's
 * pid (the tree).
 */
import { spawn, spawnSync } from 'node:child_process';
import type { CancelSignal } from '@algorithm-tutor/core';

export interface ProcessOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  input?: string;
  /** Kill after this long (ms) unless `onStdout` re-arms it with `extend`. */
  timeoutMs: number;
  signal?: CancelSignal | undefined;
  /** Kill once stdout + stderr pass this many characters. */
  maxOutput?: number;
  /**
   * Called with all of stdout so far after each chunk. Returning a number
   * re-arms the kill timer with that many ms from now.
   */
  onStdout?: (stdout: string) => number | undefined;
  platform?: NodeJS.Platform;
}

export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
  /** Killed for printing more than `maxOutput`. */
  overflowed: boolean;
  /** The program could not start (e.g. not found). */
  spawnError?: string;
}

const DEFAULT_MAX_OUTPUT = 32 * 1024 * 1024;

export function runProcess(cmd: readonly string[], opts: ProcessOptions): Promise<ProcessResult> {
  const platform = opts.platform ?? process.platform;
  const windows = platform === 'win32';
  const maxOutput = opts.maxOutput ?? DEFAULT_MAX_OUTPUT;
  return new Promise((resolve) => {
    const result: ProcessResult = {
      code: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      cancelled: false,
      overflowed: false,
    };
    if (opts.signal?.aborted) {
      resolve({ ...result, cancelled: true });
      return;
    }
    const child = spawn(cmd[0]!, cmd.slice(1), {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: !windows,
      windowsHide: true,
    });
    let killed = false;
    const kill = (): void => {
      if (killed || child.pid === undefined) return;
      killed = true;
      killTree(child.pid, windows, () => child.kill('SIGKILL'));
    };
    let timer: NodeJS.Timeout | undefined;
    const arm = (ms: number): void => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        result.timedOut = true;
        kill();
      }, ms);
    };
    arm(opts.timeoutMs);
    const onAbort = (): void => {
      result.cancelled = true;
      kill();
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    const tooMuch = (): boolean => result.stdout.length + result.stderr.length > maxOutput;
    child.stdout.setEncoding('utf8').on('data', (d: string) => {
      if (killed) return;
      result.stdout += d;
      if (tooMuch()) {
        result.overflowed = true;
        kill();
        return;
      }
      const extend = opts.onStdout?.(result.stdout);
      if (extend !== undefined) arm(extend);
    });
    child.stderr.setEncoding('utf8').on('data', (d: string) => {
      if (killed) return;
      result.stderr += d;
      if (tooMuch()) {
        result.overflowed = true;
        kill();
      }
    });
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };
    child.on('error', (e) => {
      result.spawnError = e.message;
      finish();
    });
    child.on('close', (code) => {
      result.code = code;
      // Anything the program left behind in its group goes too.
      if (!windows && child.pid !== undefined && !killed) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // the group is already gone
        }
      }
      finish();
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(opts.input ?? '');
  });
}

function killTree(pid: number, windows: boolean, fallback: () => void): void {
  if (windows) {
    const r = spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    if (r.status !== 0) fallback();
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    fallback();
  }
}
