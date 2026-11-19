/**
 * The `claude-code` tutor backend (SPEC §7.3, T11): the user's installed
 * Claude Code CLI, headless, one process per turn. Ported from
 * `dsa-tutor/dsa_tutor/backends/claude_code.py` and `agent_cli.py`.
 *
 * The CLI runs the model and the tool loop itself; the tutor tools reach it
 * over the app's MCP server (`main/mcp/`). Per turn this backend:
 *
 * 1. mints an MCP grant bound to the thread (the CLI's tool calls come back
 *    to the server, which runs them against this turn's tools and feeds their
 *    `tool_start` / `tool_end` / `ui_event` events into the turn) and a relay
 *    token (`api-proxy.ts`: the CLI's "API key", swapped for the app's real
 *    key in the main process);
 * 2. writes the system prompt and the MCP config (it holds the MCP token) to
 *    a fresh `0700` directory under `<agent home>/run/`, deleted at the end;
 * 3. spawns the CLI (`command.ts`: bare mode, no built-in tools, only the
 *    tutor tools, a minimal environment, `HOME` = the app's agent home) with
 *    `cwd` = an empty scratch directory, the prompt on stdin, in its own
 *    process group;
 * 4. turns each stdout line into chat events (`stream-json.ts`);
 * 5. on cancel, timeout or the end of the turn: kills the process group,
 *    lets a tool that is already running finish and report, revokes both
 *    tokens, removes the run directory.
 *
 * The CLI's session id is kept in the thread's backend state; the next turn
 * passes `--resume`. If that session cannot be resumed (the agent home was
 * cleared, say), the turn is retried once as a new session that starts with
 * a recap of the transcript. Tool chips and UI events come from the MCP
 * server, so the CLI's own `tool_use` blocks are ignored.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  chatError,
  renderUserMessage,
  type BackendStatus,
  type ChatEvent,
  type NeutralMessage,
  type SignalLike,
  type Turn,
  type TutorBackend,
} from '@algorithm-tutor/core';
import type { McpGateway } from '../../mcp/gateway';
import { DEFAULT_MODEL, type Effort } from '../anthropic/backend';
import type { ApiProxy } from './api-proxy';
import { buildArgs, childEnv, mcpConfig, PROMPT_SUFFIX } from './command';
import type { ClaudeCodeInfo } from './detect';
import { StreamJsonParser } from './stream-json';

export const TURN_TIMEOUT_MS = 10 * 60_000;
export const KILL_GRACE_MS = 3_000;
/** How long a cancelled turn waits for a tool that is already running. */
export const TOOL_GRACE_MS = 60_000;
export const STDERR_KEEP = 8_000;
export const LINE_LIMIT = 8 * 1024 * 1024;
const RECAP_MESSAGES = 20;
const RECAP_MESSAGE_CHARS = 1_500;
const RECAP_CHARS = 12_000;

export interface ClaudeCodeOptions {
  /** Detection, cached by the caller. */
  info: () => Promise<ClaudeCodeInfo>;
  gateway: McpGateway;
  relay: ApiProxy;
  /** Starts the MCP server and the relay (idempotent). */
  ready: () => Promise<void>;
  apiKey: () => string | null;
  model: () => string | null;
  effort: () => Effort;
  /** The app's agent home (`<data>/agent-home`). */
  home: string;
  env?: Record<string, string | undefined>;
  /** Tests: arguments put before the CLI's own (e.g. a fake CLI script for `node`). */
  prefixArgs?: string[];
  /** Tests: extra environment for the child. */
  extraEnv?: Record<string, string>;
  timeoutMs?: number;
  toolGraceMs?: number;
  log?: (message: string) => void;
}

type Item =
  | { kind: 'event'; event: ChatEvent }
  | { kind: 'line'; line: string | null }
  | { kind: 'exit'; code: number | null }
  | { kind: 'spawn_error' }
  | { kind: 'abort' }
  | { kind: 'timeout' };

/** A queue with one reader. */
class Channel<T> {
  private items: T[] = [];
  private waiter: ((v: T) => void) | null = null;

  push(item: T): void {
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(item);
    } else this.items.push(item);
  }

  next(): Promise<T> {
    const item = this.items.shift();
    if (item !== undefined) return Promise.resolve(item);
    return new Promise((resolve) => (this.waiter = resolve));
  }

  /** The next item, or `null` after `ms`. */
  async nextWithin(ms: number): Promise<T | null> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), ms)));
    const item = await Promise.race([this.next(), timeout]);
    clearTimeout(timer);
    if (item === null) this.waiter = null;
    return item;
  }
}

