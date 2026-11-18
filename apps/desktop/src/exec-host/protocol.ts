/**
 * Messages inside the execution host (SPEC §6.2).
 *
 *   main process ──MessagePort── host page ──postMessage── worker (one per job)
 *
 * The host page receives a `HarnessRequest` (inputs only, never expected
 * values), runs it in fresh Pyodide workers and answers with a
 * `HarnessOutput`. Grading and redaction happen in the main process.
 */
import type { HarnessCaseResult, HarnessOutput, HarnessRequest } from '@algorithm-tutor/core';

export type { HarnessCaseResult, HarnessOutput, HarnessRequest };

/** Versions the worker reports once Pyodide has started. */
export interface RuntimeVersions {
  pyodide: string;
  python: string;
}

// ------------------------------------------------------------ host → worker

/** Run `request` starting at test `start` (after a timeout, the next worker resumes). */
export interface WorkerRunMessage {
  type: 'run';
  request: HarnessRequest;
  start: number;
}

// ------------------------------------------------------------ worker → host

export type WorkerMessage =
  | { type: 'ready'; versions: RuntimeVersions }
  | {
      type: 'load-error';
      errorType: string;
      message: string;
      line?: number | undefined;
      stdout?: string | undefined;
      stdoutDropped?: number | undefined;
    }
  | { type: 'loaded' }
  | { type: 'begin'; index: number }
  | { type: 'result'; index: number; result: HarnessCaseResult }
  | { type: 'done' }
  /** Pyodide failed to start or crashed. */
  | { type: 'fatal'; message: string };

// ------------------------------------------------------------ main ↔ host

export type MainToHost =
  | { type: 'run'; id: number; request: HarnessRequest }
  | { type: 'cancel'; id: number }
  | { type: 'status'; id: number };

export type HostToMain =
  | { type: 'output'; id: number; output: HarnessOutput }
  | {
      type: 'status';
      id: number;
      available: boolean;
      reason?: string | undefined;
      versions?: RuntimeVersions | undefined;
    };
