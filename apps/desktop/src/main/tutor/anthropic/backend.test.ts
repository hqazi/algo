/**
 * The Anthropic backend against a scripted stand-in for the SDK client: the
 * requests it builds, the tool loop, stop reasons, error mapping and cancel.
 * No test calls the real API (`npm run smoke:ai` does, by hand).
 */
import Anthropic from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  anchorFromRange,
  articleTurnContext,
  buildArticleRegistry,
  buildArticleSystemPrompt,
  markdownDoc,
  buildTutorRegistry,
  MemoryStorage,
  SlugGuard,
  stringifyJson,
  Teaching,
  type ChatEvent,
  type JsonValue,
  type Problem,
  type Turn,
  type TutorToolContext,
} from '@algo/core';
import {
  curatedCatalog,
  curatedProblems,
  hiddenNeedles,
  ScriptedExecutor,
  tickingClock,
} from '../../../../../../packages/core/src/teaching/test-support';
import {
  memoryWorkspace,
  workspacePath,
} from '../../../../../../packages/core/src/teaching/workspace';
import {
  AnthropicBackend,
  DEFAULT_MODEL,
  echoContent,
  FALLBACK_BETA,
  seedMessages,
  type MessagesClient,
} from './backend';

type Params = Anthropic.Beta.Messages.MessageCreateParamsStreaming;
type Event = Anthropic.Beta.Messages.BetaRawMessageStreamEvent;
type Block = Record<string, unknown>;

const KEY = 'sk-ant-test-0123456789abcdef';
const SLUG = 'compress-runs';

/** One scripted API response: its content blocks and stop reason, or an error to throw. */
type Reply =
  { content: Block[]; stop: string; stop_details?: unknown } | { throw: unknown } | { hang: true };

class FakeClient implements MessagesClient {
  readonly requests: Params[] = [];
  readonly signals: AbortSignal[] = [];
  constructor(private readonly replies: Reply[]) {}

  get beta(): MessagesClient['beta'] {
    return { messages: { stream: (params, options) => this.stream(params, options?.signal) } };
  }

  private stream(params: Params, signal?: AbortSignal) {
    // A deep copy: the backend appends to the same array after the request.
    this.requests.push(JSON.parse(stringifyJson(params)) as Params);
    if (signal) this.signals.push(signal);
    const reply = this.replies.shift() ?? {
      content: [{ type: 'text', text: 'unscripted' }],
      stop: 'end_turn',
    };
    const message = (): Anthropic.Beta.Messages.BetaMessage => {
      const r = reply as Extract<Reply, { content: Block[] }>;
      return {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: params.model,
        content: r.content,
        stop_reason: r.stop,
        stop_details: r.stop_details ?? null,
        usage: {},
      } as unknown as Anthropic.Beta.Messages.BetaMessage;
    };
    async function* events(): AsyncGenerator<Event> {
      if ('throw' in reply) throw reply.throw;
      if ('hang' in reply) {
        await new Promise<void>((_r, reject) =>
          signal?.addEventListener('abort', () => reject(new Anthropic.APIUserAbortError())),
        );
      }
      const r = reply as Extract<Reply, { content: Block[] }>;
      for (const [index, b] of r.content.entries()) {
        if (b.type === 'text')
          yield {
            type: 'content_block_delta',
            index,
            delta: { type: 'text_delta', text: b.text },
          } as Event;
      }
    }
    const it = events();
    return {
      [Symbol.asyncIterator]: () => it,
      finalMessage: () => Promise.resolve(message()),
    };
  }
}

let problems: Problem[];
let storage: MemoryStorage;
let workspace: ReturnType<typeof memoryWorkspace>;
let executor: ScriptedExecutor;
let ctx: TutorToolContext;
let client: FakeClient;
let backend: AnthropicBackend;
let settings: { key: string | null; model: string | null };
let logs: string[];

beforeEach(async () => {
  problems = await curatedProblems();
  storage = new MemoryStorage();
  workspace = memoryWorkspace();
  executor = new ScriptedExecutor(problems);
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
  };
  await buildTutorRegistry(ctx).call('set_profile', { pairs: { goal: 'general' } });
  settings = { key: KEY, model: null };
  logs = [];
  script([]);
});

