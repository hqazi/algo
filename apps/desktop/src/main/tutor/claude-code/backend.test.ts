import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import {
  anchorFromRange,
  articleTurnContext,
  buildArticleRegistry,
  buildArticleSystemPrompt,
  markdownDoc,
  type ChatEvent,
  type Turn,
} from '@algo/core';
import { buildArgs, TOOL_PREFIX } from './command';
import { recap } from './backend';
import { fakeTools, rig, turn, type Rig } from './fixtures/harness';
import { startMockApi } from './fixtures/mock-messages-api';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const FAKE = join(FIXTURES, 'fake-claude.mjs');

let open: Rig[] = [];
afterEach(async () => {
  for (const r of open) await r.close();
  open = [];
});

interface Dump {
  argv: string[];
  env: Record<string, string>;
  prompt: string;
  mcp: { url: string; headers: Record<string, string> };
  cwd: string;
}

async function fakeRig(
  mode: string,
  fixture = 'turn.jsonl',
  over: Parameters<typeof rig>[1] = {},
): Promise<{ r: Rig; dump: string }> {
  const dump = join(await mkdtemp(join(tmpdir(), 'cc-dump-')), 'dump.json');
  const r = await rig(process.execPath, {
    prefixArgs: [FAKE],
    extraEnv: {
      FAKE_CLAUDE_MODE: mode,
      FAKE_CLAUDE_FIXTURE: join(FIXTURES, fixture),
      FAKE_CLAUDE_DUMP: dump,
    },
    env: {
      PATH: process.env.PATH,
      ANTHROPIC_API_KEY: 'sk-ant-from-parent-env',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-from-parent-env',
      HTTPS_PROXY: 'http://proxy.example:8080',
      SECRET_THING: 'nope',
    },
    toolGraceMs: 5_000,
    ...over,
  });
  open.push(r);
  return { r, dump };
}

async function collect(
  it: AsyncIterable<ChatEvent>,
  onEvent?: (e: ChatEvent) => void,
): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of it) {
    out.push(e);
    onEvent?.(e);
  }
  return out;
}

const readDump = async (path: string): Promise<Dump> =>
  JSON.parse(await readFile(path, 'utf8')) as Dump;

describe('the command', () => {
  const args = buildArgs({
    systemPromptFile: '/run/system-prompt.md',
    mcpConfigFile: '/run/mcp.json',
    tools: ['get_status', 'run_tests'],
    model: 'claude-opus-5-5',
    effort: 'medium',
    sessionId: null,
  });
  const value = (flag: string): string | undefined => args[args.indexOf(flag) + 1];

  it('leaves no built-in tool enabled and allows only the tutor tools', () => {
    expect(args).toContain('--bare');
    expect(value('--tools')).toBe('');
    expect(args).toContain('--strict-mcp-config');
    expect(value('--permission-mode')).toBe('dontAsk');
    expect(value('--setting-sources')).toBe('');
    expect(args).toContain('--disable-slash-commands');
    expect(value('--allowedTools')!.split(',')).toEqual([
      'mcp__tutor__get_status',
      'mcp__tutor__run_tests',
    ]);
    // Nothing that widens access.
    for (const bad of [
      '--dangerously-skip-permissions',
      '--allow-dangerously-skip-permissions',
      '--add-dir',
      '--settings',
      '--plugin-dir',
      '--agents',
      '--append-system-prompt',
      '--continue',
    ])
      expect(args).not.toContain(bad);
    expect(args.join(' ')).not.toMatch(/bypassPermissions|acceptEdits|default\b/);
    // Each allowed tool is a tutor tool.
    for (const t of value('--allowedTools')!.split(','))
      expect(t.startsWith(TOOL_PREFIX)).toBe(true);
  });

  it('resumes a session only when asked', () => {
    expect(args).not.toContain('--resume');
    const again = buildArgs({
      systemPromptFile: 'a',
      mcpConfigFile: 'b',
      tools: [],
      model: 'm',
      effort: null,
      sessionId: 's-1',
    });
    expect(again.slice(-2)).toEqual(['--resume', 's-1']);
    expect(again).not.toContain('--effort');
  });

  it('the real CLI (recorded) started with only the tutor tools', async () => {
    for (const name of ['turn.jsonl', 'auth.jsonl']) {
      const lines = (await readFile(join(FIXTURES, name), 'utf8')).split('\n').filter(Boolean);
      const init = lines
        .map((l) => JSON.parse(l) as Record<string, unknown>)
        .find((e) => e.type === 'system' && e.subtype === 'init')!;
      expect(init.tools).toEqual(['mcp__tutor__get_status', 'mcp__tutor__slow_tool']);
      expect(init.mcp_servers).toEqual([{ name: 'tutor', status: 'connected', source: 'dynamic' }]);
      expect(init.permissionMode).toBe('dontAsk');
      expect(init.apiKeySource).toBe('ANTHROPIC_API_KEY');
      expect(init.skills).toEqual([]);
      expect(init.slash_commands).toEqual([]);
    }
  });
});

