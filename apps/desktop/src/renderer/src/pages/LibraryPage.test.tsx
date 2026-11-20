// @vitest-environment jsdom
/**
 * The Library page (T22, SPEC §15.6): the tree from `library:watch`, filter
 * and Refresh, and the reader: header, local images by asset URL, image
 * placeholders, wikilinks in the app, web links through main. Reading works
 * with no key and no network (the tutor is off and `fetch` throws).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArticleView, TreeView } from '../../../shared/library';
import { Toasts } from '../components/Toasts';
import { AppProvider } from '../lib/app';
import { FakeBridge, installBridge, Refused } from '../test/fake-bridge';
import { baseHandlers } from '../test/fixtures';
import { LibraryPage } from './LibraryPage';

const ASSET = 'tutor-app://app/library-asset/abcdefghijklmnop0123';

const TREE: TreeView = {
  folders: [
    {
      id: 'f1',
      name: 'Vault',
      error: null,
      root: {
        name: '',
        folders: [
          {
            name: 'Clippings',
            folders: [],
            articles: [
              { id: 'a1', title: 'Binary search', tags: ['algorithms'], missing: false },
              { id: 'a2', title: 'Graph basics', tags: ['graphs'], missing: true },
            ],
          },
        ],
        articles: [{ id: 'a3', title: 'Reading list', tags: [], missing: false }],
      },
    },
  ],
};

const ARTICLE: ArticleView = {
  id: 'a1',
  title: 'Binary search',
  source: 'https://example.com/binary-search',
  author: ['Ada'],
  published: '2026-01-02',
  created: '2026-11-19',
  description: 'Halving the range.',
  tags: ['algorithms'],
  extra: [['rating', '5']],
  missing: false,
  body: [
    '# Steps',
    '![[diagram.png]] ![remote](https://cdn.example.com/x.png)',
    'See [[Graph basics]] and [[Nowhere]], or [the paper](https://example.org/paper).',
    '> [!tip] Remember',
    '> Sorted input.',
  ].join('\n'),
  images: {
    'diagram.png': { kind: 'asset', url: ASSET },
    'https://cdn.example.com/x.png': { kind: 'blocked', reason: 'remote', host: 'cdn.example.com' },
  },
  links: { 'Graph basics': 'a2', Nowhere: null },
};

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.location.hash = '#/library/a1';
  fetchSpy = vi.fn(() => Promise.reject(new Error('network unavailable')));
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(article: string | null, extra?: (b: FakeBridge) => FakeBridge) {
  let bridge = baseHandlers(new FakeBridge())
    .on('library:tree', () => TREE)
    .on('library:refresh', () => TREE)
    .on('library:article', ({ id }) => {
      if (id === 'a1') return ARTICLE;
      if (id === 'a2')
        return { ...ARTICLE, id: 'a2', title: 'Graph basics', missing: true, body: '' };
      throw new Refused('not_found', 'That article is not in the library.');
    })
    .on('library:open-link', () => ({ opened: true }));
  if (extra) bridge = extra(bridge);
  installBridge(bridge);
  const view = render(
    <AppProvider>
      <LibraryPage article={article} />
      <Toasts />
    </AppProvider>,
  );
  return { bridge, view };
}

describe('LibraryPage', () => {
  it('shows the tree, filters by title and tag, and refreshes', async () => {
    const { bridge } = setup(null);
    const tree = await screen.findByRole('list', { name: 'Library folders' });
    expect(within(tree).getByText('Binary search')).toBeTruthy();
    expect(within(tree).getByText('(file missing)')).toBeTruthy();
    // The page watches the folders while open.
    expect(bridge.streams.map((s) => s.channel)).toEqual(['library:watch']);

    const filter = screen.getByRole('searchbox', { name: 'Filter articles' });
    fireEvent.change(filter, { target: { value: '#graphs' } });
    expect(within(tree).queryByText('Binary search')).toBeNull();
    expect(within(tree).getByText('Graph basics')).toBeTruthy();
    fireEvent.change(filter, { target: { value: 'READING' } });
    expect(within(tree).getByText('Reading list')).toBeTruthy();
    expect(within(tree).queryByText('Graph basics')).toBeNull();
    fireEvent.change(filter, { target: { value: 'zzz' } });
    expect(screen.getByText('No articles match.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(bridge.channels()).toContain('library:refresh'));

    // A tree from the watcher replaces the shown one.
    fireEvent.change(filter, { target: { value: '' } });
    bridge.streams[0]!.emit({ folders: [{ ...TREE.folders[0]!, name: 'Renamed vault' }] });
    expect(await screen.findByText('Renamed vault')).toBeTruthy();
  });

  it('says how to add a folder when there is none', async () => {
    setup(null, (b) => b.on('library:tree', () => ({ folders: [] })));
    expect(await screen.findByTestId('library-page-empty')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh' }).hasAttribute('disabled')).toBe(true);
  });

  it('reads an article with no key and no network', async () => {
    const { bridge, view } = setup('a1');
    const reader = await screen.findByRole('article', { name: 'Binary search' });
    expect(within(reader).getByRole('heading', { name: 'Binary search', level: 1 })).toBeTruthy();
    expect(within(reader).getByText(/By Ada/).textContent).toBe(
      'By Ada · Published 2026-01-02 · Saved 2026-11-19',
    );
    expect(within(reader).getByText('Halving the range.')).toBeTruthy();
    expect(within(reader).getByText('#algorithms')).toBeTruthy();
    expect(within(reader).getByText('rating')).toBeTruthy();

    const imgs = [...view.container.querySelectorAll('.article-body img')];
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual([ASSET]);
    expect(view.container.querySelector('.img-placeholder')!.textContent).toContain(
      'cdn.example.com',
    );
    expect(view.container.querySelector('.callout-tip .callout-title')!.textContent).toBe(
      'Remember',
    );
    expect(screen.getByTestId('chats-placeholder')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(bridge.channels()).not.toContain('chat:send');
  });

  it('opens web links through main and library links in the app', async () => {
    const { bridge } = setup('a1');
    const reader = await screen.findByRole('article', { name: 'Binary search' });

    fireEvent.click(within(reader).getByText('the paper'));
    await waitFor(() =>
      expect(bridge.calls.filter((c) => c.channel === 'library:open-link')).toEqual([
        { channel: 'library:open-link', request: { url: 'https://example.org/paper' } },
      ]),
    );
    fireEvent.click(screen.getByTestId('source-link'));
    await waitFor(() =>
      expect(bridge.calls.filter((c) => c.channel === 'library:open-link')).toHaveLength(2),
    );
    expect(window.location.hash).toBe('#/library/a1');

    expect(within(reader).getByText('Nowhere').tagName).toBe('SPAN');
    fireEvent.click(within(reader).getByText('Graph basics'));
    expect(window.location.hash).toBe('#/library/a2');
  });

  it('shows a refused link as a toast', async () => {
    setup('a1', (b) =>
      b.on('library:open-link', () => {
        throw new Refused('scheme', 'Only web and mail links open in the browser.');
      }),
    );
    const reader = await screen.findByRole('article', { name: 'Binary search' });
    fireEvent.click(within(reader).getByText('the paper'));
    expect(await screen.findByText('Only web and mail links open in the browser.')).toBeTruthy();
  });

  it('shows the file-missing banner, and an error for an unknown article', async () => {
    const { view } = setup('a2');
    expect(await screen.findByTestId('file-missing')).toBeTruthy();
    view.unmount();
    setup('gone');
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That article is not in the library.',
    );
  });
});
