// @vitest-environment jsdom
/**
 * The chat pane, its effects and the explanation viewer against a fake
 * bridge, with the ported `dsa-tutor` chat recordings
 * (`test/chat-fixtures.ts`). Ported from `dsa-tutor/web/tests/chat-pane.test.tsx`
 * and `explanation.test.tsx`.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UiEventView } from '../../../shared/tutor';
import { withFrameCsp } from '../explanation/sandbox';
import { ExplanationList } from '../explanation/ExplanationList';
import { CHAT_FIXTURES, RUN_REPORT, SLUG } from '../test/chat-fixtures';
import { FakeBridge, installBridge, Refused } from '../test/fake-bridge';
import { baseHandlers, TUTOR_OFF, TUTOR_ON } from '../test/fixtures';
import { ChatEffects } from './ChatEffects';
import { ChatPane } from './ChatPane';
import {
  applyEvent,
  ChatStore,
  ChatStoreContext,
  fromTranscript,
  HOME,
  type ViewMessage,
} from './store';

let bridge: FakeBridge;
let store: ChatStore;
let ui: UiEventView[];
let refreshed: number;

beforeEach(() => {
  bridge = baseHandlers(new FakeBridge()).on('tutor:status', () => TUTOR_ON);
  installBridge(bridge);
  store = new ChatStore();
  ui = [];
  refreshed = 0;
  store.onUi((e) => ui.push(e));
  window.location.hash = '';
});

afterEach(cleanup);

function setup(slug: string | null = SLUG, getCode?: () => Promise<string | undefined>) {
  return render(
    <ChatStoreContext.Provider value={store}>
      <ChatPane slug={slug} {...(getCode ? { getCode } : {})} />
      <ChatEffects onRefresh={() => void refreshed++} />
    </ChatStoreContext.Provider>,
  );
}

const log = () => within(screen.getByTestId('chat-log'));
const lastStream = () => bridge.streams[bridge.streams.length - 1]!;

/** Waits for the turn to open, plays a recording, and ends the stream. */
async function play(name: string, end: 'finish' | 'cancelled' | 'none' = 'finish'): Promise<void> {
  await waitFor(() => expect(bridge.streams.length).toBeGreaterThan(0));
  const s = lastStream();
  await act(async () => {
    for (const e of CHAT_FIXTURES[name]!) s.emit(e);
    if (end === 'finish')
      s.finish({
        message: { seq: 2, role: 'assistant', text: 'x', created_at: '2026-11-19T10:00:00Z' },
      });
    if (end === 'cancelled') s.fail({ code: 'cancelled', message: 'cancelled' });
    await Promise.resolve();
  });
  const thread = (s.request as { thread: string }).thread;
  if (end !== 'none') await waitFor(() => expect(store.get(thread).streaming).toBe(false));
}

async function type(text: string): Promise<void> {
  const box = await screen.findByLabelText('Message the tutor');
  await waitFor(() => expect((box as HTMLTextAreaElement).disabled).toBe(false));
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: 'Enter' });
}

