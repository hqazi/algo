// @vitest-environment jsdom
/**
 * Linked images in the reader and Settings → Library (T23, SPEC §15.4): the
 * reader asks main by article id (never a URL), shows Load images in `ask`
 * mode and Retry after a failure; Settings shows the cache, Clear, the mode,
 * and "Make available offline" with progress and Cancel.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ArticleView, ImageView } from '../../../shared/library';
import { Toasts } from '../components/Toasts';
import { AppProvider } from '../lib/app';
import { LibrarySection } from '../pages/SettingsLibrary';
import { FakeBridge, installBridge } from '../test/fake-bridge';
import { baseHandlers } from '../test/fixtures';
import { Reader } from './Reader';

const URL1 = 'https://cdn.example.com/x.png';
const ASSET = 'tutor-app://app/library-asset/abcdefghijklmnop0123';
const PENDING: ImageView = { kind: 'blocked', reason: 'remote', host: 'cdn.example.com' };

const article = (): ArticleView => ({
  id: 'a1',
  title: 'Pictures',
  source: null,
  author: [],
  published: null,
  created: null,
  description: null,
  tags: [],
  extra: [],
  missing: false,
  body: `![chart](${URL1})`,
  images: { [URL1]: PENDING },
  links: {},
});

function show(bridge: FakeBridge, node: ReactNode) {
  installBridge(bridge);
  render(
    <AppProvider>
      {node}
      <Toasts />
    </AppProvider>,
  );
}

const img = () => document.querySelector('.article-body img');

afterEach(cleanup);

describe('reader', () => {
  it('on-open: asks main by id and shows the cached image', async () => {
    const bridge = baseHandlers(new FakeBridge())
      .on('library:article', () => article())
      .on('library:load-images', () => ({
        mode: 'on-open',
        images: { [URL1]: { kind: 'asset', url: ASSET } },
      }));
    show(bridge, <Reader id="a1" />);
    await waitFor(() => expect(img()?.getAttribute('src')).toBe(ASSET));
    const req = bridge.calls.find((c) => c.channel === 'library:load-images')!.request;
    expect(req).toEqual({ id: 'a1', force: false, retry: false });
    expect(screen.queryByTestId('images-bar')).toBeNull();
  });

  it('ask: shows Load images, then loads with force', async () => {
    let forced = false;
    const bridge = baseHandlers(new FakeBridge())
      .on('library:article', () => article())
      .on('library:load-images', ({ force }) => {
        forced ||= force;
        return {
          mode: 'ask',
          images: { [URL1]: force ? { kind: 'asset', url: ASSET } : PENDING },
        };
      });
    show(bridge, <Reader id="a1" />);
    const button = await screen.findByRole('button', { name: 'Load images' });
    expect(screen.getByTestId('images-bar').textContent).toContain('1 linked image not loaded');
    expect(img()).toBeNull();
    fireEvent.click(button);
    await waitFor(() => expect(img()?.getAttribute('src')).toBe(ASSET));
    expect(forced).toBe(true);
  });

  it('a failed download shows its reason and Retry', async () => {
    const answers: ImageView[] = [
      { kind: 'blocked', reason: 'local_address', host: 'cdn.example.com' },
      { kind: 'asset', url: ASSET },
    ];
    const seen: unknown[] = [];
    const bridge = baseHandlers(new FakeBridge())
      .on('library:article', () => article())
      .on('library:load-images', (r) => {
        seen.push(r);
        return { mode: 'on-open', images: { [URL1]: answers.shift()! } };
      });
    show(bridge, <Reader id="a1" />);
    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(document.querySelector('.img-placeholder')?.textContent).toContain(
      'not loaded: local network address',
    );
    fireEvent.click(retry);
    await waitFor(() => expect(img()?.getAttribute('src')).toBe(ASSET));
    expect(seen.at(-1)).toEqual({ id: 'a1', force: true, retry: true });
  });
});

describe('Settings → Library', () => {
  const VAULT = { id: 'f1', name: 'Vault', articles: 2, missing: 0, error: null };

  it('shows the cache size and clears it; changes the mode', async () => {
    const bridge = baseHandlers(new FakeBridge())
      .on('library:folders', () => ({ folders: [VAULT] }))
      .on('library:image-cache', () => ({ images: 3, bytes: 2 * 1024 * 1024 }))
      .on('library:clear-image-cache', () => ({ images: 0, bytes: 0 }));
    show(bridge, <LibrarySection />);
    await waitFor(() =>
      expect(screen.getByTestId('image-cache').textContent).toContain('3 images, 2.0 MB'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() =>
      expect(screen.getByTestId('image-cache').textContent).toContain('0 images, 0 B'),
    );
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveProperty('disabled', false));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ask' } });
    await waitFor(() =>
      expect(bridge.calls.find((c) => c.channel === 'settings:set')?.request).toEqual({
        library: { images: 'ask' },
      }),
    );
  });

  it('Make available offline shows progress and can be cancelled', async () => {
    const bridge = baseHandlers(new FakeBridge()).on('library:folders', () => ({
      folders: [VAULT],
    }));
    show(bridge, <LibrarySection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Make available offline' }));
    const s = bridge.streams.find((x) => x.channel === 'library:offline')!;
    expect(s.request).toEqual({ id: 'f1' });
    s.emit({ done: 1, total: 2, failed: 1 });
    await waitFor(() =>
      expect(screen.getByTestId('offline-f1').textContent).toBe(
        'Downloading images: 1 of 2 articles, 1 image could not be loaded',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel download' }));
    expect(s.cancelled).toBe(true);
    await waitFor(() => expect(screen.getByTestId('offline-f1').textContent).toMatch(/^Stopped/));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
