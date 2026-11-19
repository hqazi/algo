/**
 * Test and recording helpers: a Claude Code backend wired to a real MCP
 * server and relay on loopback, with a small fake tool set. Not used by the
 * app.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolResult, Turn, TurnTools } from '@algorithm-tutor/core';
import { McpGateway } from '../../../mcp/gateway';
import { McpServer } from '../../../mcp/server';
import { ApiProxy } from '../api-proxy';
import { ClaudeCodeBackend, type ClaudeCodeOptions } from '../backend';
import type { ClaudeCodeInfo } from '../detect';

export const STATUS_OUTPUT = { ok: true, onboarded: false, topics: [], untouched_topics: 15 };

export interface FakeTools extends TurnTools {
  calls: { name: string; args: unknown }[];
  /** Resolves a call that waits (`slow_tool`). */
  release(): void;
}

export function fakeTools(): FakeTools {
  const calls: { name: string; args: unknown }[] = [];
  let release: () => void = () => undefined;
  const schema = { type: 'object', properties: {}, additionalProperties: false };
  const defs = [
    { name: 'get_status', title: 'Get status', start: 'Reading your progress' },
    { name: 'slow_tool', title: 'Slow tool', start: 'Working' },
  ];
  return {
    calls,
    release: () => release(),
    names: () => defs.map((d) => d.name),
    startSummary: (name) => defs.find((d) => d.name === name)?.start ?? name,
    async call(name, args): Promise<ToolResult> {
      calls.push({ name, args });
      if (name === 'slow_tool') await new Promise<void>((r) => (release = r));
      return {
        name,
        output: name === 'get_status' ? STATUS_OUTPUT : { ok: true },
        summary: name === 'get_status' ? 'Not started yet' : 'Done',
        ui: [{ type: 'ui', action: 'refresh_state' }],
      };
    },
    anthropicTools: () => [],
    mcpTools: () =>
      defs.map((d) => ({
        name: d.name,
        title: d.title,
        description: d.title,
        inputSchema: schema,
        annotations: {
          title: d.title,
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      })),
  };
}

export function turn(tools: TurnTools, over: Partial<Turn> = {}): Turn {
  return {
    threadId: 'home',
    systemPrompt: 'You are the Algorithm Tutor (test).',
    history: [],
    userText: 'How am I doing?',
    context: {},
    tools,
    backendState: {},
    ...over,
  };
}

export interface Rig {
  backend: ClaudeCodeBackend;
  gateway: McpGateway;
  mcp: McpServer;
  relay: ApiProxy;
  home: string;
  close(): Promise<void>;
}

export async function rig(
  exe: string,
  over: Partial<ClaudeCodeOptions> & { upstream?: string; apiKey?: () => string | null } = {},
): Promise<Rig> {
  const gateway = new McpGateway();
  const mcp = new McpServer({ gateway, version: '0.0.0-test' });
  const relay = new ApiProxy({
    apiKey: over.apiKey ?? (() => 'sk-ant-test-real-key'),
    upstream: () => over.upstream ?? 'http://127.0.0.1:9',
  });
  const home = over.home ?? (await mkdtemp(join(tmpdir(), 'cc-home-')));
  const info: ClaudeCodeInfo = {
    found: true,
    path: exe,
    version: '2.1.328',
    usable: true,
    reason: null,
  };
  let ready: Promise<void> | null = null;
  const backend = new ClaudeCodeBackend({
    info: async () => info,
    gateway,
    relay,
    ready: () => (ready ??= Promise.all([mcp.start(), relay.start()]).then(() => undefined)),
    apiKey: over.apiKey ?? (() => 'sk-ant-test-real-key'),
    model: () => null,
    effort: () => 'medium',
    home,
    env: { PATH: process.env.PATH },
    ...over,
  });
  return {
    backend,
    gateway,
    mcp,
    relay,
    home,
    close: async () => {
      await mcp.stop();
      await relay.stop();
    },
  };
}
