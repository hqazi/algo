/**
 * The tutor's MCP server (SPEC §7.3, T11): the tool registry served to the
 * Claude Code CLI over MCP's Streamable HTTP transport, on loopback, one
 * grant per turn (`gateway.ts`). Ported from `dsa-tutor/dsa_tutor/server/mcp.py`.
 *
 * A small hand-written server instead of `@modelcontextprotocol/sdk`
 * (DECISIONS D-25): the tutor needs only the stateless, JSON-response subset
 * of the transport (no sessions, no server-to-client stream, no resources or
 * prompts), and the SDK would bring Express, Hono and a dozen more packages
 * into the main process. What it implements:
 *
 * - `POST /mcp` with one JSON-RPC message per request (batches were removed
 *   from the protocol in 2025-06-18). Requests get an `application/json`
 *   response; notifications and responses get `202 Accepted`.
 * - Methods: `initialize` (version negotiation: the client's version if it is
 *   one of `PROTOCOL_VERSIONS`, else the newest), `ping`, `tools/list`,
 *   `tools/call`. Others are `-32601`.
 * - `GET` (the optional server-to-client stream) and `DELETE` (session end)
 *   are `405`: the server is stateless.
 *
 * Access rules, checked on every request before the body is read:
 *
 * - the peer address is loopback;
 * - `Host` names a loopback host and `Origin`, if sent, is a loopback origin
 *   (DNS rebinding protection, as the transport requires);
 * - `Authorization: Bearer <token>` names a live grant, else `401`.
 *
 * The tool handler looks the token up again when the call runs, so a call is
 * never run on a grant that ended while its body was arriving.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { resultEvents, stringifyJson, toolStart, type ToolResult } from '@algorithm-tutor/core';
import { bearer, type Binding, type McpGateway } from './gateway';

export const MCP_PATH = '/mcp';
/** Claude Code names the tools `mcp__tutor__<tool>`. */
export const SERVER_NAME = 'tutor';
/** Newest first. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;
export const MAX_BODY = 1024 * 1024;
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

type Json = Record<string, unknown>;
type Id = string | number;

export interface McpServerOptions {
  gateway: McpGateway;
  version: string;
  /** Problems without secrets or tool data. */
  log?: (message: string) => void;
}

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

function hostIsLoopback(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  return LOOPBACK_HOSTS.has(name!.toLowerCase());
}

function originIsLoopback(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    const u = new URL(origin);
    return u.protocol === 'http:' && hostIsLoopback(u.host);
  } catch {
    return false;
  }
}

function send(res: ServerResponse, status: number, body?: Json, headers: Json = {}): void {
  const text = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(text);
}

function refuse(res: ServerResponse, status: number, code: string, error: string): void {
  send(
    res,
    status,
    { ok: false, error, code },
    status === 401 ? { 'www-authenticate': 'Bearer error="invalid_token"' } : {},
  );
}

async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const rpcResult = (id: Id, result: Json): Json => ({ jsonrpc: '2.0', id, result });
const rpcError = (id: Id | null, code: number, message: string): Json => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
});

export class McpServer {
  private server: Server | null = null;

  constructor(private readonly opts: McpServerOptions) {}

  get gateway(): McpGateway {
    return this.opts.gateway;
  }

