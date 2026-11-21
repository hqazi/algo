// @vitest-environment jsdom
/**
 * Settings → Library (T21): empty state, adding with the OS picker (main),
 * removing only after a confirm, and the read-only line; read aloud's
 * "Use the GPU" (T39).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { FolderView } from '../../../shared/library';
import { Toasts } from '../components/Toasts';
import { AppProvider } from '../lib/app';
import { FakeBridge, installBridge, Refused } from '../test/fake-bridge';
import { baseHandlers } from '../test/fixtures';
import { LibrarySection } from './SettingsLibrary';

const VAULT: FolderView = { id: 'f1', name: 'Vault', articles: 3, missing: 1, error: null };

function renderSection(bridge: FakeBridge) {
  installBridge(bridge);
  render(
    <AppProvider>
      <LibrarySection />
      <Toasts />
    </AppProvider>,
  );
}

afterEach(cleanup);

describe('LibrarySection', () => {
  it('shows the empty state and the read-only line', async () => {
    renderSection(baseHandlers(new FakeBridge()));
    expect(await screen.findByTestId('library-empty')).toBeTruthy();
    expect(screen.getByTestId('library-read-only').textContent).toBe(
      'The app reads these folders and never changes them.',
    );
  });

  it('adds a folder with the picker, and does nothing when cancelled', async () => {
    let added = false;
    const bridge = baseHandlers(new FakeBridge())
      .on('library:folders', () => ({ folders: [] }))
      .on('library:add-folder', () =>
        added ? { added: true, folders: [VAULT] } : ((added = true), { added: false, folders: [] }),
      );
    renderSection(bridge);
    await screen.findByTestId('library-empty');
    fireEvent.click(screen.getByRole('button', { name: 'Add folder…' }));
    await waitFor(() => expect(bridge.channels()).toContain('library:add-folder'));
    expect(screen.getByTestId('library-empty')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add folder…' }));
    const row = await screen.findByTestId('library-folder-f1');
    expect(row.textContent).toContain('Vault');
    expect(row.textContent).toContain('3 articles, 1 file missing');
  });

  it('shows a refusal from main', async () => {
    const bridge = baseHandlers(new FakeBridge()).on('library:add-folder', () => {
      throw new Refused('duplicate', 'That folder is already in the library.');
    });
    renderSection(bridge);
    await screen.findByTestId('library-empty');
    fireEvent.click(screen.getByRole('button', { name: 'Add folder…' }));
    expect(await screen.findByText('That folder is already in the library.')).toBeTruthy();
  });

  it('removes a folder only after confirming, and opens it in the file manager', async () => {
    const bridge = baseHandlers(new FakeBridge())
      .on('library:folders', () => ({ folders: [VAULT] }))
      .on('library:open-folder', () => ({ opened: true }))
      .on('library:remove-folder', () => ({ folders: [] }));
    renderSection(bridge);
    const row = await screen.findByTestId('library-folder-f1');
    fireEvent.click(within(row).getByRole('button', { name: 'Open in file manager' }));
    await waitFor(() => expect(bridge.channels()).toContain('library:open-folder'));

    fireEvent.click(within(row).getByRole('button', { name: 'Remove…' }));
    const ask = screen.getByRole('group', { name: 'Remove Vault?' });
    expect(ask.textContent).toContain('Its files are not touched.');
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(bridge.channels()).not.toContain('library:remove-folder');

    fireEvent.click(within(row).getByRole('button', { name: 'Remove…' }));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Remove Vault?' })).getByRole('button', {
        name: 'Remove',
      }),
    );
    expect(await screen.findByTestId('library-empty')).toBeTruthy();
    expect(bridge.calls.find((c) => c.channel === 'library:remove-folder')?.request).toEqual({
      id: 'f1',
    });
  });

  it('read aloud runs on the CPU unless "Use the GPU" is turned on', async () => {
    const bridge = baseHandlers(new FakeBridge()).on('tts:status', () => ({
      installed: true,
      bytes: 340_154_952,
      downloading: false,
      engine: { device: 'cpu', speed: 3.6, gpu: null, fellBack: true },
    }));
    renderSection(bridge);
    await waitFor(() =>
      expect(screen.getByTestId('read-aloud-voice').textContent).toContain(
        'No GPU could be used, so it runs on the CPU, 3.6× faster than real time.',
      ),
    );
    const box = screen.getByRole('checkbox', { name: 'Use the GPU' });
    await waitFor(() => expect(box).toHaveProperty('disabled', false));
    expect(box).toHaveProperty('checked', false);
    fireEvent.click(box);
    await waitFor(() =>
      expect(bridge.calls.find((c) => c.channel === 'settings:set')?.request).toEqual({
        library: { readAloudGpu: true },
      }),
    );
    await waitFor(() => expect(box).toHaveProperty('checked', true));
  });
});