function script(replies: Reply[]): void {
  client = new FakeClient(replies);
  backend = new AnthropicBackend({
    apiKey: () => settings.key,
    model: () => settings.model,
    effort: () => 'medium',
    client: (key) => {
      expect(key).toBe(KEY);
      return client;
    },
    log: (m) => logs.push(m),
  });
}

function turn(userText: string, state: Record<string, JsonValue> = {}): Turn {
  return {
    threadId: SLUG,
    systemPrompt: 'SYSTEM PROMPT',
    history: [],
    userText,
    context: { slug: SLUG, title: 'Compress runs', language: 'python', code: 'def f(): pass' },
    tools: buildTutorRegistry(ctx),
    backendState: state,
  };
}

async function run(
  t: Turn,
  signal: AbortSignal = new AbortController().signal,
): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of backend.runTurn(t, signal)) out.push(e);
  return out;
}

const text = (b: string): Block => ({ type: 'text', text: b, citations: null });
const thinking: Block = { type: 'thinking', thinking: '', signature: 'sig-abc' };
const toolUse = (id: string, name: string, input: unknown): Block => ({
  type: 'tool_use',
  id,
  name,
  input,
});
const kinds = (events: ChatEvent[]): string[] =>
  events.map((e) => (e.type === 'ui_event' ? `ui:${e.event.action}` : e.type));

describe('requests', () => {
  it('streams one text reply and builds the documented request', async () => {
    script([{ content: [thinking, text('Hello.')], stop: 'end_turn' }]);
    const t = turn('hi');
    const events = await run(t);
    expect(events).toEqual([
      { type: 'text_delta', text: 'Hello.' },
      { type: 'done', stop: 'end_turn' },
    ]);
    const [req] = client.requests;
    expect(req).toMatchObject({
      model: DEFAULT_MODEL,
      max_tokens: 64_000,
      system: [{ type: 'text', text: 'SYSTEM PROMPT', cache_control: { type: 'ephemeral' } }],
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      stream: true,
    });
    expect(req!.model).not.toMatch(/\d{8}$/);
    expect(req!.tools!.length).toBeGreaterThan(10);
    for (const tool of req!.tools!) expect(tool).toMatchObject({ eager_input_streaming: true });
    expect(req).not.toHaveProperty('tool_choice');
    expect(req).not.toHaveProperty('temperature');
    const user = req!.messages[0]!;
    expect(user.role).toBe('user');
    expect(JSON.stringify(user.content)).toContain('<context>');
    // The transcript keeps the assistant blocks exactly, thinking included.
    expect(t.backendState.messages).toEqual([
      user,
      { role: 'assistant', content: [thinking, text('Hello.')] },
    ]);
  });

  it('uses the configured model, without fallbacks where the model has none', async () => {
    settings.model = 'claude-haiku-5-5';
    script([{ content: [text('ok')], stop: 'end_turn' }]);
    await run(turn('hi'));
    expect(client.requests[0]).toMatchObject({ model: 'claude-haiku-5-5' });
    expect(client.requests[0]).not.toHaveProperty('fallbacks');
    expect((await backend.status()).model).toBe('claude-haiku-5-5');
  });

  it('is unavailable without a key, and says so', async () => {
    settings.key = null;
    expect(await backend.status()).toEqual({
      available: false,
      reason: 'No Anthropic API key is set.',
      model: DEFAULT_MODEL,
    });
    expect(await run(turn('hi'))).toEqual([
      { type: 'error', kind: 'auth', message: expect.any(String) },
    ]);
  });

  it('appends to the stored transcript and replays earlier blocks unchanged', async () => {
    script([
      { content: [thinking, text('one')], stop: 'end_turn' },
      { content: [text('two')], stop: 'end_turn' },
    ]);
    const state: Record<string, JsonValue> = {};
    await run(turn('first', state));
    const before = JSON.parse(stringifyJson(state.messages)) as unknown[];
    await run(turn('second', state));
    const sent = client.requests[1]!.messages;
    expect(sent.slice(0, 2)).toEqual(before);
    expect(sent).toHaveLength(3);
  });

  it('seeds a thread without state from the neutral transcript, as text', () => {
    expect(
      seedMessages([
        { role: 'assistant', text: 'skipped: an API conversation starts with the user' },
        { role: 'user', text: 'a' },
        { role: 'user', text: 'b' },
        { role: 'assistant', text: '' },
        { role: 'assistant', text: 'c' },
      ]),
    ).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'a\n\nb' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'c' }] },
    ]);
  });
});

