/**
 * The `anthropic` tutor backend (SPEC §7.3): the Messages API through
 * `@anthropic-ai/sdk`, streamed, with the tutor tools as client tools and the
 * tool loop run here. Ported from `dsa-tutor/dsa_tutor/backends/anthropic.py`;
 * every behaviour note was checked again against the current API docs and
 * the installed SDK (DECISIONS D-23).
 *
 * How a turn runs:
 *
 * 1. The API transcript lives in `backendState.messages`, exactly as sent and
 *    received. It is append-only: earlier messages are never edited or
 *    removed, and assistant content blocks (thinking blocks included) are
 *    replayed unchanged, because the API checks thinking blocks against the
 *    conversation that produced them. A thread without that state (new, or
 *    last used with another backend) is seeded from the neutral transcript
 *    as plain text.
 * 2. The user turn is the per-turn context block plus the user's text. The
 *    tools and the system prompt come first and carry a cache breakpoint
 *    (render order is tools → system → messages); top-level automatic
 *    caching covers the growing conversation.
 * 3. Every request streams. Text deltas go straight to the UI. `stop_reason`
 *    is checked before any content is used: `refusal` ends the turn with an
 *    `error` (that reply is not kept), `max_tokens` never runs a possibly
 *    truncated tool call, `pause_turn` continues.
 * 4. Tool calls run through the registry, which validates every input
 *    against the tool's schema before the handler runs (needed because tool
 *    inputs stream eagerly and the server does not validate them). Results go
 *    back as one user message with every `tool_result`; the loop continues.
 * 5. SDK errors are caught by class and become `error` events with a
 *    readable message; the API key never appears in one.
 *
 * Cancel: the signal aborts the HTTP stream. A tool that is already running
 * finishes (it may have changed state) and its result is recorded, so the
 * transcript stays valid; then the turn ends as `cancelled`.
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  chatError,
  done,
  renderUserMessage,
  resultEvents,
  stringifyJson,
  textDelta,
  toolStart,
  type BackendStatus,
  type ChatEvent,
  type JsonValue,
  type NeutralMessage,
  type SignalLike,
  type ToolOutput,
  type Turn,
  type TutorBackend,
} from '@algo/core';

type Beta = Anthropic.Beta.Messages.MessageCreateParamsStreaming;
type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ContentBlock = Record<string, unknown> & { type: string };

/** DECISIONS D-23: the current Opus, never date-suffixed. */
export const DEFAULT_MODEL = 'claude-opus-5-5';
export const EFFORTS = ['low', 'medium', 'high'] as const;
export type Effort = (typeof EFFORTS)[number];
export const MAX_TOKENS = 64_000;
/** Model requests per user turn. */
export const MAX_ROUNDS = 24;
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/** Models that take server-side refusal fallback (`fallbacks: "default"`). */
export const FALLBACK_MODELS = [
  'claude-fable-5-2',
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
];
/** Dropped before the last `fallback` block when echoing a turn (the declined attempt's model-internal blocks). */
const PRE_FALLBACK_DROP = new Set(['thinking', 'redacted_thinking', 'tool_use', 'server_tool_use']);
const CACHE = { type: 'ephemeral' } as const;

/** The part of the SDK client this backend uses (tests pass a fake). */
export interface MessagesClient {
  beta: {
    messages: {
      stream(
        params: Beta,
        options?: { signal?: AbortSignal },
      ): AsyncIterable<Anthropic.Beta.Messages.BetaRawMessageStreamEvent> & {
        finalMessage(): Promise<Anthropic.Beta.Messages.BetaMessage>;
      };
    };
  };
}

export interface AnthropicOptions {
  /** The key now (settings or environment); `null` if none. Read for every turn. */
  apiKey: () => string | null;
  /** The configured model, or `null` for `DEFAULT_MODEL`. */
  model: () => string | null;
  effort: () => Effort;
  /** Builds the client for a key; defaults to the SDK's. */
  client?: (apiKey: string) => MessagesClient;
  maxTokens?: number;
  /** Warnings without secrets or message text. */
  log?: (message: string) => void;
  /**
   * Checks a key and model with one request that spends no tokens
   * (`GET /v1/models/{model}`); defaults to the SDK's. Tests pass a fake.
   */
  probe?: (apiKey: string, model: string, signal?: AbortSignal) => Promise<void>;
}

