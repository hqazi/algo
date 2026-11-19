/**
 * What the compiled-language harnesses (Rust, Go; SPEC §6.4) share: the
 * project shape a generator returns, the stdin/stdout protocol, and the
 * parser that turns a harness's stdout into `HarnessOutput`.
 *
 * Protocol (DECISIONS D-29):
 *
 * - stdin: a header line `{"nonce":"<hex>"}`, then one JSON object per test,
 *   `{ name: value }` (the `inputs` of a `HarnessRequest`). The harness reads
 *   all of stdin before running anything, so a solution cannot read the nonce.
 * - stdout: whatever the solution prints, and after each test a record line
 *   `\x1e<nonce> {...}\n`. Text printed between two records is the test's
 *   stdout. Records:
 *     {"status":"ok","actual":<value>,"time_ms":t}
 *     {"status":"error","error_type":"panic","message":"…","line":n,"time_ms":t}
 *     {"status":"fatal","message":"…"}    the harness itself failed
 */
import type { HarnessCaseResult, HarnessOutput } from '../exec/harness';
import { parseJson, stringifyJson, type JsonValue } from '../types/json';
import { parseType, someType, type NeutralType, type ScalarKind } from '../types/neutral';
import type { Signature } from '../types/signature';

/** Record separator that starts every result line. */
export const RECORD_MARK = '\x1e';

export interface ProjectFile {
  /** Path inside the project folder, `/`-separated. */
  path: string;
  content: string;
}

/**
 * A harness project for one signature. The executor writes `files`, copies
 * each of `runtimeFiles` from `content/runners/<language>/` (unchanged), and
 * writes the user's code to `solutionPath`; then runs `build`, and `run` with
 * the protocol input on stdin. Commands run in the project folder; `run[0]`
 * is relative to it (add `.exe` on Windows).
 */
export interface HarnessProject {
  language: 'rust' | 'go';
  files: ProjectFile[];
  runtimeFiles: { from: string; path: string }[];
  solutionPath: string;
  build: string[];
  run: string[];
}

export interface StubOptions {
  /** Comment lines above the code (title, instructions). */
  header?: readonly string[];
}

/** snake_case → lowerCamelCase (`level_lists` → `levelLists`). */
export function camelCase(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** All neutral types in a signature (parameters, then the return type). */
export function signatureTypes(sig: Signature): NeutralType[] {
  return [...sig.params.map((p) => p.type), sig.returns].map(parseType);
}

/**
 * The element type of every `tree` (or `linked_list`) in the signature, or
 * `null` if there is none. Throws if two differ: Rust and Go have one node
 * type per harness.
 */
export function nodeElement(sig: Signature, kind: 'tree' | 'linked_list'): ScalarKind | null {
  const found = new Set<ScalarKind>();
  for (const t of signatureTypes(sig)) {
    someType(t, (x) => {
      if (x.kind === kind) found.add(x.of.kind);
      return false;
    });
  }
  if (found.size > 1) {
    throw new Error(`${kind} element types differ (${[...found].join(', ')})`);
  }
  return found.size ? [...found][0]! : null;
}

/** Why a compiled-language harness cannot run `sig`, or `null` if it can. */
export function compiledHarnessLimit(sig: Signature): string | null {
  for (const kind of ['tree', 'linked_list'] as const) {
    try {
      nodeElement(sig, kind);
    } catch (e) {
      return (e as Error).message;
    }
  }
  return null;
}

/** A fresh nonce for one run (hex, 32 characters). */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  // Web Crypto: in Node 22, Electron and browsers alike (core has no DOM types).
  const { crypto } = globalThis as unknown as {
    crypto: { getRandomValues(array: Uint8Array): Uint8Array };
  };
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The harness's stdin: the header line, then one input object per test. */
export function encodeHarnessInput(nonce: string, inputs: readonly string[]): string {
  return [JSON.stringify({ nonce }), ...inputs].map((l) => `${l}\n`).join('');
}

/** How the harness process ended, as the executor saw it. */
export type HarnessEnding =
  { kind: 'exited'; code: number | null; stderr?: string | undefined } | { kind: 'timeout' };

/**
 * Turn a harness's whole stdout into `HarnessOutput`: one case per record,
 * then, if records are missing, the test that was running gets `timeout`
 * (when the executor killed it) or a `crash` error (the process died), and
 * the rest are skipped.
 */
export function parseHarnessStream(
  stdout: string,
  nonce: string,
  testCount: number,
  ending: HarnessEnding,
): HarnessOutput {
  const mark = `${RECORD_MARK}${nonce} `;
  const cases: HarnessCaseResult[] = [];
  let pos = 0;
  while (cases.length < testCount) {
    const at = stdout.indexOf(mark, pos);
    if (at < 0) break;
    const end = stdout.indexOf('\n', at);
    if (end < 0) break;
    const printed = stdout.slice(pos, at);
    const recordText = stdout.slice(at + mark.length, end);
    pos = end + 1;
    let record: Record<string, JsonValue>;
    try {
      const parsed = parseJson(recordText);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      record = parsed as Record<string, JsonValue>;
    } catch {
      return failed(`unreadable result line from the harness: ${recordText.slice(0, 200)}`, cases);
    }
    const status = record.status;
    const timeMs = typeof record.time_ms === 'number' ? record.time_ms : undefined;
    if (status === 'ok' && 'actual' in record) {
      cases.push({
        status: 'ok',
        actualJson: stringifyJson(record.actual),
        timeMs: timeMs ?? 0,
        stdout: printed,
      });
    } else if (status === 'error') {
      const line = record.line;
      cases.push({
        status: 'error',
        errorType: String(record.error_type ?? 'error'),
        message: String(record.message ?? ''),
        line: typeof line === 'number' ? line : typeof line === 'bigint' ? Number(line) : undefined,
        timeMs,
        stdout: printed,
      });
    } else if (status === 'fatal') {
      return failed(`the harness failed: ${String(record.message ?? '')}`, cases);
    } else {
      return failed(`unexpected result line from the harness: ${recordText.slice(0, 200)}`, cases);
    }
  }
  if (cases.length < testCount) {
    const rest = stdout.slice(pos);
    if (ending.kind === 'timeout') {
      cases.push({ status: 'timeout', stdout: rest });
    } else {
      const stderr = (ending.stderr ?? '').trim();
      const why = crashMessage(stderr, ending.code);
      cases.push({ status: 'error', errorType: 'crash', message: why, stdout: rest });
    }
    while (cases.length < testCount) cases.push({ status: 'skipped' });
  }
  return { kind: 'ran', cases };
}

function failed(message: string, cases: HarnessCaseResult[]): HarnessOutput {
  return { kind: 'failed', error: { kind: 'harness', message }, cases };
}

/** A short reason for a process that died mid-test. */
function crashMessage(stderr: string, code: number | null): string {
  if (/overflow(ed)? (its|the) stack|stack overflow|goroutine stack exceeds/i.test(stderr)) {
    return 'stack overflow (recursion too deep?)';
  }
  const tail = stderr.split('\n').filter(Boolean).slice(-3).join('\n');
  const how = code === null ? 'was killed' : `exited with code ${code}`;
  return tail ? `the program ${how}: ${tail}` : `the program ${how}`;
}