describe('the tool loop', () => {
  it('runs the tools, returns every result in one message, and continues', async () => {
    await buildTutorRegistry(ctx).call('start_problem', { slug: SLUG });
    workspace.files.set(workspacePath(SLUG, 'python'), '# ECHO\n');
    script([
      {
        content: [
          thinking,
          text('Let me check.'),
          toolUse('tu_1', 'run_tests', { slug: SLUG }),
          toolUse('tu_2', 'get_problem', { slug: 'no-such' }),
        ],
        stop: 'tool_use',
      },
      { content: [text('Two cases fail.')], stop: 'end_turn' },
    ]);
    const t = turn('run my tests');
    const events = await run(t);
    expect(kinds(events)).toEqual([
      'text_delta',
      'tool_start',
      'tool_end',
      'ui:show_results',
      'tool_start',
      'tool_end',
      'text_delta',
      'text_delta',
      'done',
    ]);
    expect(events[6]).toEqual({ type: 'text_delta', text: '\n\n' });
    const second = client.requests[1]!.messages;
    expect(second[1]).toEqual({
      role: 'assistant',
      content: [
        thinking,
        text('Let me check.'),
        toolUse('tu_1', 'run_tests', { slug: SLUG }),
        toolUse('tu_2', 'get_problem', { slug: 'no-such' }),
      ],
    });
    const results = second[2]!.content as unknown as Block[];
    expect(results.map((r) => [r.type, r.tool_use_id, r.is_error])).toEqual([
      ['tool_result', 'tu_1', undefined],
      ['tool_result', 'tu_2', true],
    ]);
    expect(JSON.parse(results[0]!.content as string)).toMatchObject({
      ok: true,
      total: expect.any(Number),
    });
  });

  it('a tool input that fails its schema is not run, and the model is told', async () => {
    script([
      { content: [toolUse('tu_1', 'run_tests', { slug: 42 })], stop: 'tool_use' },
      { content: [text('Sorry.')], stop: 'end_turn' },
    ]);
    await run(turn('x'));
    expect(executor.jobs).toHaveLength(0);
    const r = (client.requests[1]!.messages[2]!.content as unknown as Block[])[0]!;
    expect(r).toMatchObject({ is_error: true });
    expect(r.content).toMatch(/invalid input/);
  });

  it('pause_turn continues with the same conversation', async () => {
    script([
      { content: [text('part one')], stop: 'pause_turn' },
      { content: [text('part two')], stop: 'end_turn' },
    ]);
    const events = await run(turn('x'));
    expect(kinds(events)).toEqual(['text_delta', 'text_delta', 'text_delta', 'done']);
    expect(client.requests).toHaveLength(2);
  });

  it('drops the declined attempt before a mid-output fallback, keeping text and the fallback block', () => {
    const fallback = { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } };
    expect(
      echoContent([
        thinking,
        { type: 'text', text: 'partial' },
        toolUse('x', 'y', {}),
        fallback,
        thinking,
        text('rest'),
      ] as { type: string }[]),
    ).toEqual([{ type: 'text', text: 'partial' }, fallback, thinking, text('rest')]);
  });
});