export interface ConnectionTest {
  ok: boolean;
  kind: string | null;
  message: string;
  model: string;
}

export class AnthropicBackend implements TutorBackend {
  readonly id = 'anthropic' as const;
  private cached: { key: string; client: MessagesClient } | null = null;

  constructor(private readonly opts: AnthropicOptions) {}

  model(): string {
    return this.opts.model()?.trim() || DEFAULT_MODEL;
  }

  status(): Promise<BackendStatus> {
    const model = this.model();
    if (!this.opts.apiKey())
      return Promise.resolve({ available: false, reason: 'No Anthropic API key is set.', model });
    return Promise.resolve({ available: true, reason: null, model });
  }

  /** Settings' "Test connection": is the key accepted, and does the model exist? */
  async testConnection(signal?: AbortSignal): Promise<ConnectionTest> {
    const model = this.model();
    const key = this.opts.apiKey();
    if (!key) return { ok: false, kind: 'no_key', message: 'No Anthropic API key is set.', model };
    const probe =
      this.opts.probe ??
      (async (apiKey: string, id: string, s?: AbortSignal) => {
        await new Anthropic({ apiKey, maxRetries: 1, timeout: 20_000 }).models.retrieve(
          id,
          {},
          s ? { signal: s } : {},
        );
      });
    try {
      await probe(key, model, signal);
      return { ok: true, kind: null, message: `Connected. The tutor will use ${model}.`, model };
    } catch (e) {
      if (e instanceof Anthropic.NotFoundError)
        return {
          ok: false,
          kind: 'model',
          message: `The key works, but the model "${model}" was not found. Check the model in Settings.`,
          model,
        };
      const ev = this.errorEvent(e, signal ?? new AbortController().signal);
      const message = ev.type === 'error' ? ev.message : 'The connection test failed.';
      return { ok: false, kind: ev.type === 'error' ? ev.kind : 'other', message, model };
    }
  }

  private client(key: string): MessagesClient {
    if (this.cached?.key !== key) {
      const make =
        this.opts.client ?? ((apiKey: string) => new Anthropic({ apiKey, maxRetries: 2 }));
      this.cached = { key, client: make(key) };
    }
    return this.cached.client;
  }