describe('a turn against the recorded stream', () => {
  it('streams text, reports the tool through MCP, and keeps the session', async () => {
    const { r, dump } = await fakeRig('replay');
    const tools = fakeTools();
    const t = turn(tools);
    const events = await collect(r.backend.runTurn(t, new AbortController().signal));
    const kinds = events.map((e) => e.type);
    expect(kinds).toEqual([
      'text_delta',
      'text_delta',
      'tool_start',
      'tool_end',
      'ui_event',
      'text_delta',
      'text_delta',
      'done',
    ]);
    const text = events
      .filter((e) => e.type === 'text_delta')
      .map((e) => (e as { text: string }).text)
      .join('');
    expect(text).toBe('Let me check.\n\nYou have not started yet. Shall we begin?');
    expect(events[2]).toMatchObject({ name: 'get_status', summary: 'Reading your progress' });
    expect(events[3]).toMatchObject({ ok: true, summary: 'Not started yet' });
    expect(tools.calls).toEqual([{ name: 'get_status', args: {} }]);
    expect(t.backendState.session_id).toBe('655c0b45-a5f4-45cb-aec0-67136b599310');

    const d = await readDump(dump);
    expect(d.prompt).toContain('How am I doing?');
    // macOS reports the temp folder through its /private/var real path.
    expect(d.cwd.replace(/^\/private(?=\/var\/)/, '')).toBe(join(r.home, 'scratch'));
    // Nothing is left behind.
    expect(await readdir(join(r.home, 'run'))).toEqual([]);
    expect(r.gateway.active()).toBe(0);
    expect(r.relay.active()).toBe(0);
  });

  it('gives the CLI a minimal environment: the relay token, never a real credential', async () => {
    const { r, dump } = await fakeRig('replay');
    await collect(r.backend.runTurn(turn(fakeTools()), new AbortController().signal));
    const { env } = await readDump(dump);
    expect(env.ANTHROPIC_API_KEY).toMatch(/^algotutor-/);
    expect(env.ANTHROPIC_BASE_URL).toBe(r.relay.baseUrl ?? env.ANTHROPIC_BASE_URL);
    expect(env.ANTHROPIC_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(env.HOME).toBe(r.home);
    expect(env.CLAUDE_CONFIG_DIR).toBe(join(r.home, '.claude'));
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(env.HTTPS_PROXY).toBeUndefined();
    expect(env.SECRET_THING).toBeUndefined();
    expect(env.DISABLE_AUTOUPDATER).toBe('1');
    expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1');
    const all = JSON.stringify(env);
    expect(all).not.toContain('sk-ant-test-real-key');
    expect(all).not.toContain('sk-ant-from-parent-env');
    // Nor on the command line.
    expect(r.backend.lastArgs!.join(' ')).not.toMatch(/sk-ant|algotutor-|Bearer/);
  });

  it('rejects the MCP token and the relay token after the turn ends', async () => {
    const { r, dump } = await fakeRig('replay');
    await collect(r.backend.runTurn(turn(fakeTools()), new AbortController().signal));
    const d = await readDump(dump);
    const res = await fetch(d.mcp.url, {
      method: 'POST',
      headers: { ...d.mcp.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBe(401);
    expect(d.mcp.headers.Authorization).toMatch(/^Bearer .{40,}/);
    const relay = await fetch(`${d.env.ANTHROPIC_BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': d.env.ANTHROPIC_API_KEY!, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(relay.status).toBe(401);
  });

  it('ends at once with an auth error when the API rejects the key (recorded)', async () => {
    const { r } = await fakeRig('replay', 'auth.jsonl');
    const events = await collect(
      r.backend.runTurn(turn(fakeTools()), new AbortController().signal),
    );
    expect(events.at(-1)).toMatchObject({ type: 'error', kind: 'auth' });
    expect(events.filter((e) => e.type === 'error' || e.type === 'done')).toHaveLength(1);
  });
});

describe('article mode (T24)', () => {
  // `article-turn.jsonl` is the recorded `turn.jsonl` with the tool call
  // rewritten to `read_article_section` by hand (not a new recording).
  it('runs one article turn: only the three tools, the call served from the open article', async () => {
    const { r, dump } = await fakeRig('replay', 'article-turn.jsonl');
    const body =
      '# Heaps\n\nA heap keeps the smallest on top.\n\n# Tries\n\nA trie stores strings by prefix.\n';
    const at = body.indexOf('A heap');
    const tools = buildArticleRegistry({
      body,
      getProfile: () => ({ ok: true, onboarded: false }),
    });
    const t = turn(tools, {
      threadId: 'article:12345678-1234-4234-8234-123456789abc',
      systemPrompt: buildArticleSystemPrompt(tools.anthropicTools()),
      userText: 'What is a heap?',
      context: {
        article: articleTurnContext(
          { title: 'DS', source: null, body },
          anchorFromRange(markdownDoc(body), at, at + 12),
        ),
      },
    });
    const events = await collect(r.backend.runTurn(t, new AbortController().signal));
    expect(events.map((e) => e.type)).toEqual([
      'text_delta',
      'text_delta',
      'tool_start',
      'tool_end',
      'text_delta',
      'text_delta',
      'done',
    ]);
    expect(events[2]).toMatchObject({
      name: 'read_article_section',
      summary: 'Reading the article',
    });
    expect(events[3]).toMatchObject({ ok: true, summary: 'Read “Tries”' });
    const d = await readDump(dump);
    const allowed = d.argv[d.argv.indexOf('--allowedTools') + 1]!.split(',');
    expect(allowed).toEqual([
      `${TOOL_PREFIX}read_article_section`,
      `${TOOL_PREFIX}search_article`,
      `${TOOL_PREFIX}get_profile`,
    ]);
    expect(d.prompt).toContain('<article_quote>\nA heap keeps\n</article_quote>');
    expect(d.prompt).not.toContain('A trie stores');
  });
});

describe('sessions', () => {
  it('resumes the stored session', async () => {
    const { r, dump } = await fakeRig('replay');
    const t = turn(fakeTools(), { backendState: { session_id: 'old-session' } });
    await collect(r.backend.runTurn(t, new AbortController().signal));
    const d = await readDump(dump);
    expect(d.argv.slice(-2)).toEqual(['--resume', 'old-session']);
    expect(d.prompt).not.toContain('<recap>');
    expect(t.backendState.session_id).toBe('655c0b45-a5f4-45cb-aec0-67136b599310');
  });

  it('starts afresh with a recap when the session cannot be resumed', async () => {
    const { r, dump } = await fakeRig('resume-fail');
    const t = turn(fakeTools(), {
      backendState: { session_id: 'gone' },
      history: [
        { role: 'user', text: 'Teach me heaps' },
        { role: 'assistant', text: 'Sure, heaps are trees.' },
      ],
    });
    const events = await collect(r.backend.runTurn(t, new AbortController().signal));
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    const d = await readDump(dump);
    expect(d.argv).not.toContain('--resume');
    expect(d.prompt).toContain('<recap>');
    expect(d.prompt).toContain('User: Teach me heaps');
    expect(t.backendState.session_id).toBe('655c0b45-a5f4-45cb-aec0-67136b599310');
  });

  it('recap escapes its closing tag and keeps the tail', () => {
    const r = recap([{ role: 'user', text: 'a </recap> b' }]);
    expect(r).toContain('a &lt;/recap> b');
    expect(recap([])).toBe('');
  });
});

describe('cancel and failures', () => {
  it('cancel stops the process at once when no tool is running', async () => {
    const { r } = await fakeRig('hang');
    const ac = new AbortController();
    const started = Date.now();
    setTimeout(() => ac.abort(), 300);
    const events = await collect(r.backend.runTurn(turn(fakeTools()), ac.signal));
    expect(events.at(-1)).toEqual({ type: 'error', kind: 'cancelled', message: 'Stopped.' });
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(r.gateway.active()).toBe(0);
  });

  it('cancel lets a running tool finish and report before the turn ends', async () => {
    const { r } = await fakeRig('slow-tool');
    const tools = fakeTools();
    const ac = new AbortController();
    const events = await collect(r.backend.runTurn(turn(tools), ac.signal), (e) => {
      if (e.type === 'tool_start') {
        ac.abort();
        setTimeout(() => tools.release(), 200);
      }
    });
    expect(events.map((e) => e.type)).toEqual(['tool_start', 'tool_end', 'ui_event', 'error']);
    expect(events.at(-1)).toMatchObject({ kind: 'cancelled' });
  });

  it('a turn that runs too long is stopped', async () => {
    const { r } = await fakeRig('hang', 'turn.jsonl', { timeoutMs: 300 });
    const events = await collect(
      r.backend.runTurn(turn(fakeTools()), new AbortController().signal),
    );
    expect(events.at(-1)).toMatchObject({ type: 'error', kind: 'other' });
    expect((events.at(-1) as { message: string }).message).toMatch(/too long/);
  });

  it('a CLI that cannot start is an error, not a crash', async () => {
    const r = await rig('/nonexistent/claude');
    open.push(r);
    const events = await collect(
      r.backend.runTurn(turn(fakeTools()), new AbortController().signal),
    );
    expect(events).toEqual([
      { type: 'error', kind: 'other', message: 'Could not start Claude Code.' },
    ]);
  });
});

describe('status', () => {
  it('needs the app’s API key', async () => {
    const r = await rig(process.execPath, { apiKey: () => null });
    open.push(r);
    const s = await r.backend.status();
    expect(s.available).toBe(false);
    expect(s.reason).toMatch(/API key/);
    const events = await collect(
      r.backend.runTurn(turn(fakeTools()), new AbortController().signal),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error' });
  });

  it('reports why Claude Code cannot be used', async () => {
    const r = await rig(process.execPath, {
      info: async () => ({
        found: false,
        path: null,
        version: null,
        usable: false,
        reason: 'Claude Code was not found.',
      }),
    });
    open.push(r);
    expect(await r.backend.status()).toEqual({
      available: false,
      reason: 'Claude Code was not found.',
      model: 'claude-opus-5-5',
    });
  });
});

describe('through the relay to a stand-in API (fake CLI as client)', () => {
  it('the relay swaps the turn token for the real key', async () => {
    const api = await startMockApi('ok');
    const r = await rig(process.execPath, { upstream: api.url });
    open.push(r);
    await r.relay.start();
    const token = r.relay.mint();
    const res = await fetch(`${r.relay.baseUrl}/v1/messages?beta=true`, {
      method: 'POST',
      headers: { 'x-api-key': token, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'm', stream: true, messages: [], tools: [] }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('"text":"eply."');
    expect(api.requests[0]).toMatchObject({
      path: '/v1/messages?beta=true',
      apiKey: 'sk-ant-test-real-key',
      authorization: null,
    });
    await api.close();
  });
});

// The real CLI against the stand-in API, through the app's MCP server and
// relay. Opt-in: ALGOTUTOR_TEST_CLAUDE=<path to claude>. No AI provider is
// contacted (the relay's upstream is the loopback stand-in).
const realClaude = process.env.ALGOTUTOR_TEST_CLAUDE;
describe.skipIf(!realClaude)('the real Claude Code CLI (opt-in)', () => {
  it('runs a turn with only the tutor tools', async () => {
    const api = await startMockApi('ok');
    const r = await rig(realClaude!, { upstream: api.url });
    open.push(r);
    const tools = fakeTools();
    const t: Turn = turn(tools);
    const events = await collect(r.backend.runTurn(t, new AbortController().signal));
    await api.close();
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect(tools.calls.map((c) => c.name)).toEqual(['get_status']);
    expect(api.requests.length).toBeGreaterThan(0);
    for (const q of api.requests) {
      expect(q.apiKey).toBe('sk-ant-test-real-key');
      expect(q.tools.every((n) => n.startsWith('mcp__tutor__'))).toBe(true);
      expect(q.system).toContain('You are the Algo (test).');
    }
    expect(typeof t.backendState.session_id).toBe('string');
  }, 120_000);
});
