/**
 * Claude Code's `--output-format stream-json` lines into chat events. Ported
 * from `dsa-tutor/dsa_tutor/backends/claude_code.py` (`StreamJsonParser`) and
 * checked against Claude Code 2.1.328 (fixtures in `fixtures/`).
 *
 * Lines seen:
 *
 * - `{"type":"system","subtype":"init","session_id":…,"tools":[…],"mcp_servers":[…]}`;
 *   other `system` subtypes (`status`, `ui_invalidate`, …) are ignored.
 * - `{"type":"stream_event","event":{…Messages API stream event…}}` (with
 *   `--include-partial-messages`): `text_delta`s are the reply as it streams.
 * - `{"type":"assistant","message":{…}}`: a whole assistant message. Its text
 *   is used only if none of it was streamed. An `error` field (e.g.
 *   `authentication_failed`) marks a failed request.
 * - `{"type":"system","subtype":"api_retry","attempt":n,"error_status":401,…}`:
 *   the CLI retries a failed request. Auth failures end the turn at once
 *   (the CLI would retry them for minutes); rate limits after a few attempts.
 * - `{"type":"user",…}`: tool results going back to the model. Ignored: the
 *   MCP server already reported the tool (the CLI's own `tool_use` blocks are
 *   ignored for the same reason).
 * - `{"type":"result","subtype":"success"|"error_…","is_error":…,"session_id":…}`:
 *   the end of the turn.
 */
import { chatError, done, textDelta, type ChatEvent, type ErrorKind } from '@algo/core';

/** Rate-limit retries waited out before the turn ends with an error. */
export const RETRIES_SHOWN = 3;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The last line of `text`, trimmed to `limit`, with anything key-like removed. */
export function tail(text: string, limit = 300): string {
  const clean = redact(text.trim());
  if (!clean) return '';
  const last = clean.split(/\r?\n/).at(-1)!;
  return ' ' + (last.length <= limit ? last : `${last.slice(0, limit - 3)}...`);
}

/** Removes Anthropic keys, the relay's turn tokens and bearer values. */
export function redact(text: string): string {
  return text
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-…')
    .replace(/algotutor-[A-Za-z0-9_-]+/g, 'algotutor-…')
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1…');
}

export class StreamJsonParser {
  /** Saved in the thread's backend state when the turn ends (`session_id`). */
  readonly state: Record<string, string> = {};
  /** The CLI produced recognisable output (decides whether a failed resume is retried). */
  started = false;
  result: Obj | null = null;
  /** Tools the CLI reported in its `init` line. */
  tools: string[] | null = null;
  private readonly streamed = new Set<string>();
  private current: string | null = null;
  private error: string | null = null;
  private stop: string | null = null;
  private lastTextId: string | null = null;

