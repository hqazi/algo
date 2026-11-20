import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChatEvent } from '@algo/core';
import { classify, redact, StreamJsonParser } from './stream-json';

const fixture = (name: string): string[] =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8')
    .split('\n')
    .filter(Boolean);

function run(lines: (string | object)[], exit = 0, stderr = ''): ChatEvent[] {
  const p = new StreamJsonParser();
  const out: ChatEvent[] = [];
  for (const l of lines) out.push(...p.feed(typeof l === 'string' ? l : JSON.stringify(l)));
  out.push(p.finish(exit, stderr));
  return out;
}

const delta = (text: string) => ({
  type: 'stream_event',
  event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
});
const start = (id: string) => ({
  type: 'stream_event',
  event: { type: 'message_start', message: { id } },
});
const ok = { type: 'result', subtype: 'success', is_error: false, stop_reason: 'end_turn' };

describe('stream-json (recorded with Claude Code 2.1.328)', () => {
  it('a turn: streamed text, tool use ignored, done', () => {
    const p = new StreamJsonParser();
    const events = fixture('turn.jsonl').flatMap((l) => p.feed(l));
    expect(events.map((e) => (e.type === 'text_delta' ? e.text : e.type))).toEqual([
      'Let me',
      ' check.',
      '\n\nYou ha',
      've not started yet. Shall we begin?',
    ]);
    expect(p.started).toBe(true);
    expect(p.tools).toEqual(['mcp__tutor__get_status', 'mcp__tutor__slow_tool']);
    expect(p.state.session_id).toBe('655c0b45-a5f4-45cb-aec0-67136b599310');
    expect(p.finish(0, '')).toEqual({ type: 'done', stop: 'end_turn' });
  });

  it('a rejected key ends the turn at the first retry', () => {
    const p = new StreamJsonParser();
    const events = fixture('auth.jsonl').flatMap((l) => p.feed(l));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error', kind: 'auth' });
  });
});

describe('stream-json', () => {
  it('uses an assistant message’s text only when it was not streamed', () => {
    const events = run([
      { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Whole.' }] } },
      ok,
    ]);
    expect(events).toEqual([
      { type: 'text_delta', text: 'Whole.' },
      { type: 'done', stop: 'end_turn' },
    ]);
    const streamed = run([
      start('m1'),
      delta('Part'),
      { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Part' }] } },
      ok,
    ]);
    expect(streamed.filter((e) => e.type === 'text_delta')).toHaveLength(1);
  });

  it('ignores junk lines and unknown events', () => {
    expect(run(['not json', '[1]', { type: 'user' }, { type: 'mystery' }, ok])).toEqual([
      { type: 'done', stop: 'end_turn' },
    ]);
  });

  it('a refusal is a refusal error', () => {
    const events = run([
      start('m1'),
      { type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'refusal' } } },
      ok,
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'error', kind: 'refusal' });
  });

  it('max_tokens is reported', () => {
    expect(run([{ ...ok, stop_reason: 'max_tokens' }]).at(-1)).toMatchObject({
      kind: 'max_tokens',
    });
  });

  it('rate limits end the turn after a few retries', () => {
    const retry = (attempt: number) => ({
      type: 'system',
      subtype: 'api_retry',
      attempt,
      error_status: 429,
      error: 'rate_limit',
    });
    const p = new StreamJsonParser();
    expect(p.feed(JSON.stringify(retry(1)))).toEqual([]);
    expect(p.feed(JSON.stringify(retry(3)))[0]).toMatchObject({ kind: 'rate_limit' });
    expect(
      new StreamJsonParser().feed(
        JSON.stringify({ type: 'system', subtype: 'api_retry', attempt: 5, error_status: 500 }),
      ),
    ).toEqual([]);
  });

  it('error results and exits are classified', () => {
    expect(
      run([{ type: 'result', subtype: 'error_max_turns', is_error: true }]).at(-1),
    ).toMatchObject({ kind: 'other', message: expect.stringMatching(/too many steps/) as string });
    expect(run([], 1, 'boom\nlast line').at(-1)).toMatchObject({
      kind: 'other',
      message: 'Claude Code exited with status 1. last line',
    });
    expect(run([], 0).at(-1)).toMatchObject({
      message: expect.stringMatching(/without finishing/) as string,
    });
    expect(
      run([{ type: 'assistant', error: 'authentication_failed', message: {} }]).at(-1),
    ).toMatchObject({ kind: 'auth' });
  });

  it('never repeats a credential', () => {
    const e = classify(null, {}, 1, 'failed with key sk-ant-api03-SECRET and algotutor-abcDEF123');
    expect(JSON.stringify(e)).not.toMatch(/SECRET|abcDEF123/);
    expect(redact('Authorization: Bearer abc.def')).toBe('Authorization: Bearer …');
  });
});