describe('stop reasons', () => {
  it('refusal ends the turn with that kind and keeps no reply', async () => {
    script([
      {
        content: [text('I was saying')],
        stop: 'refusal',
        stop_details: { type: 'refusal', category: 'cyber', explanation: null },
      },
    ]);
    const t = turn('x');
    const events = await run(t);
    expect(events.at(-1)).toEqual({
      type: 'error',
      kind: 'refusal',
      message: 'The tutor declined to answer this (cyber). Try rephrasing the request.',
    });
    expect((t.backendState.messages as unknown[]).length).toBe(1);
  });

  it('max_tokens never runs a possibly truncated tool call', async () => {
    script([{ content: [toolUse('tu_1', 'run_tests', { slug: SLUG })], stop: 'max_tokens' }]);
    const t = turn('x');
    const events = await run(t);
    expect(executor.jobs).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ type: 'error', kind: 'max_tokens' });
    const msgs = t.backendState.messages as { content: Block[] }[];
    expect(msgs[2]!.content[0]).toMatchObject({ tool_use_id: 'tu_1', is_error: true });
  });

  it('max_tokens on text keeps the text and says it was cut off', async () => {
    script([{ content: [text('long')], stop: 'max_tokens' }]);
    expect((await run(turn('x'))).at(-1)).toMatchObject({ kind: 'max_tokens' });
  });

  it('a context window overflow asks to reset the chat', async () => {
    script([{ content: [text('')], stop: 'model_context_window_exceeded' }]);
    expect((await run(turn('x'))).at(-1)).toMatchObject({
      kind: 'other',
      message: /Reset the chat/,
    });
  });

  it('stops after too many rounds', async () => {
    script(
      Array.from({ length: 30 }, (_, i) => ({
        content: [toolUse(`tu_${i}`, 'get_status', {})],
        stop: 'tool_use',
      })),
    );
    const events = await run(turn('loop'));
    expect(events.at(-1)).toMatchObject({ kind: 'other', message: /more than 24 steps/ });
    expect(client.requests).toHaveLength(24);
  });
});

describe('errors', () => {
  const headers = new Headers({ 'request-id': 'req_1' });
  it.each([
    [Anthropic.APIError.generate(401, { error: { message: 'bad key' } }, 'x', headers), 'auth'],
    [Anthropic.APIError.generate(403, { error: { message: 'no' } }, 'x', headers), 'auth'],
    [Anthropic.APIError.generate(429, { error: { message: 'slow' } }, 'x', headers), 'rate_limit'],
    [Anthropic.APIError.generate(529, { error: { message: 'busy' } }, 'x', headers), 'rate_limit'],
    [Anthropic.APIError.generate(500, { error: { message: 'oops' } }, 'x', headers), 'other'],
    [Anthropic.APIError.generate(400, { error: { message: 'bad' } }, 'x', headers), 'other'],
    [new Anthropic.APIConnectionError({ message: 'offline' }), 'network'],
    [new Anthropic.APIConnectionTimeoutError(), 'network'],
    [new SyntaxError('Unexpected token'), 'other'],
  ])('%s → %s', async (err, kind) => {
    script([{ throw: err }]);
    const t = turn('x');
    const events = await run(t);
    expect(events).toEqual([{ type: 'error', kind, message: expect.any(String) }]);
    expect((t.backendState.messages as unknown[]).length).toBe(1);
  });

  it('never puts the API key in an error message or a log line', async () => {
    script([
      {
        throw: Anthropic.APIError.generate(
          400,
          { error: { message: `key ${KEY} is odd` } },
          'x',
          headers,
        ),
      },
    ]);
    const events = await run(turn('x'));
    expect(stringifyJson(events)).not.toContain(KEY);
    expect(stringifyJson(events)).toContain('[redacted]');
    expect(logs.join('\n')).not.toContain(KEY);
  });
});

describe('cancel', () => {
  it('aborts the request while it streams', async () => {
    script([{ hang: true }]);
    const abort = new AbortController();
    const running = run(turn('x'), abort.signal);
    await new Promise((r) => setTimeout(r, 10));
    abort.abort();
    expect(await running).toEqual([{ type: 'error', kind: 'cancelled', message: 'Stopped.' }]);
    expect(client.signals[0]!.aborted).toBe(true);
  });

  it('lets a running tool finish, records its result, and does not ask the model again', async () => {
    await buildTutorRegistry(ctx).call('start_problem', { slug: SLUG });
    workspace.files.set(workspacePath(SLUG, 'python'), '# SLOW\n');
    script([
      {
        content: [toolUse('tu_1', 'run_tests', { slug: SLUG }), toolUse('tu_2', 'get_status', {})],
        stop: 'tool_use',
      },
    ]);
    const abort = new AbortController();
    const t = turn('x');
    const events: ChatEvent[] = [];
    for await (const e of backend.runTurn(t, abort.signal)) {
      events.push(e);
      if (e.type === 'tool_start') {
        abort.abort();
        const free = (): unknown =>
          executor.jobs.length ? executor.release() : setTimeout(free, 5);
        free();
      }
    }
    expect(kinds(events)).toEqual(['tool_start', 'tool_end', 'ui:show_results', 'error']);
    expect(events.at(-1)).toMatchObject({ kind: 'cancelled' });
    expect(client.requests).toHaveLength(1);
    const results = (t.backendState.messages as { content: Block[] }[])[2]!.content;
    expect(results.map((r) => r.tool_use_id)).toEqual(['tu_1', 'tu_2']);
    expect(results[1]).toMatchObject({
      is_error: true,
      content: expect.stringContaining('cancelled'),
    });
  });
});