/** A short transcript recap for a CLI session that cannot be resumed. */
export function recap(history: NeutralMessage[]): string {
  const lines: string[] = [];
  for (const m of history.slice(-RECAP_MESSAGES)) {
    let text = (m.text ?? '').trim();
    if (!text) continue;
    if (text.length > RECAP_MESSAGE_CHARS) text = `${text.slice(0, RECAP_MESSAGE_CHARS)} ...`;
    lines.push(`${m.role === 'user' ? 'User' : 'Tutor'}: ${text}`);
  }
  let body = lines.join('\n\n');
  if (body.length > RECAP_CHARS) body = `... ${body.slice(-RECAP_CHARS)}`;
  if (!body) return '';
  return (
    '<recap>\nEarlier in this chat (for context; the tools are the source of truth for progress):\n\n' +
    body.replaceAll('</recap', '&lt;/recap') +
    '\n</recap>\n\n'
  );
}

async function writePrivate(path: string, text: string): Promise<void> {
  const fh = await open(path, 'wx', 0o600);
  try {
    await fh.writeFile(text, 'utf8');
  } finally {
    await fh.close();
  }
}

export class ClaudeCodeBackend implements TutorBackend {
  readonly id = 'claude-code' as const;
  /** Tests: the most recent command and environment. */
  lastArgs: string[] | null = null;
  lastEnv: Record<string, string> | null = null;

  constructor(private readonly opts: ClaudeCodeOptions) {}

  model(): string {
    return this.opts.model()?.trim() || DEFAULT_MODEL;
  }

  async status(): Promise<BackendStatus> {
    const model = this.model();
    const info = await this.opts.info();
    if (!info.usable)
      return { available: false, reason: info.reason ?? 'Claude Code was not found.', model };
    if (!this.opts.apiKey())
      return {
        available: false,
        reason:
          'Claude Code runs with your Anthropic API key in this app. Add the key in Settings → Tutor.',
        model,
      };
    return { available: true, reason: null, model };
  }

  async *runTurn(turn: Turn, signal: SignalLike): AsyncIterable<ChatEvent> {
    const status = await this.status();
    const info = await this.opts.info();
    if (!status.available || !info.path) {
      yield chatError('other', status.reason ?? 'Claude Code is not available.');
      return;
    }
    if (signal.aborted) {
      yield chatError('cancelled', 'Stopped.');
      return;
    }
    await this.opts.ready();
    const home = this.opts.home;
    const scratch = join(home, 'scratch');
    const runs = join(home, 'run');
    const tmp = join(home, 'tmp');
    for (const dir of [home, scratch, runs, tmp])
      await mkdir(dir, { recursive: true, mode: 0o700 });
    const rundir = await mkdtemp(join(runs, 'turn-'));

    const channel = new Channel<Item>();
    const inflight = new Set<string>();
    const emit = (event: ChatEvent): void => {
      if (event.type === 'tool_start') inflight.add(event.id);
      else if (event.type === 'tool_end') inflight.delete(event.id);
      channel.push({ kind: 'event', event });
    };
    const grant = this.opts.gateway.mint(turn.threadId, turn.tools, emit);
    const relayToken = this.opts.relay.mint();
    const onAbort = (): void => channel.push({ kind: 'abort' });
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const systemFile = join(rundir, 'system-prompt.md');
      const mcpFile = join(rundir, 'mcp.json');
      await writePrivate(systemFile, turn.systemPrompt + PROMPT_SUFFIX);
      await writePrivate(mcpFile, JSON.stringify(mcpConfig(grant.url, grant.token)));
      const message = renderUserMessage(turn.userText, turn.context);
      const state = turn.backendState;
      const session = typeof state.session_id === 'string' ? state.session_id : null;
      const attempts = session ? [session, null] : [null];
      for (const [i, resumeId] of attempts.entries()) {
        const prompt = resumeId ? message : recap(turn.history) + message;
        const parser = new StreamJsonParser();
        const args = buildArgs({
          systemPromptFile: systemFile,
          mcpConfigFile: mcpFile,
          tools: turn.tools.names(),
          model: this.model(),
          effort: this.opts.effort(),
          sessionId: resumeId,
        });
        const env = childEnv({
          parent: this.opts.env ?? process.env,
          home,
          tmp,
          relayUrl: this.opts.relay.baseUrl!,
          relayToken,
          ...(this.opts.extraEnv ? { extra: this.opts.extraEnv } : {}),
        });
        let final: ChatEvent | null = null;
        for await (const ev of this.runProcess(
          info.path,
          args,
          env,
          scratch,
          prompt,
          parser,
          channel,
          inflight,
          signal,
        )) {
          if (ev.final) final = ev.event;
          else yield ev.event;
        }
        const retry =
          resumeId !== null &&
          !parser.started &&
          i + 1 < attempts.length &&
          final?.type === 'error' &&
          !signal.aborted;
        if (retry) {
          this.opts.log?.('claude-code: could not resume the session; starting a new one');
          delete state.session_id;
          continue;
        }
        Object.assign(state, parser.state);
        if (final) yield final;
        return;
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
      this.opts.gateway.revoke(grant.token);
      this.opts.relay.revoke(relayToken);
      await rm(rundir, { recursive: true, force: true });
    }
  }