  feed(line: string): ChatEvent[] {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      return [];
    }
    if (!isObj(event)) return [];
    const kind = event.type;
    if (str(event.session_id) && (kind === 'system' || kind === 'result' || kind === 'assistant'))
      this.state.session_id = str(event.session_id);
    switch (kind) {
      case 'system':
        if (event.subtype === 'init') {
          this.started = true;
          if (Array.isArray(event.tools)) this.tools = event.tools.map(String);
        } else if (event.subtype === 'api_retry') return this.retry(event);
        return [];
      case 'stream_event':
        this.started = true;
        return this.streamEvent(isObj(event.event) ? event.event : {});
      case 'assistant':
        this.started = true;
        return this.assistant(event);
      case 'result':
        // Not `started`: a failed --resume ends with only this line.
        this.result = event;
        return [];
      default:
        return [];
    }
  }

  private retry(event: Obj): ChatEvent[] {
    const status = typeof event.error_status === 'number' ? event.error_status : null;
    const err = str(event.error);
    if (status === 401 || status === 403 || err === 'authentication_failed')
      return [classify('authentication_failed', {}, 1, '')];
    if (status === 429 || status === 529 || err === 'rate_limit' || err === 'overloaded') {
      const attempt = typeof event.attempt === 'number' ? event.attempt : 0;
      if (attempt >= RETRIES_SHOWN)
        return [
          classify(status === 529 ? null : 'rate_limit', { api_error_status: status }, 1, ''),
        ];
    }
    return [];
  }

  private streamEvent(ev: Obj): ChatEvent[] {
    if (ev.type === 'message_start') {
      this.current = isObj(ev.message) ? str(ev.message.id) || null : null;
    } else if (ev.type === 'content_block_delta') {
      const delta = isObj(ev.delta) ? ev.delta : {};
      if (delta.type === 'text_delta' && str(delta.text)) {
        if (this.current) this.streamed.add(this.current);
        return [this.text(str(delta.text))];
      }
    } else if (ev.type === 'message_delta') {
      const stop = isObj(ev.delta) ? str(ev.delta.stop_reason) : '';
      if (stop) this.stop = stop;
    }
    return [];
  }

  private assistant(event: Obj): ChatEvent[] {
    const message = isObj(event.message) ? event.message : {};
    if (event.error) this.error = str(event.error) || 'unknown';
    if (str(message.stop_reason)) this.stop = str(message.stop_reason);
    const id = str(message.id);
    if ((id && this.streamed.has(id)) || event.error) return [];
    const out: ChatEvent[] = [];
    for (const block of Array.isArray(message.content) ? message.content : [])
      if (isObj(block) && block.type === 'text' && str(block.text))
        out.push(this.text(str(block.text), id || '?'));
    return out;
  }

  /** A text delta; text from a later assistant message starts a new paragraph. */
  private text(text: string, messageId?: string): ChatEvent {
    const id = messageId ?? this.current;
    let out = text;
    if (this.lastTextId !== null && id !== this.lastTextId) out = '\n\n' + text.replace(/^\n+/, '');
    this.lastTextId = id;
    return textDelta(out);
  }

  /** The turn's last event, once the process has exited. */
  finish(exitCode: number | null, stderr: string): ChatEvent {
    const result = this.result ?? {};
    if (this.stop === 'refusal')
      return chatError('refusal', 'The model declined to answer that. Try rephrasing.');
    if (this.error || result.is_error === true || (!this.result && exitCode !== 0))
      return classify(this.error, result, exitCode, stderr);
    const subtype = str(result.subtype);
    if (subtype && subtype !== 'success') return classify(this.error, result, exitCode, stderr);
    if (!this.result)
      return chatError('other', 'Claude Code stopped without finishing its reply.' + tail(stderr));
    if (this.stop === 'max_tokens' || result.stop_reason === 'max_tokens')
      return chatError('max_tokens', 'The reply was cut off because it was too long.');
    return done(str(result.stop_reason) || this.stop || 'end_turn');
  }
}

/** The error event for a failed Claude Code run. Never includes a credential. */
export function classify(
  err: string | null,
  result: Obj,
  exitCode: number | null,
  stderr: string,
): ChatEvent {
  const status = typeof result.api_error_status === 'number' ? result.api_error_status : null;
  const errors = Array.isArray(result.errors) ? result.errors.map(String).join(' ') : '';
  const text = [err ?? '', str(result.result), errors, stderr.slice(-2000)].join(' ').toLowerCase();
  const out = (kind: ErrorKind, message: string): ChatEvent => chatError(kind, message);
  if (
    err === 'authentication_failed' ||
    status === 401 ||
    status === 403 ||
    text.includes('invalid api key') ||
    text.includes('authentication')
  )
    return out(
      'auth',
      'The Anthropic API did not accept the API key. Check it in Settings → Tutor.',
    );
  if (err === 'rate_limit' || status === 429 || text.includes('rate limit'))
    return out('rate_limit', 'The API rate limit was reached. Wait a little and try again.');
  if (status === 529 || text.includes('overloaded'))
    return out('rate_limit', 'The model is overloaded right now. Try again in a minute.');
  if (result.subtype === 'error_max_turns')
    return out('other', 'The tutor used too many steps on this message. Try a narrower question.');
  if (err) return out('other', `Claude Code reported an error (${redact(err)}).`);
  if (result.is_error === true && str(result.result))
    return out('other', 'Claude Code failed:' + tail(str(result.result)));
  return out('other', `Claude Code exited with status ${String(exitCode)}.` + tail(stderr));
}