describe('ChatPane with recorded turns', () => {
  it("asking 'what next?' shows chips and opens the recommended problem", async () => {
    setup(null);
    fireEvent.click(await screen.findByRole('button', { name: 'What next?' }));
    await play('what-next');
    expect(lastStream().request).toEqual({ thread: HOME, text: 'What should I practise next?' });
    expect(screen.getAllByTestId('tool-chip').map((c) => c.textContent)).toEqual([
      '✓Next: pair-with-target',
      '✓Opened pair-with-target',
    ]);
    expect(window.location.hash).toBe(`#/p/${SLUG}`);
    expect(store.follow).toEqual({ from: HOME, to: SLUG });
    expect(refreshed).toBe(2);
    expect(log().getByText('Two Receipts')).toBeTruthy();
  });

  it('Hint sends the action and the editor code, and renders Markdown safely', async () => {
    const getCode = vi.fn(() => Promise.resolve('def find_pair(a, t):\n    pass\n'));
    setup(SLUG, getCode);
    fireEvent.click(await screen.findByRole('button', { name: 'Hint' }));
    await play('hint');
    expect(lastStream().request).toEqual({
      thread: SLUG,
      text: '',
      action: 'hint',
      code: 'def find_pair(a, t):\n    pass\n',
    });
    expect(log().getByText('Give me the next hint for this problem.')).toBeTruthy();
    const assistant = screen.getByTestId('msg-assistant');
    expect(assistant.querySelector('pre code')?.textContent).toContain('for ch in s:');
    expect(assistant.querySelector('em')?.textContent).toBe('runs');
    expect(assistant.querySelector('img, script, [onerror]')).toBeNull();
    expect(within(assistant).getByText('click').getAttribute('href')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    expect(screen.getAllByTestId('tool-chip').map((c) => c.textContent)).toEqual([
      '✓Read your code',
      '✓Hint level 1 of 4',
    ]);
  });

  it('show_results reaches UI listeners with the redacted report', async () => {
    setup();
    await type('Do my tests pass?');
    await play('run-tests');
    const shown = ui.find((e) => e.action === 'show_results');
    expect(shown).toMatchObject({ slug: SLUG, report: { passed: 0, total: 10 } });
    expect(screen.getByTestId('tool-chip').textContent).toBe('✓0/10 passed');
    expect(log().getByText('Not yet: some cases fail.')).toBeTruthy();
  });

  it('a hidden case with its input cannot reach the UI', () => {
    const leaky = {
      ...RUN_REPORT,
      cases: [{ id: 'h1', visibility: 'hidden', status: 'fail', input: { x: 'SECRET' } }],
    };
    bridge.stream('chat:send', { thread: SLUG, text: 'x' }, () => {});
    expect(() =>
      bridge.streams[0]!.emit({
        type: 'ui_event',
        event: { type: 'ui', action: 'show_results', slug: SLUG, report: leaky },
      }),
    ).toThrow();
  });

  it('open_explanation shows the page in a sandboxed iframe and marks it viewed', async () => {
    const html =
      '<!doctype html><html><head><title>x</title></head><body><h1>Two Receipts</h1></body></html>';
    bridge
      .on('explanations:page', ({ slug }) => ({ slug, version: '20261119T100000000Z', html }))
      .on('explanations:viewed', ({ slug }) => ({ slug, attempt_marked_explained: true }));
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Explain' }));
    await play('explain');
    const frame = await screen.findByTitle(`Explanation for ${SLUG}`);
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toBe(withFrameCsp(html));
    await waitFor(() => expect(bridge.channels()).toContain('explanations:viewed'));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTitle(`Explanation for ${SLUG}`)).toBeNull();
  });

  it('an explanation main cannot serve shows its error', async () => {
    bridge.on('explanations:page', () => {
      throw new Refused('not_found', 'no explanation for pair-with-target');
    });
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Explain' }));
    await play('explain');
    expect((await screen.findByText(/Could not open the explanation/)).textContent).toContain(
      'no explanation',
    );
  });

  it('a failed tool shows a failed chip', async () => {
    setup();
    await type('show me nope');
    await play('tool-failed');
    const chip = screen.getByTestId('tool-chip');
    expect(chip.getAttribute('data-state')).toBe('fail');
    expect(chip.textContent).toContain('(failed)');
  });

  it.each([
    ['refusal', 'The tutor declined to answer that.'],
    ['rate-limit', 'The AI provider is busy right now.'],
    ['auth', 'The AI provider rejected the API key.'],
  ])('%s shows its error with a retry', async (name, title) => {
    setup();
    await type('hello');
    await play(name);
    const err = await screen.findByTestId('msg-error');
    expect(err.textContent).toContain(title);
    fireEvent.click(within(err).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(bridge.streams).toHaveLength(2));
    expect(bridge.streams[1]!.request).toEqual({ thread: SLUG, text: 'hello' });
  });

  it('a cancelled reply keeps its partial text and says Stopped', async () => {
    setup();
    await type('go');
    await play('cancelled', 'cancelled');
    expect(log().getByText('Thinking about')).toBeTruthy();
    expect(screen.getByText('Stopped.')).toBeTruthy();
    expect(screen.queryByTestId('msg-error')).toBeNull();
  });

  it('a stream that ends without its last events shows the stored reply', async () => {
    setup();
    await type('go');
    await play('cancelled');
    expect(await log().findByText('x')).toBeTruthy();
    expect(screen.queryByText('Thinking about')).toBeNull();
  });
});