  private async *runProcess(
    exe: string,
    args: string[],
    env: Record<string, string>,
    cwd: string,
    prompt: string,
    parser: StreamJsonParser,
    channel: Channel<Item>,
    inflight: Set<string>,
    signal: SignalLike,
  ): AsyncGenerator<{ final: boolean; event: ChatEvent }> {
    const argv = [...(this.opts.prefixArgs ?? []), ...args];
    this.lastArgs = argv;
    this.lastEnv = env;
    const posix = process.platform !== 'win32';
    let child: ChildProcess;
    try {
      child = spawn(exe, argv, {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: posix,
        windowsHide: true,
      });
    } catch {
      yield { final: true, event: chatError('other', 'Could not start Claude Code.') };
      return;
    }
    let stderr = '';
    let buffer = '';
    let overlong = false;
    child.on('error', () => channel.push({ kind: 'spawn_error' }));
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      if (overlong) return;
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        channel.push({ kind: 'line', line: buffer.slice(0, nl).replace(/\r$/, '') });
        buffer = buffer.slice(nl + 1);
      }
      if (buffer.length > LINE_LIMIT) {
        overlong = true;
        channel.push({ kind: 'line', line: null });
      }
    });
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_KEEP);
    });
    child.on('close', (code) => {
      if (buffer.trim() && !overlong) channel.push({ kind: 'line', line: buffer });
      buffer = '';
      channel.push({ kind: 'exit', code });
    });
    child.stdin!.on('error', () => undefined);
    child.stdin!.end(prompt, 'utf8');
    const timer = setTimeout(
      () => channel.push({ kind: 'timeout' }),
      this.opts.timeoutMs ?? TURN_TIMEOUT_MS,
    );
    let exited = false;
    const stop = async (): Promise<void> => {
      if (exited || child.exitCode !== null || child.signalCode !== null) return;
      kill(child, 'SIGTERM', posix);
      const killer = setTimeout(() => kill(child, 'SIGKILL', posix), KILL_GRACE_MS);
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) resolve();
        else child.once('exit', () => resolve());
      });
      clearTimeout(killer);
    };

    /** After a stop: let running tools finish and report, then end with `last`. */
    const settle = async function* (last: ChatEvent, graceMs: number) {
      await stop();
      const deadline = Date.now() + graceMs;
      while (inflight.size > 0) {
        const item = await channel.nextWithin(Math.max(0, deadline - Date.now()));
        if (item === null) break;
        if (item.kind === 'event') yield { final: false, event: item.event };
      }
      // The last tool's UI events follow its `tool_end` at once.
      for (let item = await channel.nextWithin(0); item; item = await channel.nextWithin(0))
        if (item.kind === 'event') yield { final: false, event: item.event };
      yield { final: true, event: last };
    };

    try {
      if (signal.aborted) {
        yield* settle(chatError('cancelled', 'Stopped.'), 0);
        return;
      }
      for (;;) {
        const item = await channel.next();
        switch (item.kind) {
          case 'event':
            yield { final: false, event: item.event };
            break;
          case 'line': {
            if (item.line === null) {
              yield* settle(chatError('other', 'Claude Code sent an over-long line.'), 0);
              return;
            }
            if (!item.line.trim()) break;
            for (const event of parser.feed(item.line)) {
              if (event.type === 'error') {
                // The parser saw a fatal error (e.g. a rejected key): stop now.
                yield* settle(event, this.opts.toolGraceMs ?? TOOL_GRACE_MS);
                return;
              }
              yield { final: false, event };
            }
            break;
          }
          case 'spawn_error':
            exited = true;
            yield { final: true, event: chatError('other', 'Could not start Claude Code.') };
            return;
          case 'abort':
            yield* settle(
              chatError('cancelled', 'Stopped.'),
              this.opts.toolGraceMs ?? TOOL_GRACE_MS,
            );
            return;
          case 'timeout':
            yield* settle(
              chatError('other', 'The tutor took too long and was stopped.'),
              this.opts.toolGraceMs ?? TOOL_GRACE_MS,
            );
            return;
          case 'exit': {
            exited = true;
            // Tool events that raced the end of stdout.
            for (let more = await channel.nextWithin(0); more; more = await channel.nextWithin(0))
              if (more.kind === 'event') yield { final: false, event: more.event };
            yield { final: true, event: parser.finish(item.code, stderr) };
            return;
          }
        }
      }
    } finally {
      clearTimeout(timer);
      await stop();
    }
  }
}

function kill(child: ChildProcess, sig: NodeJS.Signals, posix: boolean): void {
  try {
    if (posix && child.pid) process.kill(-child.pid, sig);
    else child.kill(sig);
  } catch {
    try {
      child.kill(sig);
    } catch {
      // already gone
    }
  }
}