describe('no hidden test data in any request built for the API (threat T6)', () => {
  it.each(['compress-runs', 'first-unique-char', 'pair-with-target'])('%s', async (slug) => {
    const p = problems.find((x) => x.meta.slug === slug)!;
    const needles = hiddenNeedles(p);
    expect(needles.length).toBeGreaterThan(0);
    const calls: [string, unknown][] = [
      ['start_problem', { slug }],
      ['get_problem', { slug }],
      ['read_solution', { slug }],
      ['run_tests', { slug }],
      ['run_tests', { slug, only: 'hidden' }],
      ['take_hint', { slug }],
      ['read_reference', { slug }],
      ['record_attempt', { slug, gave_up: true }],
      ['list_attempts', { slug }],
      ['get_status', {}],
    ];
    script([
      {
        content: calls.map(([name, input], i) => toolUse(`tu_${i}`, name, input)),
        stop: 'tool_use',
      },
      { content: [text('done')], stop: 'end_turn' },
      { content: [text('again')], stop: 'end_turn' },
    ]);
    workspace.files.set(workspacePath(slug, 'python'), '# ECHO\n');
    const state: Record<string, JsonValue> = {};
    const t = turn('go', state);
    await run(t);
    const runs = storage.read((db) =>
      db.listAttempts({ slug }).flatMap((a) => db.listTestRuns(a.id)),
    );
    expect(runs.length).toBeGreaterThan(0);
    // The next turn's context carries the last stored (redacted) report, as the app's does.
    const t2 = turn('and now?', state);
    t2.context = { slug, code: '# ECHO\n', lastReport: runs.at(-1)!.report };
    await run(t2);
    const sent = stringifyJson(client.requests);
    for (const n of needles) expect(sent.includes(n), `hidden data in a request: ${n}`).toBe(false);
  });
});

describe('article mode (T24)', () => {
  it('runs one article turn with the three tools and the passage as delimited data', async () => {
    const body = '# Heaps\n\nA heap keeps the smallest on top.\n\n# Tries\n\nFAR_AWAY trie text.\n';
    const at = body.indexOf('A heap');
    const anchor = anchorFromRange(markdownDoc(body), at, at + 'A heap keeps'.length);
    const tools = buildArticleRegistry({ body, getProfile: () => ctx.teaching.getProfile() });
    script([
      {
        content: [toolUse('tu_1', 'read_article_section', { heading: 'Tries' })],
        stop: 'tool_use',
      },
      { content: [text('Tries are trees of prefixes.')], stop: 'end_turn' },
    ]);
    const t: Turn = {
      threadId: 'article:12345678-1234-4234-8234-123456789abc',
      systemPrompt: buildArticleSystemPrompt(tools.anthropicTools()),
      history: [],
      userText: 'What is this?',
      context: { article: articleTurnContext({ title: 'DS', source: null, body }, anchor) },
      tools,
      backendState: {},
    };
    const events = await run(t);
    expect(kinds(events)).toEqual(['tool_start', 'tool_end', 'text_delta', 'done']);
    const [first, second] = client.requests;
    expect(first!.tools!.map((x) => (x as { name: string }).name)).toEqual([
      'read_article_section',
      'search_article',
      'get_profile',
    ]);
    const user = JSON.stringify(first!.messages[0]);
    expect(user).toContain('<article_quote>');
    expect(user).toContain('A heap keeps');
    expect(user).not.toContain('FAR_AWAY');
    // The section came back through the tool, as a tool result.
    expect(JSON.stringify(second!.messages)).toContain('FAR_AWAY trie text.');
  });
});