  /** Listens on `127.0.0.1` (a free port unless given) and sets `gateway.baseUrl`. */
  async start(port = 0): Promise<string> {
    if (this.server) return this.opts.gateway.baseUrl!;
    const server = createServer((req, res) => {
      this.handle(req, res).catch((e: unknown) => {
        this.opts.log?.(`mcp: request failed (${e instanceof Error ? e.name : 'error'})`);
        if (!res.headersSent) refuse(res, 500, 'internal', 'the request failed');
        else res.destroy();
      });
    });
    server.requestTimeout = 60_000;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve());
    });
    this.server = server;
    const { port: bound } = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${bound}${MCP_PATH}`;
    this.opts.gateway.baseUrl = url;
    return url;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.opts.gateway.baseUrl = null;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!LOOPBACK_ADDRESSES.has(req.socket.remoteAddress ?? ''))
      return refuse(res, 403, 'forbidden', 'the MCP server only serves this computer');
    if (!hostIsLoopback(req.headers.host) || !originIsLoopback(req.headers.origin))
      return refuse(res, 403, 'forbidden', 'host or origin not allowed');
    const path = (req.url ?? '').split('?')[0];
    if (path !== MCP_PATH) return refuse(res, 404, 'not_found', 'not found');
    if (this.opts.gateway.lookup(bearer(req.headers.authorization)) === null)
      return refuse(res, 401, 'unauthorized', 'missing, wrong or expired MCP token');
    if (req.method !== 'POST') {
      return send(res, 405, undefined, { allow: 'POST' });
    }
    const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (type !== 'application/json')
      return refuse(res, 415, 'unsupported_media_type', 'send application/json');
    const text = await readBody(req);
    if (text === null) return refuse(res, 413, 'too_large', 'request too large');

    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      return send(res, 400, rpcError(null, -32700, 'Parse error'));
    }
    if (typeof message !== 'object' || message === null || Array.isArray(message))
      return send(res, 400, rpcError(null, -32600, 'Invalid Request'));
    const msg = message as Json;
    const hasId = typeof msg.id === 'string' || typeof msg.id === 'number';
    if (msg.jsonrpc !== '2.0')
      return send(res, 400, rpcError(hasId ? (msg.id as Id) : null, -32600, 'Invalid Request'));
    // Notifications (no id) and responses (no method): accepted, nothing to answer.
    if (!hasId || typeof msg.method !== 'string') return send(res, 202);

    const id = msg.id as Id;
    try {
      const result = await this.dispatch(msg.method, msg.params, bearer(req.headers.authorization));
      send(res, 200, rpcResult(id, result));
    } catch (e) {
      if (e instanceof RpcError) send(res, 200, rpcError(id, e.code, e.message));
      else throw e;
    }
  }

  private async dispatch(method: string, params: unknown, token: string | null): Promise<Json> {
    const p: Json = typeof params === 'object' && params !== null ? (params as Json) : {};
    switch (method) {
      case 'initialize': {
        const asked = typeof p.protocolVersion === 'string' ? p.protocolVersion : '';
        const version = (PROTOCOL_VERSIONS as readonly string[]).includes(asked)
          ? asked
          : PROTOCOL_VERSIONS[0];
        return {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: {
            name: SERVER_NAME,
            title: 'Algorithm Tutor tools',
            version: this.opts.version,
          },
          instructions:
            "The algorithm tutor's tools. Use them to read and change the learner's progress.",
        };
      }
      case 'ping':
        return {};
      case 'tools/list': {
        const binding = this.opts.gateway.lookup(token);
        return { tools: binding ? binding.tools.mcpTools() : [] };
      }
      case 'tools/call':
        return this.callTool(p, token);
      default:
        throw new RpcError(-32601, `Method not found: ${method}`);
    }
  }

  private async callTool(p: Json, token: string | null): Promise<Json> {
    const reply = (output: Json): Json => ({
      content: [{ type: 'text', text: stringifyJson(output) }],
      isError: output.ok !== true,
    });
    const binding: Binding | null = this.opts.gateway.lookup(token);
    if (!binding)
      return reply({ ok: false, error: 'this MCP token is no longer valid', code: 'unauthorized' });
    const name = typeof p.name === 'string' ? p.name : '';
    if (!binding.tools.names().includes(name))
      throw new RpcError(-32602, `Unknown tool: ${name || '(none)'}`);
    const args = p.arguments ?? {};
    const toolId = `mcp_${randomUUID()}`;
    binding.emit(toolStart(toolId, name, binding.tools.startSummary(name)));
    // `call` validates the arguments and never rejects.
    const result: ToolResult = await binding.tools.call(name, args);
    for (const event of resultEvents(toolId, result)) binding.emit(event);
    return reply(result.output);
  }
}
