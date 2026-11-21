// @vitest-environment jsdom
/**
 * Read aloud (T37, SPEC §15.6) on the Library page, with a fake speech
 * engine: start from the top or the selection, highlight, advance on each
 * utterance's end, pause and resume, skip, speed and voice (remembered), stop
 * on another article, and the button disabled without voices.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArticleView, TreeView } from '../../../shared/library';
import { LeaderKeys } from '../components/Leader';
import { Toasts } from '../components/Toasts';
import { AppProvider } from '../lib/app';
import { LibraryPage } from '../pages/LibraryPage';
import { FakeBridge, installBridge } from '../test/fake-bridge';
import { baseHandlers } from '../test/fixtures';

const TREE: TreeView = {
  folders: [
    {
      id: 'f1',
      name: 'Vault',
      error: null,
      root: {
        name: '',
        folders: [],
        articles: [
          { id: 'a1', title: 'Binary search', tags: [], missing: false },
          { id: 'a2', title: 'Heaps', tags: [], missing: false },
        ],
      },
    },
  ],
};

function article(id: string, body: string): ArticleView {
  return {
    id,
    title: id === 'a1' ? 'Binary search' : 'Heaps',
    source: null,
    author: [],
    published: null,
    created: null,
    description: null,
    tags: [],
    extra: [],
    missing: false,
    generated: false,
    body,
    images: {},
    links: {},
  };
}

const BODY = [
  '# Steps',
  '',
  'Halve the range.',
  '',
  '```python',
  'mid = 0',
  '```',
  '',
  '- Sorted input.',
].join('\n');

class FakeUtterance {
  text: string;
  rate = 1;
  lang = '';
  voice: SpeechSynthesisVoice | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

const VOICES = [
  { name: 'Zed', lang: 'en-GB', voiceURI: 'zed', default: false, localService: true },
  { name: 'Ana', lang: 'en-US', voiceURI: 'ana', default: true, localService: true },
] as unknown as SpeechSynthesisVoice[];

class FakeSynth extends EventTarget {
  spoken: FakeUtterance[] = [];
  current: FakeUtterance | null = null;
  voices = VOICES;
  getVoices(): SpeechSynthesisVoice[] {
    return this.voices;
  }
  speak(u: FakeUtterance): void {
    this.spoken.push(u);
    this.current = u;
  }
  cancel(): void {
    const u = this.current;
    this.current = null;
    // As Chromium does: the cancelled utterance reports an error.
    u?.onerror?.({ error: 'interrupted' });
  }
  /** The current utterance finishes. */
  finish(): void {
    const u = this.current;
    this.current = null;
    act(() => u?.onend?.());
  }
}

let synth: FakeSynth;

beforeEach(() => {
  localStorage.clear();
  window.location.hash = '#/library/a1';
  synth = new FakeSynth();
  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('network unavailable'))),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(id: string) {
  installBridge(
    baseHandlers(new FakeBridge())
      .on('library:tree', () => TREE)
      .on('library:article', ({ id: a }) => article(a, a === 'a1' ? BODY : 'Min at the root.'))
      .on('library:open-link', () => ({ opened: true }))
      .on('library:threads', ({ article: a }) => ({ article: a, threads: [] }))
      .on('library:chat-notice', () => ({ seen: false })),
  );
  const ui = (a: string) => (
    <AppProvider>
      <LeaderKeys setting="ctrl+b">
        <LibraryPage article={a} />
      </LeaderKeys>
      <Toasts />
    </AppProvider>
  );
  const view = render(ui(id));
  return { rerender: (a: string) => view.rerender(ui(a)) };
}

const said = (): string[] => synth.spoken.map((u) => u.text);
const lit = (): string[] =>
  Array.from(document.querySelectorAll('.speaking')).map((e) => e.textContent ?? '');