  /** The request for the conversation so far (exported for tests: what is sent). */
  requestParams(turn: Turn, messages: MessageParam[]): Beta {
    const model = this.model();
    const tools = turn.tools.anthropicTools().map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Beta.Messages.BetaTool.InputSchema,
      eager_input_streaming: true,
    }));
    const params: Beta = {
      model,
      max_tokens: this.opts.maxTokens ?? MAX_TOKENS,
      system: [{ type: 'text', text: turn.systemPrompt, cache_control: CACHE }],
      tools,
      messages,
      thinking: { type: 'adaptive' },
      output_config: { effort: this.opts.effort() },
      cache_control: CACHE,
      stream: true,
    };
    if (FALLBACK_MODELS.some((m) => model === m || model.startsWith(`${m}-`))) {
      params.betas = [FALLBACK_BETA];
      params.fallbacks = 'default';
    }
    return params;
  }

  private clean(text: string): string {
    const key = this.opts.apiKey();
    return key ? text.split(key).join('[redacted]') : text;
  }

  async *runTurn(turn: Turn, signal: SignalLike): AsyncIterable<ChatEvent> {
    const key = this.opts.apiKey();
    if (!key) {
      yield chatError('auth', 'No Anthropic API key is set. Add one in Settings.');
      return;
    }
    const state = turn.backendState;
    if (!Array.isArray(state.messages))
      state.messages = seedMessages(turn.history) as unknown as JsonValue;
    const messages = state.messages as unknown as MessageParam[];
    messages.push({
      role: 'user',
      content: [{ type: 'text', text: renderUserMessage(turn.userText, turn.context) }],
    });
    const client = this.client(key);
    const abort = new AbortController();
    const onAbort = () => abort.abort();
    signal.addEventListener('abort', onAbort);
    if (signal.aborted) abort.abort();
    let saidSomething = false;

    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        if (signal.aborted) {
          yield chatError('cancelled', 'Stopped.');
          return;
        }
        let final: Anthropic.Beta.Messages.BetaMessage;
        let newRound = true;
        try {
          const stream = client.beta.messages.stream(this.requestParams(turn, messages), {
            signal: abort.signal,
          });
          for await (const event of stream) {
            if (
              event.type === 'content_block_delta' &&
              event.delta.type === 'text_delta' &&
              event.delta.text
            ) {
              if (newRound && saidSomething) yield textDelta('\n\n');
              newRound = false;
              saidSomething = true;
              yield textDelta(event.delta.text);
            }
          }
          final = await stream.finalMessage();
        } catch (e) {
          // Nothing of this response is kept, so the transcript stays valid.
          yield this.errorEvent(e, signal);
          return;
        }

        const stop = final.stop_reason;
        if (stop === 'refusal') {
          const category = final.stop_details?.category;
          yield chatError(
            'refusal',
            `The tutor declined to answer this${category ? ` (${category})` : ''}. Try rephrasing the request.`,
          );
          return;
        }
        const content = echoContent(JSON.parse(JSON.stringify(final.content)) as ContentBlock[]);
        const toolUses = content.filter((b) => b.type === 'tool_use');

        if (!toolUses.length) {
          messages.push({ role: 'assistant', content } as unknown as MessageParam);
          if (stop === 'pause_turn') continue;
          if (stop === 'model_context_window_exceeded') {
            yield chatError(
              'other',
              'This chat is too long for the model. Reset the chat to continue.',
            );
            return;
          }
          if (stop === 'max_tokens') {
            yield chatError('max_tokens', 'The reply hit the length limit and was cut off.');
            return;
          }
          yield done(stop ?? 'end_turn');
          return;
        }

        if (stop === 'max_tokens') {
          // A truncated tool input can still parse; never run it.
          messages.push({ role: 'assistant', content } as unknown as MessageParam);
          messages.push({
            role: 'user',
            content: toolUses.map((b) =>
              toolResult(String(b.id), {
                ok: false,
                error: 'not run: the reply was cut off at the token limit',
              }),
            ),
          } as unknown as MessageParam);
          yield chatError(
            'max_tokens',
            'The reply hit the length limit before a tool call finished. Ask again, perhaps for something smaller.',
          );
          return;
        }

        const results = new Map<string, ReturnType<typeof toolResult>>();
        try {
          for (const block of toolUses) {
            if (signal.aborted) break;
            const id = String(block.id);
            const name = String(block.name ?? '');
            yield toolStart(id, name, turn.tools.startSummary(name));
            const result = await turn.tools.call(name, block.input);
            results.set(id, toolResult(id, result.output));
            yield* resultEvents(id, result);
          }
        } finally {
          // On success and on cancel: the assistant turn and a result for every
          // tool_use go in together, so the transcript stays valid.
          messages.push({ role: 'assistant', content } as unknown as MessageParam);
          messages.push({
            role: 'user',
            content: toolUses.map(
              (b) =>
                results.get(String(b.id)) ??
                toolResult(String(b.id), { ok: false, error: 'not run: cancelled' }),
            ),
          } as unknown as MessageParam);
        }
      }
      yield chatError(
        'other',
        `The tutor used more than ${MAX_ROUNDS} steps on one message and was stopped.`,
      );
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  private errorEvent(e: unknown, signal: SignalLike): ChatEvent {
    const log = this.opts.log ?? (() => {});
    const id = requestId(e);
    if (signal.aborted || e instanceof Anthropic.APIUserAbortError)
      return chatError('cancelled', 'Stopped.');
    if (e instanceof Anthropic.APIConnectionError) {
      log(`anthropic connection error: ${e.name}`);
      return chatError(
        'network',
        'Could not reach the Anthropic API. Check the network and try again.',
      );
    }
    if (
      e instanceof Anthropic.AuthenticationError ||
      e instanceof Anthropic.PermissionDeniedError
    ) {
      log(`anthropic auth error (request ${id})`);
      return chatError(
        'auth',
        'The Anthropic API rejected the API key. Check the key and its permissions in Settings.',
      );
    }
    if (e instanceof Anthropic.RateLimitError) {
      log(`anthropic rate limit (request ${id})`);
      return chatError(
        'rate_limit',
        'The Anthropic API rate limit was reached. Wait a minute and try again.',
      );
    }
    if (e instanceof Anthropic.OverloadedError) {
      log(`anthropic overloaded (request ${id})`);
      return chatError(
        'rate_limit',
        'The Anthropic API is overloaded right now. Try again shortly.',
      );
    }
    if (e instanceof Anthropic.BadRequestError || e instanceof Anthropic.NotFoundError) {
      const detail = this.clean(apiMessage(e));
      log(`anthropic ${e.status} (request ${id}): ${detail}`);
      return chatError('other', `The Anthropic API refused the request: ${detail}`);
    }
    if (e instanceof Anthropic.APIError) {
      log(`anthropic status ${String(e.status)} (request ${id})`);
      return chatError(
        'other',
        `The Anthropic API returned an error (${String(e.status)}). Try again.`,
      );
    }
    if (e instanceof Anthropic.AnthropicError) {
      log(`anthropic sdk error: ${e.name}`);
      return chatError('other', 'The Anthropic SDK failed while talking to the API. Try again.');
    }
    // The SDK could not parse a streamed tool input at all.
    log(`anthropic stream failed: ${e instanceof Error ? e.name : typeof e}`);
    return chatError('other', 'The tutor produced a malformed reply. Send the message again.');
  }
}

