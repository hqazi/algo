// @vitest-environment jsdom
/**
 * Read aloud (T37, T38, SPEC §15.6) on the Library page, with a fake engine
 * (`tts:speak`) and a fake Web Audio: start from the top or the selection,
 * highlight, the next chunks buffered while one plays, pause and resume
 * where it was, skip, speed and voice (remembered), stop on another
 * article, and the first-time download.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArticleView, TreeView } from '../../../shared/library';
import type { TtsStatus } from '../../../shared/tts';
import { LeaderKeys } from '../components/Leader';
import { Toasts } from '../components/Toasts';
import { AppProvider } from '../lib/app';
import { LibraryPage } from '../pages/LibraryPage';
import { FakeBridge, installBridge, Refused } from '../test/fake-bridge';
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

class FakeSource {
  buffer: { text: string } | null = null;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  connect(): void {}
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
}

/** Every audio context made; the page makes one. */
const contexts: FakeContext[] = [];
class FakeContext {
  state: 'running' | 'suspended' | 'closed' = 'running';
  destination = {};
  sources: FakeSource[] = [];
  constructor() {
    contexts.push(this);
  }
  createBuffer(_ch: number, length: number) {
    // The audio's first sample says which text it is (see `speak` below).
    let text = '';
    return {
      length,
      getChannelData: () => ({
        set: (a: Float32Array) => {
          text = said[a[0] ?? -1] ?? '';
        },
      }),
      get text() {
        return text;
      },
    };
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.state = 'suspended';
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
}

/** Every chunk asked for, in order (prefetches included), with its voice and speed. */
let said: string[];
let asks: { text: string; voice: string; speed: number }[];
let status: TtsStatus;

beforeEach(() => {
  localStorage.clear();
  window.location.hash = '#/library/a1';
  said = [];
  asks = [];
  contexts.length = 0;
  status = { installed: true, bytes: 340_000_000, downloading: false, engine: null };
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('network unavailable'))),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(id: string, extra: (b: FakeBridge) => FakeBridge = (b) => b) {
  const bridge = extra(
    baseHandlers(new FakeBridge())
      .on('library:tree', () => TREE)
      .on('library:article', ({ id: a }) => article(a, a === 'a1' ? BODY : 'Min at the root.'))
      .on('library:open-link', () => ({ opened: true }))
      .on('library:threads', ({ article: a }) => ({ article: a, threads: [] }))
      .on('library:chat-notice', () => ({ seen: false }))
      .on('tts:status', () => status)
      .on('tts:speak', ({ text, voice, speed }) => {
        asks.push({ text, voice, speed });
        said.push(text);
        return { audio: Float32Array.of(said.length - 1, 0, 0) };
      }),
  );
  installBridge(bridge);
  const ui = (a: string) => (
    <AppProvider>
      <LeaderKeys setting="ctrl+b">
        <LibraryPage article={a} />
      </LeaderKeys>
      <Toasts />
    </AppProvider>
  );
  const view = render(ui(id));
  return { bridge, rerender: (a: string) => view.rerender(ui(a)) };
}

const ctx = (): FakeContext => {
  const c = contexts.at(-1);
  if (!c) throw new Error('no audio context');
  return c;
};

/** The source playing now: started, not stopped, not ended. */
const playing = (): FakeSource | undefined =>
  contexts
    .at(-1)
    ?.sources.filter((s) => s.started && !s.stopped)
    .at(-1);
const playingText = (): string | undefined =>
  (playing()?.buffer as unknown as { text: string } | undefined)?.text;
const lit = (): string[] =>
  Array.from(document.querySelectorAll('.speaking')).map((e) => e.textContent ?? '');

/** Waits until `text` is playing. */
async function hear(text: string): Promise<void> {
  await waitFor(() => expect(playingText()).toBe(text));
}

/** The chunk playing ends. */
function finish(): void {
  const s = playing();
  if (!s) throw new Error('nothing is playing');
  s.stopped = true;
  act(() => s.onended?.());
}

async function ready(): Promise<void> {
  await screen.findByRole('heading', { name: 'Steps' });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Read aloud' }).hasAttribute('disabled')).toBe(false),
  );
}

