import { request } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatEvent } from '@algorithm-tutor/core';
import { fakeTools, type FakeTools } from '../tutor/claude-code/fixtures/harness';
import { bearer, McpGateway } from './gateway';
import { McpServer, PROTOCOL_VERSIONS } from './server';

let now = 0;
let gateway: McpGateway;
let server: McpServer;
let url: string;
let tools: FakeTools;
let events: ChatEvent[];
let token: string;

beforeEach(async () => {
  now = 0;
  gateway = new McpGateway({ clock: () => now, ttlMs: 1_000 });
  server = new McpServer({ gateway, version: '1.2.3' });
  url = await server.start();
  tools = fakeTools();
  events = [];
  token = gateway.mint('home', tools, (e) => events.push(e)).token;
});
afterEach(async () => {
  await server.stop();
});

async function rpc(
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

/** A raw request, to send a `Host` header `fetch` would not. */
function raw(headers: Record<string, string>): Promise<number> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request(
      { host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.end('{}');
  });
}

describe('the MCP server', () => {
  it('negotiates the protocol version', async () => {
    const init = (v: string) =>
      rpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: v, capabilities: {}, clientInfo: { name: 't', version: '0' } },
      });
    const ok = await init('2025-06-18');
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'tutor', version: '1.2.3' },
      },
    });
    const other = await init('1999-01-01');
    expect((other.json!.result as { protocolVersion: string }).protocolVersion).toBe(
      PROTOCOL_VERSIONS[0],
    );
  });

  it('accepts notifications with 202 and answers ping', async () => {
    expect((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
    expect((await rpc({ jsonrpc: '2.0', id: 'p', method: 'ping' })).json).toEqual({
      jsonrpc: '2.0',
      id: 'p',
      result: {},
    });
  });

  it('lists the turn’s tools', async () => {
    const { json } = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const list = (json!.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(list).toEqual(['get_status', 'slow_tool']);
  });

  it('runs a tool and feeds its events to the turn', async () => {
    const { json } = await rpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'get_status', arguments: {} },
    });
    const result = json!.result as { content: { type: string; text: string }[]; isError: boolean };
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({ ok: true, onboarded: false });
    expect(events.map((e) => e.type)).toEqual(['tool_start', 'tool_end', 'ui_event']);
    expect(tools.calls).toEqual([{ name: 'get_status', args: {} }]);
  });

  it('refuses unknown tools and methods', async () => {
    const t = await rpc({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'write_file', arguments: {} },
    });
    expect(t.json).toMatchObject({ id: 4, error: { code: -32602 } });
    const m = await rpc({ jsonrpc: '2.0', id: 5, method: 'resources/list' });
    expect(m.json).toMatchObject({ id: 5, error: { code: -32601 } });
    expect(tools.calls).toEqual([]);
    expect(events).toEqual([]);
  });

  it('rejects malformed messages', async () => {
    expect((await rpc('{nope')).json).toMatchObject({ error: { code: -32700 } });
    expect((await rpc([{ jsonrpc: '2.0', id: 1, method: 'ping' }])).status).toBe(400);
    expect((await rpc({ id: 1, method: 'ping' })).status).toBe(400);
    expect(
      (await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, { 'content-type': 'text/plain' }))
        .status,
    ).toBe(415);
  });

  it('needs a live token', async () => {
    const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
    expect((await rpc(ping, { authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await rpc(ping, { authorization: '' })).status).toBe(401);
    gateway.revoke(token);
    expect((await rpc(ping)).status).toBe(401);
  });

  it('a token expires even if never revoked', async () => {
    const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
    expect((await rpc(ping)).status).toBe(200);
    now = 1_000;
    expect((await rpc(ping)).status).toBe(401);
    expect(gateway.active()).toBe(0);
  });

  it('is stateless: GET and DELETE are 405', async () => {
    for (const method of ['GET', 'DELETE']) {
      const res = await fetch(url, { method, headers: { authorization: `Bearer ${token}` } });
      expect(res.status).toBe(405);
    }
  });

  it('refuses foreign Host and Origin headers (DNS rebinding)', async () => {
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    expect(await raw({ ...auth, host: 'evil.example' })).toBe(403);
    expect(await raw({ ...auth, host: `localhost:${new URL(url).port}` })).not.toBe(403);
    const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
    expect((await rpc(ping, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await rpc(ping, { origin: 'http://127.0.0.1:1234' })).status).toBe(200);
  });

  it('serves only its path', async () => {
    const res = await fetch(url.replace('/mcp', '/other'), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });

  it('a call on a grant revoked mid-request is not run', async () => {
    gateway.revoke(token);
    const again = gateway.mint('home', tools, (e) => events.push(e));
    token = again.token;
    gateway.revoke(again.token);
    const t = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_status' },
    });
    expect(t.status).toBe(401);
    expect(tools.calls).toEqual([]);
  });
});

describe('gateway', () => {
  it('needs a running server to mint', () => {
    expect(() => new McpGateway().mint('home', fakeTools(), () => undefined)).toThrow(
      /not running/,
    );
  });

  it('parses bearer headers', () => {
    expect(bearer('Bearer abc')).toBe('abc');
    expect(bearer('bearer  abc ')).toBe('abc');
    expect(bearer('Basic abc')).toBeNull();
    expect(bearer(undefined)).toBeNull();
    expect(bearer('Bearer ')).toBeNull();
  });

  it('tokens are long and random', () => {
    const g = new McpGateway();
    g.baseUrl = 'http://127.0.0.1:1/mcp';
    const a = g.mint('home', fakeTools(), () => undefined).token;
    const b = g.mint('home', fakeTools(), () => undefined).token;
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
  });
});
