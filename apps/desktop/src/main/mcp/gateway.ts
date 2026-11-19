/**
 * Per-turn grants for the tutor's MCP server (SPEC §7.3, T11). Ported from
 * `dsa-tutor/dsa_tutor/server/mcp.py` (`McpGateway`).
 *
 *   const grant = gateway.mint(threadId, tools, emit);   // before spawning the agent
 *   grant.url, grant.token                               // handed to the agent
 *   gateway.revoke(grant.token);                         // when the turn ends
 *
 * A grant binds every call made with its token to one turn: the tool runs
 * against that turn's tools, and its `tool_start` / `tool_end` / `ui_event`
 * events go to that turn's `emit`, so the UI sees the same chips and UI
 * actions as with the API backend. Tokens are random (32 bytes), kept only
 * as SHA-256 hashes, expire after `ttl` even if never revoked, and never
 * appear in a log line or on a command line.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { ChatEvent, TurnTools } from '@algorithm-tutor/core';

/** Longer than any turn (the Claude Code backend stops a turn after 10 minutes). */
export const DEFAULT_TTL_MS = 15 * 60_000;

export interface McpGrant {
  token: string;
  url: string;
  threadId: string;
  expires: number;
}

export interface Binding {
  threadId: string;
  tools: TurnTools;
  emit: (event: ChatEvent) => void;
  expires: number;
}

export interface GatewayOptions {
  ttlMs?: number;
  /** Milliseconds, monotonic is fine. */
  clock?: () => number;
}

const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

export class McpGateway {
  private readonly grants = new Map<string, Binding>();
  private readonly ttl: number;
  private readonly clock: () => number;
  /** The server's URL once it listens (`McpServer.start`). */
  baseUrl: string | null = null;

  constructor(opts: GatewayOptions = {}) {
    this.ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.clock = opts.clock ?? (() => performance.now());
  }

  mint(
    threadId: string,
    tools: TurnTools,
    emit: (event: ChatEvent) => void,
    ttlMs?: number,
  ): McpGrant {
    if (!this.baseUrl) throw new Error('the MCP server is not running');
    this.prune();
    const token = randomBytes(32).toString('base64url');
    const expires = this.clock() + (ttlMs ?? this.ttl);
    this.grants.set(hash(token), { threadId, tools, emit, expires });
    return { token, url: this.baseUrl, threadId, expires };
  }

  revoke(token: string): void {
    this.grants.delete(hash(token));
  }

  /** The live binding for `token`, or `null` (unknown, revoked or expired). */
  lookup(token: string | null | undefined): Binding | null {
    if (!token) return null;
    const key = hash(token);
    const binding = this.grants.get(key);
    if (!binding) return null;
    if (this.clock() >= binding.expires) {
      this.grants.delete(key);
      return null;
    }
    return binding;
  }

  active(): number {
    this.prune();
    return this.grants.size;
  }

  private prune(): void {
    const now = this.clock();
    for (const [key, b] of this.grants) if (now >= b.expires) this.grants.delete(key);
  }
}

/** The token in `Authorization: Bearer <token>`, or `null`. */
export function bearer(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || value.slice(0, 7).toLowerCase() !== 'bearer ') return null;
  return value.slice(7).trim() || null;
}
