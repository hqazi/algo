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
import { sourceLabel } from '../library/source-label';
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
        path: '',
        folders: [
          {
            name: 'Clippings',
            path: 'Clippings',
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
  generated: false,
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
    .on('library:open-link', () => ({ opened: true }))
    .on('library:threads', ({ article }) => ({ article, threads: [] }))
    .on('library:chat-notice', () => ({ seen: false }));
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
    expect(await screen.findByTestId('no-chats')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(bridge.channels()).not.toContain('chat:send');
  });

  it('folds folders with chevron buttons and marks the open article (T32)', async () => {
    setup('a1');
    const tree = await screen.findByRole('list', { name: 'Library folders' });
    const clippings = within(tree).getByRole('button', { name: 'Clippings' });
    expect(clippings.getAttribute('aria-expanded')).toBe('true');
    const open = within(tree).getByRole('link', { name: 'Binary search' });
    expect(open.getAttribute('aria-current')).toBe('page');
    expect(open.classList.contains('active')).toBe(true);

    fireEvent.click(clippings);
    expect(clippings.getAttribute('aria-expanded')).toBe('false');
    expect(within(tree).queryByText('Binary search')).toBeNull();
    expect(within(tree).getByText('Reading list')).toBeTruthy();
    // A filter shows every matching folder open; clearing it keeps the fold.
    const filter = screen.getByRole('searchbox', { name: 'Filter articles' });
    fireEvent.change(filter, { target: { value: 'binary' } });
    expect(within(tree).getByText('Binary search')).toBeTruthy();
    fireEvent.change(filter, { target: { value: '' } });
    expect(within(tree).queryByText('Binary search')).toBeNull();
    fireEvent.click(clippings);
    expect(within(tree).getByText('Binary search')).toBeTruthy();
  });

  it('shows the source as its domain, the full URL in the tooltip (T32)', async () => {
    setup('a1');
    await screen.findByRole('article', { name: 'Binary search' });
    const source = screen.getByTestId('source-link');
    expect(source.textContent).toBe('example.com');
    expect(source.getAttribute('title')).toBe('https://example.com/binary-search');
    expect(source.getAttribute('href')).toBe('https://example.com/binary-search');
    expect(sourceLabel('https://www.Example.org/a?b')).toBe('example.org');
    expect(sourceLabel('mailto:ada@example.com')).toBe('ada@example.com');
    expect(sourceLabel('not a url')).toBe('not a url');
  });

  it('opens Write an article from the pane header (T32)', async () => {
    setup(null);
    await screen.findByRole('list', { name: 'Library folders' });
    expect(screen.queryByRole('form', { name: 'Write an article' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Write an article' }));
    const form = screen.getByRole('form', { name: 'Write an article' });
    expect(within(form).getByRole('option', { name: 'Intermediate' })).toBeTruthy();
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'Write an article' })).toBeNull();
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

  describe('changing the folders from the tree (T42)', () => {
    const menu = (name: string) => {
      fireEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }));
    };

    it('makes a folder from a folder row menu', async () => {
      const { bridge } = setup(null, (b) => b.on('library:create-folder', () => TREE));
      await screen.findByRole('list', { name: 'Library folders' });
      menu('Clippings');
      fireEvent.click(screen.getByRole('menuitem', { name: 'New folder' }));
      const dialog = screen.getByRole('dialog', { name: 'New folder' });
      const input = within(dialog).getByRole('textbox', { name: 'Name' });
      fireEvent.change(input, { target: { value: '.hidden' } });
      expect(within(dialog).getByRole('alert').textContent).toMatch(/dot/);
      expect(within(dialog).getByRole('button', { name: 'Create' }).hasAttribute('disabled')).toBe(
        true,
      );
      fireEvent.change(input, { target: { value: 'Graphs' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(bridge.calls.find((c) => c.channel === 'library:create-folder')?.request).toEqual({
        at: { folderId: 'f1', path: 'Clippings' },
        name: 'Graphs',
      });
    });

    it('a library folder itself can only get a new folder', async () => {
      setup(null);
      await screen.findByRole('list', { name: 'Library folders' });
      menu('Vault');
      expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['New folder']);
    });

    it('moves an article with Move to…, offering only other folders', async () => {
      const { bridge } = setup(null, (b) => b.on('library:move', () => TREE));
      await screen.findByRole('list', { name: 'Library folders' });
      menu('Binary search');
      fireEvent.click(screen.getByRole('menuitem', { name: 'Move to…' }));
      const dialog = screen.getByRole('dialog', { name: 'Move “Binary search”' });
      // It is in Clippings: only the vault's root is offered.
      expect(within(dialog).getAllByRole('radio')).toHaveLength(1);
      fireEvent.click(within(dialog).getByRole('radio', { name: 'Vault' }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(bridge.calls.find((c) => c.channel === 'library:move')?.request).toEqual({
        item: { kind: 'article', id: 'a1' },
        to: { folderId: 'f1', path: '' },
      });
    });

    it('moves by drag and drop, never into itself', async () => {
      const { bridge } = setup(null, (b) => b.on('library:move', () => TREE));
      const tree = await screen.findByRole('list', { name: 'Library folders' });
      const dt = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
      const reading = within(tree).getByRole('link', { name: 'Reading list' });
      const clippings = within(tree).getByRole('button', { name: 'Clippings' });
      fireEvent.dragStart(reading, { dataTransfer: dt });
      fireEvent.dragOver(clippings, { dataTransfer: dt });
      expect(clippings.closest('li')!.classList.contains('lib-drop')).toBe(true);
      fireEvent.drop(clippings, { dataTransfer: dt });
      await waitFor(() => expect(bridge.channels()).toContain('library:move'));
      expect(bridge.calls.find((c) => c.channel === 'library:move')?.request).toEqual({
        item: { kind: 'article', id: 'a3' },
        to: { folderId: 'f1', path: 'Clippings' },
      });
      // A folder dropped on itself: nothing happens.
      fireEvent.dragStart(clippings, { dataTransfer: dt });
      fireEvent.drop(clippings, { dataTransfer: dt });
      fireEvent.dragEnd(clippings, { dataTransfer: dt });
      expect(bridge.channels().filter((c) => c === 'library:move')).toHaveLength(1);
    });

    it('deletes to the trash after a confirm, and shows a refusal', async () => {
      const { bridge } = setup('a3', (b) =>
        b.on('library:delete', ({ item }) => {
          if (item.kind === 'folder') throw new Refused('unavailable', 'It could not be moved.');
          return {
            folders: [{ ...TREE.folders[0]!, root: { ...TREE.folders[0]!.root, articles: [] } }],
          };
        }),
      );
      await screen.findByRole('list', { name: 'Library folders' });
      menu('Reading list');
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
      const dialog = screen.getByRole('dialog', { name: 'Delete “Reading list”?' });
      expect(dialog.textContent).toMatch(/trash/);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Move to trash' }));
      await waitFor(() => expect(window.location.hash).toBe('#/library'));
      expect(screen.queryByText('Reading list')).toBeNull();

      menu('Clippings');
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
      fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));
      expect(await screen.findByText('It could not be moved.')).toBeTruthy();
      expect(bridge.channels().filter((c) => c === 'library:delete')).toHaveLength(2);
    });

    it('offers to delete the chats of a missing article', async () => {
      setup(null);
      await screen.findByRole('list', { name: 'Library folders' });
      menu('Graph basics');
      expect(screen.getByRole('menuitem', { name: 'Move to…' }).hasAttribute('disabled')).toBe(
        true,
      );
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
      expect(screen.getByRole('button', { name: 'Delete chats' })).toBeTruthy();
    });
  });
});
