/**
 * The chat service with the fake backend over the real tools, storage and
 * curated content (ported scenarios of `dsa-tutor/tests/test_chat.py` and
 * the `web/tests/fixtures/chat/*.sse` recordings): explain, hint, review,
 * run tests, refusal, rate limit, auth error, cancel, busy, reset. Nothing
 * here calls an AI provider.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Problem } from '../problems/loader';
import { MemoryStorage } from '../teaching/memory-storage';
import { Teaching } from '../teaching/teaching';
import {
  curatedCatalog,
  curatedProblems,
  hiddenNeedles,
  ScriptedExecutor,
  tickingClock,
} from '../teaching/test-support';
import { memoryWorkspace, workspacePath } from '../teaching/workspace';
import { SlugGuard } from '../tools/guard';
import { buildTutorRegistry, type TutorToolContext } from '../tools/tutor-tools';
import type { ToolRegistry } from '../tools/registry';
import { stringifyJson } from '../types/json';
import type { SignalLike, TurnContext, TutorBackend } from './backend';
import { UnavailableBackend } from './backend';
import { ACTION_TEXT, ChatRefusal, ChatService, HOME_THREAD, type SendRequest } from './chat';
import type { ChatEvent } from './chat-events';
import { FakeBackend, parseFakeScript, type FakeScript, type Sleep } from './fake';

const SLUG = 'compress-runs';

/** A minimal `AbortController` (core's lib has no DOM or Node types). */
class TestAbort implements SignalLike {
  aborted = false;
  private listeners = new Set<() => void>();
  addEventListener(_t: 'abort', fn: () => void): void {
    this.listeners.add(fn);
  }
  removeEventListener(_t: 'abort', fn: () => void): void {
    this.listeners.delete(fn);
  }
  abort(): void {
    this.aborted = true;
    for (const fn of [...this.listeners]) fn();
  }
}

const timers = globalThis as unknown as { setTimeout(fn: () => void, ms: number): unknown };
const sleep: Sleep = (ms, signal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      signal.removeEventListener('abort', done);
      resolve();
    };
    signal.addEventListener('abort', done);
    timers.setTimeout(done, ms);
  });

let problems: Problem[];
let storage: MemoryStorage;
let workspace: ReturnType<typeof memoryWorkspace>;
let executor: ScriptedExecutor;
let ctx: TutorToolContext;
let tools: ToolRegistry<TutorToolContext>;
let backend: TutorBackend;
let chat: ChatService;
let contexts: { thread: string; code: string | undefined }[];
let explained: Record<string, unknown>[];

function make(script: FakeScript | TutorBackend): void {
  backend = Array.isArray(script) ? new FakeBackend(parseFakeScript(script), { sleep }) : script;
  chat = new ChatService({
    storage,
    backend: () => backend,
    tools,
    systemPrompt: 'SYSTEM',
    context: (thread, code) => {
      contexts.push({ thread, code });
      const c: TurnContext = {};
      if (thread !== HOME_THREAD) {
        c.slug = thread;
        c.code = code ?? workspace.files.get(workspacePath(thread, 'python')) ?? '';
      }
      return Promise.resolve(c);
    },
    now: tickingClock(),
  });
}

beforeEach(async () => {
  problems = await curatedProblems();
  storage = new MemoryStorage();
  workspace = memoryWorkspace();
  executor = new ScriptedExecutor(problems);
  contexts = [];
  explained = [];
  ctx = {
    teaching: new Teaching({
      storage,
      catalog: await curatedCatalog(),
      workspace,
      now: tickingClock(),
    }),
    storage,
    workspace,
    guard: new SlugGuard(),
    executorFor: (language) => (language === 'python' ? executor : null),
    renderExplanation: (content) => {
      explained.push(content);
      return Promise.resolve({ ok: true, slug: content.slug, version: 'v1' });
    },
  };
  tools = buildTutorRegistry(ctx);
  await tools.call('set_profile', { pairs: { goal: 'general' } });
});

const reference = (slug: string): string => problems.find((p) => p.meta.slug === slug)!.reference;
const save = (slug: string, code: string): void => {
  workspace.files.set(workspacePath(slug, 'python'), code);
};

async function send(
  req: Partial<SendRequest> & { thread?: string },
  signal: SignalLike = new TestAbort(),
): Promise<{ events: ChatEvent[]; result: Awaited<ReturnType<ChatService['send']>> }> {
  const events: ChatEvent[] = [];
  const result = await chat.send({ thread: SLUG, ...req }, signal, (e) => events.push(e));
  return { events, result };
}