describe('Read aloud', () => {
  it('reads block by block from the top, skipping code, and buffers the next chunks', async () => {
    setup('a1');
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }));
    await hear('Steps');
    expect(lit()).toEqual(['Steps']);
    expect(screen.getByRole('region', { name: 'Read aloud' }).textContent).toContain('1 of 3');
    // The next chunks are made while this one plays.
    await waitFor(() => expect(said).toEqual(['Steps', 'Halve the range.', 'Sorted input.']));

    finish();
    await hear('Halve the range.');
    expect(lit()).toEqual(['Halve the range.']);
    finish();
    await hear('Sorted input.');
    finish();
    // The end: the bar goes and nothing is highlighted.
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Read aloud' })).toBeNull());
    expect(lit()).toEqual([]);
    // Each chunk was made once.
    expect(said).toEqual(['Steps', 'Halve the range.', 'Sorted input.']);
  });

  it('keeps a few chunks ahead, one request at a time, and the paragraph starts behind', async () => {
    const paras = Array.from({ length: 8 }, (_, i) => `Para ${i + 1}.`);
    // Each request is held until released, to see how many are in flight.
    const held: (() => void)[] = [];
    let inFlight = 0;
    let most = 0;
    setup('a1', (b) =>
      b
        .on('library:article', ({ id }) =>
          article(id, ['# Steps', '', ...paras.flatMap((p) => [p, ''])].join('\n')),
        )
        .on('tts:speak', ({ text, voice, speed }) => {
          asks.push({ text, voice, speed });
          said.push(text);
          const n = said.length - 1;
          inFlight++;
          most = Math.max(most, inFlight);
          return new Promise((resolve) =>
            held.push(() => {
              inFlight--;
              resolve({ audio: Float32Array.of(n, 0, 0) });
            }),
          );
        }),
    );
    await ready();
    const release = async (): Promise<void> => {
      await waitFor(() => expect(held.length).toBeGreaterThan(0));
      await act(async () => held.shift()?.());
    };
    fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }));
    await release();
    await hear('Steps');
    // Three chunks ahead, each asked for once the one before is ready.
    for (let i = 0; i < 3; i++) await release();
    await waitFor(() => expect(said).toEqual(['Steps', 'Para 1.', 'Para 2.', 'Para 3.']));
    expect(most).toBe(1);

    // Moving on tops the buffer up by one.
    finish();
    await hear('Para 1.');
    await release();
    await waitFor(() => expect(said.at(-1)).toBe('Para 4.'));
    expect(held).toEqual([]);

    // Skipping into the buffer, and back to the paragraph before, makes nothing again.
    fireEvent.click(screen.getByRole('button', { name: 'Next paragraph' }));
    await hear('Para 2.');
    fireEvent.click(screen.getByRole('button', { name: 'Previous paragraph' }));
    await hear('Para 1.');
    expect(said.filter((t) => t === 'Para 1.' || t === 'Para 2.')).toEqual(['Para 1.', 'Para 2.']);
    expect(most).toBe(1);
  });

  it('starts at the selected text', async () => {
    setup('a1');
    await ready();
    const p = screen.getByText('Halve the range.');
    const range = document.createRange();
    range.selectNodeContents(p);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }));
    await hear('Halve the range.');
    expect(said[0]).toBe('Halve the range.');
    window.getSelection()?.removeAllRanges();
  });

  it('pauses where it is, resumes, skips, and stops', async () => {
    setup('a1');
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }));
    await hear('Steps');
    const first = playing();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(ctx().state).toBe('suspended');
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(ctx().state).toBe('running');
    // The same sound carries on; nothing is made again.
    expect(playing()).toBe(first);

    fireEvent.click(screen.getByRole('button', { name: 'Next paragraph' }));
    await hear('Halve the range.');
    fireEvent.click(screen.getByRole('button', { name: 'Previous paragraph' }));
    await hear('Steps');
    // A late end from a skipped chunk does not move on.
    act(() => first?.onended?.());
    expect(playingText()).toBe('Steps');

    // Skipping while paused stays paused, at the new place.
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next paragraph' }));
    expect(lit()).toEqual(['Halve the range.']);
    expect(playing()).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await hear('Halve the range.');

    fireEvent.click(screen.getByRole('button', { name: 'Stop reading aloud', pressed: true }));
    expect(playing()).toBeUndefined();
    expect(screen.queryByRole('region', { name: 'Read aloud' })).toBeNull();
    expect(lit()).toEqual([]);
  });

  it('applies speed and voice from the current chunk and remembers them', async () => {
    setup('a1');
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }));
    await hear('Steps');
    fireEvent.change(screen.getByRole('combobox', { name: 'Speed' }), { target: { value: '1.5' } });
    await waitFor(() =>
      expect(asks.filter((a) => a.text === 'Steps').at(-1)).toMatchObject({ speed: 1.5 }),
    );
    const voice = screen.getByRole('combobox', { name: 'Voice' });
    const groups = Array.from(voice.querySelectorAll('optgroup')).map((g) => g.label);
    expect(groups).toEqual(['American English', 'British English']);
    expect(voice.querySelector('option')?.textContent).toBe('Heart (female)');
    fireEvent.change(voice, { target: { value: 'bm_george' } });
    await waitFor(() =>
      expect(asks.filter((a) => a.text === 'Steps').at(-1)).toMatchObject({
        voice: 'bm_george',
        speed: 1.5,
      }),
    );
    await hear('Steps');
    expect(JSON.parse(localStorage.getItem('read-aloud') ?? '{}')).toEqual({
      rate: 1.5,
      voice: 'bm_george',
    });
  });

  it('forgets a system voice saved by the old read aloud', async () => {
    localStorage.setItem('read-aloud', JSON.stringify({ rate: 1.25, voice: 'urn:moz-tts:x' }));
    setup('a1');
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }));
    await hear('Steps');
    expect(asks[0]).toMatchObject({ voice: 'af_heart', speed: 1.25 });
  });

  it('works from the leader keys', async () => {
    setup('a1');
    await ready();
    const leader = () => fireEvent.keyDown(window, { key: 'b', code: 'KeyB', ctrlKey: true });
    leader();
    fireEvent.keyDown(window, { key: 'p' });
    await hear('Steps');
    leader();
    fireEvent.keyDown(window, { key: 'n' });
    await hear('Halve the range.');
    leader();
    fireEvent.keyDown(window, { key: 'x' });
    expect(playing()).toBeUndefined();
    expect(screen.queryByRole('region', { name: 'Read aloud' })).toBeNull();
  });

  it('stops when another article opens', async () => {
    const { rerender } = setup('a1');
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }));
    await hear('Steps');
    rerender('a2');
    await screen.findByText('Min at the root.');
    expect(playing()).toBeUndefined();
    expect(screen.queryByRole('region', { name: 'Read aloud' })).toBeNull();
  });

  it('says so and stops when the engine fails', async () => {
    setup('a1', (b) =>
      b.on('tts:speak', () => {
        throw new Refused('failed', 'Read aloud failed: no model');
      }),
    );
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }));
    await screen.findByText(/Read aloud failed: no model/);
    expect(screen.queryByRole('region', { name: 'Read aloud' })).toBeNull();
  });

  it('offers the download the first time, then reads', async () => {
    status = { ...status, installed: false };
    const { bridge } = setup('a1');
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/Kokoro/);
    expect(dialog.textContent).toMatch(/324 MB/);
    expect(said).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Download (324 MB)' }));
    const s = bridge.streams.find((x) => x.channel === 'tts:download');
    expect(s).toBeDefined();
    act(() => s?.emit({ received: 100 * 1024 * 1024, total: 340_000_000 }));
    expect(screen.getByRole('progressbar', { name: 'Voice download' })).toBeTruthy();
    expect(dialog.textContent).toContain('100 MB of 324 MB');

    status = { ...status, installed: true };
    await act(async () => s?.finish({ installed: true, cancelled: false }));
    await hear('Steps');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cancels the download when the offer is closed', async () => {
    status = { ...status, installed: false };
    const { bridge } = setup('a1');
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Download (324 MB)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel download' }));
    expect(bridge.streams.find((x) => x.channel === 'tts:download')?.cancelled).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(said).toEqual([]);
  });
});
