/**
 * The tutor backend interface (SPEC §7.3). A backend turns one user message
 * into a stream of `ChatEvent`s. API backends run the tool loop themselves
 * against `turn.tools`; CLI backends (T11) let an external agent call the
 * same tools over MCP. Either way the UI sees the same events.
 */
import type { JsonValue } from '../types/json';
import type { ArticleTurnContext } from '../tools/article';
import type { AnthropicToolDefinition, McpToolDefinition, ToolResult } from '../tools/registry';
import type { ChatEvent } from './chat-events';

export const BACKEND_IDS = ['anthropic', 'claude-code', 'fake'] as const;
export type BackendId = (typeof BACKEND_IDS)[number];

export interface BackendStatus {
  available: boolean;
  /** Why not available (or a note). Never a secret. */
  reason: string | null;
  model: string | null;
}

/**
 * The part of `AbortSignal` core needs (core has no DOM or Node types; a real
 * `AbortSignal` fits).
 */
export interface SignalLike {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

/** A tool chip as the transcript keeps it. */
export interface ToolChip {
  id: string;
  name: string;
  summary: string;
  /** `null` while running (or if the turn stopped before it ended). */
  ok: boolean | null;
}

export const CHAT_ACTIONS = ['hint', 'review', 'explain'] as const;
export type ChatAction = (typeof CHAT_ACTIONS)[number];

/**
 * One entry of the provider-neutral transcript (`messages.content`). An
 * assistant message keeps its text and tool chips; a user message keeps its
 * text, its quick action and the slug it was sent with (not the code).
 */
export interface NeutralMessage {
  role: 'user' | 'assistant';
  text: string;
  action?: ChatAction;
  slug?: string;
  tools?: ToolChip[];
  stop?: string;
  error?: { kind: string; message: string };
}

/** What a turn is about; any part may be missing. Built by the main process, never by the UI. */
export interface TurnContext {
  slug?: string;
  title?: string;
  language?: string;
  /** The user's code (from the editor, or the saved file). */
  code?: string;
  /** The last test report for the open attempt: already redacted. */
  lastReport?: JsonValue;
  /** v3: an article thread's passage, section and outline (SPEC §15.5). */
  article?: ArticleTurnContext;
}

/** The part of a `ToolRegistry` a backend uses. */
export interface TurnTools {
  names(): string[];
  startSummary(name: string): string;
  /** Validates `args` and never rejects. */
  call(name: string, args?: unknown): Promise<ToolResult>;
  anthropicTools(): AnthropicToolDefinition[];
  mcpTools(): McpToolDefinition[];
}

export interface Turn {
  threadId: string;
  systemPrompt: string;
  /** The neutral transcript before this turn. */
  history: NeutralMessage[];
  userText: string;
  context: TurnContext;
  tools: TurnTools;
  /** Opaque, kept per thread per backend; mutate in place (saved when the turn ends). */
  backendState: Record<string, JsonValue>;
}

export interface TutorBackend {
  readonly id: BackendId;
  status(): Promise<BackendStatus>;
  /**
   * Yields the turn's events, ending with `done` or `error`. On abort it
   * should stop soon, let a tool that is already running finish (it may
   * have changed state), leave `backendState` consistent, and end.
   */
  runTurn(turn: Turn, signal: SignalLike): AsyncIterable<ChatEvent>;
}

/** A backend that cannot run: every turn is one `error`. */
export class UnavailableBackend implements TutorBackend {
  constructor(
    readonly id: BackendId,
    private readonly reason: string,
    private readonly model: string | null = null,
  ) {}

  status(): Promise<BackendStatus> {
    return Promise.resolve({ available: false, reason: this.reason, model: this.model });
  }

  async *runTurn(): AsyncIterable<ChatEvent> {
    yield { type: 'error', kind: 'other', message: this.reason };
  }
}