describe('ChatPane controls and states', () => {
  it('Stop cancels the stream', async () => {
    setup();
    await type('go');
    await play('cancelled', 'none');
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(lastStream().cancelled).toBe(true);
    expect(await screen.findByText('Stopped.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
  });

  it('a refused message shows a notice and keeps the draft', async () => {
    setup();
    await type('two');
    await waitFor(() => expect(bridge.streams).toHaveLength(1));
    await act(async () => {
      lastStream().fail({ code: 'refused', reason: 'busy', message: 'busy' });
      await Promise.resolve();
    });
    expect((await screen.findByTestId('chat-notice')).textContent).toContain('already replying');
    expect((screen.getByLabelText('Message the tutor') as HTMLTextAreaElement).value).toBe('two');
    expect(screen.queryByTestId('msg-user')).toBeNull();
  });

  it('when the tutor is not set up the pane says why, and still shows the transcript', async () => {
    bridge
      .on('tutor:status', () => TUTOR_OFF)
      .on('chat:thread', ({ thread }) => ({
        thread,
        running: false,
        messages: [
          { seq: 1, role: 'user', text: 'old question', created_at: 't' },
          { seq: 2, role: 'assistant', text: 'old answer', created_at: 't' },
        ],
      }));
    setup();
    expect((await screen.findByTestId('ai-unavailable')).textContent).toContain(
      'Anthropic API key',
    );
    expect(await log().findByText('old answer')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Hint' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Message the tutor') as HTMLTextAreaElement).disabled).toBe(true);
  });

  it('New chat resets the thread after confirmation', async () => {
    bridge
      .on('chat:thread', ({ thread }) => ({
        thread,
        running: false,
        messages: [{ seq: 1, role: 'user', text: 'old', created_at: 't' }],
      }))
      .on('chat:reset', ({ thread }) => ({ thread, archived: true }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    setup();
    await log().findByText('old');
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    await waitFor(() => expect(log().queryByText('old')).toBeNull());
    expect(bridge.channels()).toContain('chat:reset');
  });

  it('switches between the problem thread and the general thread', async () => {
    setup();
    await screen.findByRole('button', { name: 'Hint' });
    fireEvent.click(screen.getByRole('button', { name: 'General' }));
    expect(await screen.findByRole('button', { name: 'What next?' })).toBeTruthy();
    await type('hi');
    await waitFor(() => expect(bridge.streams).toHaveLength(1));
    // The general thread gets no editor code.
    expect(lastStream().request).toEqual({ thread: HOME, text: 'hi' });
  });
});

describe('store helpers', () => {
  it('builds a reply with text and chips in order', () => {
    let m: ViewMessage = { id: 'a', role: 'assistant', text: '', parts: [], pending: true };
    for (const e of CHAT_FIXTURES.hint!) m = applyEvent(m, e);
    expect(m.parts.map((p) => p.kind)).toEqual(['tool', 'tool', 'text']);
    expect(m.pending).toBe(false);
  });

  it('maps a stored transcript entry', () => {
    expect(
      fromTranscript({
        seq: 4,
        role: 'assistant',
        text: 'Hi',
        tools: [{ id: 't', name: 'get_status', summary: 'Status', ok: true }],
        error: { kind: 'rate_limit', message: 'slow' },
        created_at: 't',
      }),
    ).toEqual({
      id: 'm-4',
      role: 'assistant',
      text: '',
      parts: [
        { kind: 'tool', chip: { id: 't', name: 'get_status', summary: 'Status', ok: true } },
        { kind: 'text', text: 'Hi' },
      ],
      error: { kind: 'rate_limit', message: 'slow' },
    });
  });
});

describe('ExplanationList', () => {
  it('is hidden until there is an explanation, and reloads when the tutor renders one', async () => {
    let versions: { id: string; created_at: string; latest: boolean }[] = [];
    bridge.on('explanations:list', ({ slug }) => ({ slug, versions }));
    render(
      <ChatStoreContext.Provider value={store}>
        <ExplanationList slug={SLUG} active />
      </ChatStoreContext.Provider>,
    );
    await waitFor(() => expect(bridge.channels()).toContain('explanations:list'));
    expect(screen.queryByText('Explanations')).toBeNull();
    versions = [
      { id: '20261119T100000000Z', created_at: '2026-11-19T10:00:00Z', latest: true },
      { id: '20261118T100000000Z', created_at: '2026-11-18T10:00:00Z', latest: false },
    ];
    // A UI event from the store reloads the list.
    act(() => {
      (store as unknown as { emitUi(e: UiEventView, t: string): void }).emitUi(
        { type: 'ui', action: 'open_explanation', slug: SLUG },
        SLUG,
      );
    });
    expect(await screen.findByText('Explanations')).toBeTruthy();
    expect(screen.getByText(/counts this attempt as solved with help/)).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});

describe('sandbox', () => {
  it('puts the CSP meta first in <head> and keeps section links inside the frame', () => {
    const out = withFrameCsp(
      '<!doctype html><html><head><title>t</title></head><a href="#trace">x</a></html>',
    );
    expect(out).toMatch(/^<!doctype html><html><head><meta http-equiv="Content-Security-Policy"/);
    expect(out).toContain('href="about:srcdoc#trace"');
    expect(withFrameCsp('<p>x</p>').startsWith('<meta')).toBe(true);
  });
});