// ---------------------------------------------------------------- helpers

export function toolResult(
  toolUseId: string,
  output: ToolOutput,
): { type: 'tool_result'; tool_use_id: string; content: string; is_error?: true } {
  const block: { type: 'tool_result'; tool_use_id: string; content: string; is_error?: true } = {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: stringifyJson(output),
  };
  if (!output.ok) block.is_error = true;
  return block;
}

/**
 * Assistant content as it must be sent back: unchanged, except after a
 * mid-output server-side fallback, where the declined attempt's
 * model-internal blocks before the last `fallback` block are dropped; text
 * and the `fallback` block stay where they were.
 */
export function echoContent(blocks: ContentBlock[]): ContentBlock[] {
  let last = -1;
  blocks.forEach((b, i) => {
    if (b.type === 'fallback') last = i;
  });
  if (last < 0) return blocks;
  return [
    ...blocks.slice(0, last).filter((b) => !PRE_FALLBACK_DROP.has(b.type)),
    ...blocks.slice(last),
  ];
}

/** API messages from the neutral transcript: text only, alternating, starting with a user turn. */
export function seedMessages(history: readonly NeutralMessage[]): MessageParam[] {
  const out: { role: 'user' | 'assistant'; content: [{ type: 'text'; text: string }] }[] = [];
  for (const m of history) {
    const text = m.text.trim();
    if (!text) continue;
    if (!out.length && m.role !== 'user') continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) prev.content[0].text += `\n\n${text}`;
    else out.push({ role: m.role, content: [{ type: 'text', text }] });
  }
  return out;
}

function requestId(e: unknown): string {
  return e instanceof Anthropic.APIError ? (e.requestID ?? '?') : '?';
}

/** The API's own error message from the body, else the exception's, capped. */
function apiMessage(e: InstanceType<typeof Anthropic.APIError>, limit = 300): string {
  const text = (e.apiMessage || e.message || e.name).trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 3)}...`;
}