const kinds = (events: ChatEvent[]): string[] =>
  events.map((e) => (e.type === 'ui_event' ? `ui:${e.event.action}` : e.type));
const last = (events: ChatEvent[]): ChatEvent => events[events.length - 1]!;

describe('turns', () => {
  it('streams text, stores both messages, ends with one done', async () => {
    make([[{ text: 'Hello ' }, { text: 'there.' }]]);
    const { events, result } = await send({ thread: HOME_THREAD, text: 'hi' });
    expect(kinds(events)).toEqual(['text_delta', 'text_delta', 'done']);
    expect(result.message).toMatchObject({
      role: 'assistant',
      text: 'Hello there.',
      stop: 'end_turn',
    });
    const t = chat.transcript(HOME_THREAD);
    expect(t.map((m) => [m.role, m.text])).toEqual([
      ['user', 'hi'],
      ['assistant', 'Hello there.'],
    ]);
    expect(chat.isRunning(HOME_THREAD)).toBe(false);
  });

  it('hint: the action text is sent, and the level climbs one per press', async () => {
    make([
      {
        match: 'next hint',
        steps: [
          { tool: 'read_solution', input: { slug: SLUG } },
          { tool: 'take_hint', input: { slug: SLUG } },
          { text: 'Think about runs.' },
        ],
      },
    ]);
    save(SLUG, 'def compress_runs(s):\n    pass\n');
    const first = await send({ action: 'hint' });
    expect(kinds(first.events)).toEqual([
      'tool_start',
      'tool_end',
      'tool_start',
      'tool_end',
      'ui:refresh_state',
      'text_delta',
      'done',
    ]);
    const fake = backend as FakeBackend;
    expect(fake.turns[0]!.userText).toBe(ACTION_TEXT.hint);
    expect(fake.turns[0]!.context.code).toContain('def compress_runs');
    const chips = first.result.message.tools!;
    expect(chips.map((c) => [c.name, c.ok])).toEqual([
      ['read_solution', true],
      ['take_hint', true],
    ]);
    expect(chips[1]!.summary).toMatch(/1 of 4/);
    const second = await send({ action: 'hint', text: 'still stuck' });
    expect(fake.turns[1]!.userText).toBe(`${ACTION_TEXT.hint}\n\nstill stuck`);
    expect(second.result.message.tools![1]!.summary).toMatch(/2 of 4/);
    expect(fake.turns[1]!.history.map((m) => m.role)).toEqual(['user', 'assistant']);
    const hints = storage.read((db) => db.listHints(db.getOpenAttempt(SLUG)!.id));
    expect(hints.map((h) => h.level)).toEqual([1, 2]);
    expect(chat.transcript(SLUG)[0]).toMatchObject({ action: 'hint', slug: SLUG });
  });

  it('review: runs the tests, then records the attempt only when they pass', async () => {
    make([
      [
        { tool: 'run_tests', input: { slug: SLUG } },
        { tool: 'record_attempt', input: { slug: SLUG, notes: 'clean first try' } },
        { text: 'Verdict: Solved ✓' },
      ],
    ]);
    await tools.call('start_problem', { slug: SLUG });
    save(SLUG, reference(SLUG));
    const { events, result } = await send({ action: 'review' });
    expect(kinds(events)).toContain('ui:show_results');
    const chips = result.message.tools!;
    expect(chips.map((c) => c.ok)).toEqual([true, true]);
    const attempts = storage.read((db) => db.listAttempts({ slug: SLUG }));
    expect(attempts[0]).toMatchObject({ outcome: 'unaided', notes: 'clean first try' });
  });

  it('run tests: the results event carries the redacted report', async () => {
    make([[{ tool: 'run_tests', input: { slug: SLUG } }, { text: 'Two cases fail.' }]]);
    await tools.call('start_problem', { slug: SLUG });
    save(SLUG, '# ECHO\n');
    const { events } = await send({ text: 'run the tests' });
    const ui = events.find((e) => e.type === 'ui_event' && e.event.action === 'show_results');
    expect(ui).toBeDefined();
    const end = events.find((e) => e.type === 'tool_end')!;
    expect(end).toMatchObject({ ok: true });
  });

  it('explain: the tool writes a version and the app is told to open it', async () => {
    make([
      [
        {
          tool: 'render_explanation',
          input: {
            content: {
              slug: SLUG,
              plain_words: 'p',
              intuition: 'i',
              brute_force: 'b',
              optimal: 'o',
              trace: 't',
              complexity: 'c',
              solution: 'def f(): pass',
              pitfalls: ['x'],
            },
          },
        },
        { text: 'The explanation is open.' },
      ],
    ]);
    await tools.call('start_problem', { slug: SLUG });
    const { events } = await send({ action: 'explain' });
    expect(events).toContainEqual({
      type: 'ui_event',
      event: { type: 'ui', action: 'open_explanation', slug: SLUG },
    });
    expect(explained).toHaveLength(1);
    expect(storage.read((db) => db.getOpenAttempt(SLUG)!.explained)).toBe(true);
  });

  it('a failing tool shows a failed chip and the turn goes on', async () => {
    make([[{ tool: 'get_problem', input: { slug: 'no-such-problem' } }, { text: 'Hm.' }]]);
    const { events, result } = await send({ text: 'show me' });
    expect(kinds(events)).toEqual(['tool_start', 'tool_end', 'text_delta', 'done']);
    expect(result.message.tools![0]!.ok).toBe(false);
  });
});