describe('Read aloud', () => {
  it('reads block by block from the top, skipping code, and highlights the block', async () => {
    setup('a1');
    await screen.findByRole('heading', { name: 'Steps' });
    fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }));
    expect(said()).toEqual(['Steps']);
    expect(lit()).toEqual(['Steps']);
    expect(screen.getByRole('region', { name: 'Read aloud' }).textContent).toContain('1 of 3');

    synth.finish();
    expect(said()).toEqual(['Steps', 'Halve the range.']);
    expect(lit()).toEqual(['Halve the range.']);
    synth.finish();
    expect(said().at(-1)).toBe('Sorted input.');
    synth.finish();
    // The end: the bar goes and nothing is highlighted.
    expect(screen.queryByRole('region', { name: 'Read aloud' })).toBeNull();
    expect(lit()).toEqual([]);
  });

  it('starts at the selected text', async () => {
    setup('a1');
    const p = await screen.findByText('Halve the range.');
    const range = document.createRange();
    range.selectNodeContents(p);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }));
    expect(said()).toEqual(['Halve the range.']);
    window.getSelection()?.removeAllRanges();
  });

  it('pauses and resumes the same block, skips, and stops', async () => {
    setup('a1');
    await screen.findByRole('heading', { name: 'Steps' });
    fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(synth.current).toBeNull();
    // A late end from the cancelled utterance does not move on.
    synth.spoken[0]?.onend?.();
    expect(said()).toEqual(['Steps']);
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(said()).toEqual(['Steps', 'Steps']);

    fireEvent.click(screen.getByRole('button', { name: 'Next paragraph' }));
    expect(said().at(-1)).toBe('Halve the range.');
    fireEvent.click(screen.getByRole('button', { name: 'Previous paragraph' }));
    expect(said().at(-1)).toBe('Steps');

    fireEvent.click(screen.getByRole('button', { name: 'Stop reading aloud', pressed: true }));
    expect(synth.current).toBeNull();
    expect(screen.queryByRole('region', { name: 'Read aloud' })).toBeNull();
    expect(lit()).toEqual([]);
  });

  it('applies speed and voice at once and remembers them', async () => {
    setup('a1');
    await screen.findByRole('heading', { name: 'Steps' });
    fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Speed' }), { target: { value: '1.5' } });
    expect(synth.current?.rate).toBe(1.5);
    expect(synth.current?.text).toBe('Steps');
    const voice = screen.getByRole('combobox', { name: 'Voice' });
    // Voices in the app's language, then by name.
    expect(Array.from(voice.querySelectorAll('option')).map((o) => o.textContent)).toEqual([
      'System default',
      'Ana (en-US)',
      'Zed (en-GB)',
    ]);
    fireEvent.change(voice, { target: { value: 'zed' } });
    expect(synth.current?.voice?.name).toBe('Zed');
    expect(JSON.parse(localStorage.getItem('read-aloud') ?? '{}')).toEqual({
      rate: 1.5,
      voice: 'zed',
    });
  });

  it('works from the leader keys', async () => {
    setup('a1');
    await screen.findByRole('heading', { name: 'Steps' });
    const leader = () => fireEvent.keyDown(window, { key: 'b', code: 'KeyB', ctrlKey: true });
    leader();
    fireEvent.keyDown(window, { key: 'p' });
    expect(said()).toEqual(['Steps']);
    leader();
    fireEvent.keyDown(window, { key: 'n' });
    expect(said().at(-1)).toBe('Halve the range.');
    leader();
    fireEvent.keyDown(window, { key: 'x' });
    expect(synth.current).toBeNull();
    expect(screen.queryByRole('region', { name: 'Read aloud' })).toBeNull();
  });

  it('stops when another article opens', async () => {
    const { rerender } = setup('a1');
    await screen.findByRole('heading', { name: 'Steps' });
    fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }));
    rerender('a2');
    await screen.findByText('Min at the root.');
    expect(synth.current).toBeNull();
    expect(screen.queryByRole('region', { name: 'Read aloud' })).toBeNull();
  });

  it('is disabled with a reason when there is no voice', async () => {
    synth.voices = [];
    setup('a1');
    await screen.findByRole('heading', { name: 'Steps' });
    const button = screen.getByRole('button', { name: 'Read aloud' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('title')).toMatch(/speech-dispatcher/);
    // Voices that arrive later enable it.
    synth.voices = VOICES;
    act(() => {
      synth.dispatchEvent(new Event('voiceschanged'));
    });
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  });
});
