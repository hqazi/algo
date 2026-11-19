/**
 * Chat events (SPEC §7.3): what a tutor backend yields during one turn, and
 * what the UI receives over IPC. Ported from `dsa-tutor/dsa_tutor/backends/base.py`.
 *
 *   text_delta  a piece of the reply
 *   tool_start  a tool began (one-line summary for the chip; never its input)
 *   tool_end    it finished (ok, one-line summary; never its raw output)
 *   ui_event    something for the app to do (open a problem, show results…)
 *   error       the turn ended badly (`kind`, a sentence for people)
 *   done        the turn ended well (`stop`: the backend's stop reason)
 *
 * Every turn ends with exactly one `done` or `error`. Tool inputs and raw
 * outputs never appear in an event: only summaries and the tools' UI events.
 */
import type { ToolResult, UiEvent } from '../tools/registry';

export const ERROR_KINDS = [
  'auth',
  'rate_limit',
  'network',
  'refusal',
  'max_tokens',
  'cancelled',
  'other',
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

export interface TextDelta {
  type: 'text_delta';
  text: string;
}
export interface ToolStart {
  type: 'tool_start';
  id: string;
  name: string;
  summary: string;
}
export interface ToolEnd {
  type: 'tool_end';
  id: string;
  ok: boolean;
  summary: string;
}
export interface UiEventEnvelope {
  type: 'ui_event';
  event: UiEvent;
}
export interface ChatError {
  type: 'error';
  kind: ErrorKind;
  message: string;
}
export interface Done {
  type: 'done';
  stop: string;
}

export type ChatEvent = TextDelta | ToolStart | ToolEnd | UiEventEnvelope | ChatError | Done;

export const textDelta = (text: string): TextDelta => ({ type: 'text_delta', text });
export const toolStart = (id: string, name: string, summary: string): ToolStart => ({
  type: 'tool_start',
  id,
  name,
  summary,
});
export const toolEnd = (id: string, ok: boolean, summary: string): ToolEnd => ({
  type: 'tool_end',
  id,
  ok,
  summary,
});
export const chatError = (kind: ErrorKind, message: string): ChatError => ({
  type: 'error',
  kind: (ERROR_KINDS as readonly string[]).includes(kind) ? kind : 'other',
  message,
});
export const done = (stop = 'end_turn'): Done => ({ type: 'done', stop });

/** `tool_end`, then the tool's UI events, as the app should see them. */
export function resultEvents(id: string, result: ToolResult): ChatEvent[] {
  return [
    toolEnd(id, result.output.ok, result.summary),
    ...result.ui.map((event): UiEventEnvelope => ({ type: 'ui_event', event })),
  ];
}
