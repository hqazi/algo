/**
 * `FakeBackend`: replays scripted events and real tool calls (SPEC §7.3).
 * Used by tests and, with `ALGOTUTOR_FAKE_TUTOR=<script.json>`, for UI work
 * and the end-to-end test. It never contacts anything. Ported from
 * `dsa-tutor/dsa_tutor/backends/fake.py`.
 *
 * A script is a list of entries. An entry is either a list of steps, played
 * in order for the next turn (the plain lists are used in rotation), or
 * `{ "match": "<regex>", "steps": [...] }`, played whenever the user's text
 * matches (case-insensitive; checked first). Steps:
 *
 *   { "text": "..." }                            a text_delta
 *   { "tool": "run_tests", "input": {...} }      tool_start, the real tool call, tool_end, its UI events
 *   { "error": "rate_limit", "message": "..." }  an error event; ends the turn
 *   { "sleep": 500 }                             wait (ms; lets tests cancel mid-turn)
 *   { "state": {...} }                           merge into the backend state
 *   { "throw": "boom" }                          throw (tests the service's error path)
 *   { "stop": "end_turn" }                       the `done` stop value (default end_turn)
 *
 * A string input value `"$<tool>.<field>"` is replaced with that field of
 * the output of the most recent call to that tool in the same turn, e.g.
 * `{ "tool": "start_problem", "input": { "slug": "$next_problem.slug" } }`.
 * `turns` keeps every `Turn` received, for assertions.
 */
import type { JsonValue } from '../types/json';
import type { BackendStatus, SignalLike, Turn, TutorBackend } from './backend';
import {
  chatError,
  done,
  ERROR_KINDS,
  resultEvents,
  textDelta,
  toolStart,
  type ChatEvent,
  type ErrorKind,
} from './chat-events';

export type FakeStep =
  | { text: string }
  | { tool: string; input?: JsonValue }
  | { error: string; message?: string }
  | { sleep: number }
  | { state: Record<string, JsonValue> }
  | { throw: string }
  | { stop: string };
export type FakeEntry = FakeStep[] | { match: string; steps: FakeStep[] };
export type FakeScript = FakeEntry[];

export const DEFAULT_FAKE_SCRIPT: FakeScript = [
  [{ text: 'This is the fake tutor backend. It has no script for this message.' }],
];

/** Waits `ms`, resolving early when `signal` aborts. Injected: core has no timers. */
export type Sleep = (ms: number, signal: SignalLike) => Promise<void>;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Checks a parsed script file; throws with a readable message. */
export function parseFakeScript(value: unknown): FakeScript {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error('a fake tutor script is a non-empty JSON array');
  const steps = (s: unknown, where: string): FakeStep[] => {
    if (!Array.isArray(s)) throw new Error(`${where}: steps must be an array`);
    s.forEach((step, i) => {
      const keys = isObj(step) ? Object.keys(step) : [];
      const kinds = ['text', 'tool', 'error', 'sleep', 'state', 'throw', 'stop'];
      if (!keys.some((k) => kinds.includes(k)))
        throw new Error(`${where}[${i}]: unknown step ${JSON.stringify(step)}`);
    });
    return s as FakeStep[];
  };
  return value.map((entry, i): FakeEntry => {
    if (Array.isArray(entry)) return steps(entry, `entry ${i}`);
    if (isObj(entry) && typeof entry.match === 'string') {
      new RegExp(entry.match, 'i'); // throws on a bad pattern
      return { match: entry.match, steps: steps(entry.steps, `entry ${i}`) };
    }
    throw new Error(`entry ${i}: expected a list of steps or {match, steps}`);
  });
}

function resolve(
  value: JsonValue | undefined,
  outputs: Map<string, Record<string, unknown>>,
): unknown {
  if (typeof value === 'string' && value.startsWith('$') && value.includes('.')) {
    const [tool, key] = [value.slice(1, value.indexOf('.')), value.slice(value.indexOf('.') + 1)];
    return outputs.get(tool)?.[key];
  }
  if (Array.isArray(value)) return value.map((v) => resolve(v, outputs));
  if (isObj(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolve(v as JsonValue, outputs);
    return out;
  }
  return value ?? {};
}

export class FakeBackend implements TutorBackend {
  readonly id = 'fake' as const;
  readonly turns: Turn[] = [];
  private readonly script: FakeScript;
  private next = 0;
  private tools = 0;

  constructor(
    script: FakeScript = DEFAULT_FAKE_SCRIPT,
    private readonly opts: { sleep?: Sleep; model?: string } = {},
  ) {
    this.script = script.length ? script : DEFAULT_FAKE_SCRIPT;
  }

  status(): Promise<BackendStatus> {
    return Promise.resolve({
      available: true,
      reason: null,
      model: this.opts.model ?? 'fake-model',
    });
  }

  stepsFor(text: string): FakeStep[] {
    for (const entry of this.script)
      if (!Array.isArray(entry) && new RegExp(entry.match, 'i').test(text)) return entry.steps;
    const plain = this.script.filter((e): e is FakeStep[] => Array.isArray(e));
    if (!plain.length) return DEFAULT_FAKE_SCRIPT[0] as FakeStep[];
    return plain[this.next++ % plain.length]!;
  }

  async *runTurn(turn: Turn, signal: SignalLike): AsyncIterable<ChatEvent> {
    this.turns.push(turn);
    const count = turn.backendState.turns;
    turn.backendState.turns = (typeof count === 'number' ? count : 0) + 1;
    const outputs = new Map<string, Record<string, unknown>>();
    let stop = 'end_turn';
    for (const step of this.stepsFor(turn.userText)) {
      if (signal.aborted) {
        yield chatError('cancelled', 'Stopped.');
        return;
      }
      if ('text' in step) yield textDelta(step.text);
      else if ('tool' in step) {
        const id = `fake_t${++this.tools}`;
        yield toolStart(id, step.tool, turn.tools.startSummary(step.tool));
        const result = await turn.tools.call(step.tool, resolve(step.input, outputs));
        outputs.set(step.tool, result.output);
        yield* resultEvents(id, result);
      } else if ('error' in step) {
        const kind = (ERROR_KINDS as readonly string[]).includes(step.error)
          ? (step.error as ErrorKind)
          : 'other';
        yield chatError(kind, step.message ?? 'scripted error');
        return;
      } else if ('sleep' in step) {
        if (this.opts.sleep) await this.opts.sleep(step.sleep, signal);
      } else if ('state' in step) Object.assign(turn.backendState, step.state);
      else if ('throw' in step) throw new Error(step.throw);
      else if ('stop' in step) stop = step.stop;
    }
    if (signal.aborted) {
      yield chatError('cancelled', 'Stopped.');
      return;
    }
    yield done(stop);
  }
}