describe('errors', () => {
  it.each([
    ['refusal', 'The tutor declined.'],
    ['rate_limit', 'Wait a minute.'],
    ['auth', 'The API key was rejected.'],
    ['network', 'Offline.'],
    ['max_tokens', 'Too long.'],
  ] as const)(
    '%s ends the turn with that kind and keeps the partial reply',
    async (kind, message) => {
      make([[{ text: 'Partial' }, { error: kind, message }, { text: 'never sent' }]]);
      const { events, result } = await send({ text: 'hello' });
      expect(kinds(events)).toEqual(['text_delta', 'error']);
      expect(last(events)).toEqual({ type: 'error', kind, message });
      expect(result.message).toMatchObject({ text: 'Partial', error: { kind, message } });
      expect(chat.transcript(SLUG).at(-1)!.error).toEqual({ kind, message });
    },
  );

  it('a backend that throws ends the turn with a generic error, never the exception text', async () => {
    make([[{ text: 'a' }, { throw: 'secret internals' }]]);
    const logged: unknown[] = [];
    const svc = chat as unknown as { deps: { log: (m: string, e: unknown) => void } };
    svc.deps.log = (_m, e) => logged.push(e);
    const { events } = await send({ text: 'x' });
    expect(last(events)).toMatchObject({ type: 'error', kind: 'other' });
    expect(stringifyJson(events)).not.toContain('secret internals');
    expect(logged).toHaveLength(1);
  });

  it('a backend that stops without done or error gets an error', async () => {
    make({
      id: 'fake',
      status: () => Promise.resolve({ available: true, reason: null, model: null }),

      async *runTurn() {
        yield { type: 'text_delta', text: 'half' } as const;
      },
    });
    const { events } = await send({ text: 'x' });
    expect(kinds(events)).toEqual(['text_delta', 'error']);
  });

  it('an unavailable backend refuses before storing anything', async () => {
    make(new UnavailableBackend('anthropic', 'no API key is stored'));
    await expect(send({ text: 'hi' })).rejects.toMatchObject({ reason: 'unavailable' });
    expect(chat.transcript(SLUG)).toEqual([]);
  });

  it.each([
    [{ thread: 'Not A Slug', text: 'x' }, 'invalid_thread'],
    [{ text: '   ' }, 'empty'],
    [{ text: 'x'.repeat(20_001) }, 'too_long'],
  ])('refuses %j', async (req, reason) => {
    make([[{ text: 'never' }]]);
    await expect(send(req)).rejects.toBeInstanceOf(ChatRefusal);
    await expect(send(req)).rejects.toMatchObject({ reason });
  });
});

