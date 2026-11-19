/**
 * A loopback relay to the Anthropic API for the Claude Code CLI (T11,
 * DECISIONS D-25): the API key stays in the main process (SPEC §4.4).
 *
 * The CLI is started with `ANTHROPIC_BASE_URL` set to this relay and
 * `ANTHROPIC_API_KEY` set to a random per-turn token. The relay accepts a
 * request only when
 *
 * - it comes from loopback with a loopback `Host`,
 * - it carries a live turn token (as `x-api-key` or `Authorization: Bearer`),
 * - it is `POST /v1/messages` or `POST /v1/messages/count_tokens` (any query),
 *
 * then forwards it to the real API with the app's key in place of the token,
 * and streams the answer back unchanged. Anything else is refused in the
 * API's own error shape, so the CLI reports it as it would an API error.
 * Tokens are kept as SHA-256 hashes and revoked when the turn ends.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';

export const DEFAULT_UPSTREAM = 'https://api.anthropic.com';
export const MAX_REQUEST = 32 * 1024 * 1024;
const PATHS = new Set(['/v1/messages', '/v1/messages/count_tokens']);
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
/** Request headers not forwarded: hop-by-hop, the credential, and ones `fetch` sets. */
const DROP_REQUEST = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-authorization',
  'proxy-connection',
  'content-length',
  'accept-encoding',
  'x-api-key',
  'authorization',
  'cookie',
]);
/** Response headers not returned (`fetch` already decoded the body). */
const DROP_RESPONSE = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-encoding',
  'content-length',
  'set-cookie',
]);

export interface ApiProxyOptions {
  /** The key now, or `null`. */
  apiKey: () => string | null;
  /** The API's base URL (default `ANTHROPIC_BASE_URL`, else the real API). */
  upstream?: () => string;
  fetch?: typeof fetch;
  log?: (message: string) => void;
}

const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

function apiError(res: ServerResponse, status: number, type: string, message: string): void {
  const body = JSON.stringify({ type: 'error', error: { type, message } });
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function tokenOf(req: IncomingMessage): string | null {
  const key = req.headers['x-api-key'];
  if (typeof key === 'string' && key.trim()) return key.trim();
  const auth = req.headers.authorization;
  if (auth && auth.slice(0, 7).toLowerCase() === 'bearer ') return auth.slice(7).trim() || null;
  return null;
}

export class ApiProxy {
  private server: Server | null = null;
  private readonly tokens = new Set<string>();
  private url: string | null = null;

  constructor(private readonly opts: ApiProxyOptions) {}

  get baseUrl(): string | null {
    return this.url;
  }

  async start(): Promise<string> {
    if (this.server) return this.url!;
    const server = createServer((req, res) => {
      this.handle(req, res).catch(() => {
        // Never log the error itself: it could quote a header.
        this.opts.log?.('claude-code relay: a request failed');
        if (!res.headersSent) apiError(res, 502, 'api_error', 'The relay could not reach the API.');
        else res.destroy();
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    this.server = server;
    this.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return this.url;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.url = null;
    this.tokens.clear();
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** A token for one turn; give it to the CLI as its API key. */
  mint(): string {
    const token = `algotutor-${randomBytes(32).toString('base64url')}`;
    this.tokens.add(hash(token));
    return token;
  }

  revoke(token: string): void {
    this.tokens.delete(hash(token));
  }

  active(): number {
    return this.tokens.size;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = (req.headers.host ?? '').toLowerCase();
    if (
      !LOOPBACK_ADDRESSES.has(req.socket.remoteAddress ?? '') ||
      !(host.startsWith('127.0.0.1:') || host.startsWith('localhost:') || host === '127.0.0.1')
    )
      return apiError(res, 403, 'permission_error', 'Only this computer may use the relay.');
    const token = tokenOf(req);
    if (!token || !this.tokens.has(hash(token)))
      return apiError(res, 401, 'authentication_error', 'This tutor turn has ended.');
    const url = new URL(req.url ?? '/', 'http://relay');
    if (req.method !== 'POST' || !PATHS.has(url.pathname))
      return apiError(
        res,
        404,
        'not_found_error',
        'The relay only forwards Messages API requests.',
      );
    const key = this.opts.apiKey();
    if (!key)
      return apiError(res, 401, 'authentication_error', 'No Anthropic API key is set in the app.');

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > MAX_REQUEST)
        return apiError(res, 413, 'request_too_large', 'The request is too large.');
      chunks.push(chunk);
    }

    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (DROP_REQUEST.has(name) || value === undefined) continue;
      headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    headers.set('x-api-key', key);
    const upstream = (this.opts.upstream?.() ?? DEFAULT_UPSTREAM).replace(/\/+$/, '');
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    const answer = await (this.opts.fetch ?? fetch)(`${upstream}${url.pathname}${url.search}`, {
      method: 'POST',
      headers,
      body: Buffer.concat(chunks),
      signal: abort.signal,
      redirect: 'error',
    });
    const out: Record<string, string> = {};
    answer.headers.forEach((value, name) => {
      if (!DROP_RESPONSE.has(name)) out[name] = value;
    });
    res.writeHead(answer.status, out);
    if (!answer.body) {
      res.end();
      return;
    }
    const body = Readable.fromWeb(answer.body as import('node:stream/web').ReadableStream);
    body.on('error', () => res.destroy());
    body.pipe(res);
  }
}