describe('cancel', () => {
  it('stops the turn: error cancelled, stored, thread free again', async () => {
    make([[{ text: 'Thinking' }, { sleep: 10_000 }, { text: 'never' }]]);
    const abort = new TestAbort();
    const events: ChatEvent[] = [];
    const running = chat.send({ thread: SLUG, text: 'go' }, abort, (e) => {
      events.push(e);
      if (e.type === 'text_delta') abort.abort();
    });
    const { message } = await running;
    expect(kinds(events)).toEqual(['text_delta', 'error']);
    expect(last(events)).toMatchObject({ kind: 'cancelled' });
    expect(message).toMatchObject({ text: 'Thinking', error: { kind: 'cancelled' } });
    expect(chat.isRunning(SLUG)).toBe(false);
    make([[{ text: 'again' }]]);
    expect((await send({ text: 'next' })).result.message.text).toBe('again');
  });

  it('a tool already running finishes before the turn stops', async () => {
    make([[{ tool: 'run_tests', input: { slug: SLUG } }, { text: 'never' }]]);
    await tools.call('start_problem', { slug: SLUG });
    save(SLUG, '# SLOW\n');
    const abort = new TestAbort();
    const events: ChatEvent[] = [];
    const running = chat.send({ thread: SLUG, text: 'run' }, abort, (e) => {
      events.push(e);
      if (e.type === 'tool_start') {
        abort.abort();
        const free = (): unknown =>
          executor.jobs.length ? executor.release() : timers.setTimeout(free, 5);
        free();
      }
    });
    await running;
    expect(kinds(events)).toEqual(['tool_start', 'tool_end', 'ui:show_results', 'error']);
    const runs = storage.read((db) => db.listTestRuns(db.getOpenAttempt(SLUG)!.id));
    expect(runs).toHaveLength(1);
  });

  it('one turn per thread: a second send is refused as busy', async () => {
    make([[{ sleep: 10_000 }]]);
    const abort = new TestAbort();
    const first = chat.send({ thread: SLUG, text: 'one' }, abort, () => {});
    await expect(send({ text: 'two' })).rejects.toMatchObject({ reason: 'busy' });
    await expect(chat.reset(SLUG)).rejects.toMatchObject({ reason: 'busy' });
    abort.abort();
    await first;
  });
});

describe('threads', () => {
  it('reset archives the thread and the next message starts afresh', async () => {
    make([[{ state: { session: 'abc' } }, { text: 'one' }]]);
    await send({ text: 'first' });
    expect(chat.transcript(SLUG)).toHaveLength(2);
    expect(await chat.reset(SLUG)).toEqual({ archived: true });
    expect(chat.transcript(SLUG)).toEqual([]);
    const archived = storage.read((db) => db.listThreads({ archived: true }));
    expect(archived.map((t) => t.id)).toEqual([`${SLUG}~1`]);
    expect(storage.read((db) => db.listMessages(`${SLUG}~1`))).toHaveLength(2);
    await send({ text: 'second' });
    const fake = backend as FakeBackend;
    expect(fake.turns[1]!.history).toEqual([]);
    expect(fake.turns[1]!.backendState).toEqual({ turns: 1, session: 'abc' });
    await chat.reset(SLUG);
    expect(storage.read((db) => db.listThreads({ archived: true })).map((t) => t.id)).toEqual([
      `${SLUG}~1`,
      `${SLUG}~2`,
    ]);
    expect(await chat.reset('first-unique-char')).toEqual({ archived: false });
  });

  it("keeps each backend's state apart", async () => {
    make([[{ state: { mine: 1 } }, { text: 'a' }]]);
    await send({ text: 'x' });
    const other: TutorBackend = {
      id: 'anthropic',
      status: () => Promise.resolve({ available: true, reason: null, model: 'm' }),

      async *runTurn(turn) {
        expect(turn.backendState).toEqual({});
        turn.backendState.messages = ['kept'];
        yield { type: 'done', stop: 'end_turn' } as const;
      },
    };
    make(other);
    await send({ text: 'y' });
    const state = storage.read((db) => db.getThread(SLUG)!.backendState);
    expect(state).toEqual({ fake: { turns: 1, mine: 1 }, anthropic: { messages: ['kept'] } });
  });

  it('the editor code is passed to the context builder', async () => {
    make([[{ text: 'ok' }]]);
    await send({ text: 'look', code: 'print(1)' });
    expect(contexts).toEqual([{ thread: SLUG, code: 'print(1)' }]);
  });
});

describe('no hidden test data in chat events or the transcript (threat T6)', () => {
  it.each(['compress-runs', 'first-unique-char', 'pair-with-target'])('%s', async (slug) => {
    const p = problems.find((x) => x.meta.slug === slug)!;
    const needles = hiddenNeedles(p);
    expect(needles.length).toBeGreaterThan(0);
    make([
      [
        { tool: 'start_problem', input: { slug } },
        { tool: 'get_problem', input: { slug } },
        { tool: 'run_tests', input: { slug } },
        { tool: 'run_tests', input: { slug, only: 'hidden' } },
        { tool: 'take_hint', input: { slug } },
        { tool: 'record_attempt', input: { slug, gave_up: true } },
        { text: 'done' },
      ],
    ]);
    save(slug, '# ECHO\n');
    const { events } = await send({ thread: slug, text: 'go' });
    const stored = storage.read((db) => db.listMessages(slug));
    const blob = stringifyJson(events) + stringifyJson(stored);
    for (const n of needles) expect(blob.includes(n), `hidden data leaked: ${n}`).toBe(false);
  });
});
