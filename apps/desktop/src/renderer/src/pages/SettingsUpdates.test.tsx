// @vitest-environment jsdom
/**
 * Settings → Updates (T13): shows the updater's state from `updates:watch`
 * and offers the one action that fits it.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AppProvider } from '../lib/app';
import { FakeBridge, installBridge } from '../test/fake-bridge';
import { baseHandlers } from '../test/fixtures';
import { UpdatesSection } from './SettingsUpdates';

function renderSection(bridge: FakeBridge) {
  installBridge(bridge);
  render(
    <AppProvider>
      <UpdatesSection version="1.0.0" />
    </AppProvider>,
  );
}

async function watchStream(bridge: FakeBridge) {
  await waitFor(() => expect(bridge.streams.some((s) => s.channel === 'updates:watch')).toBe(true));
  return bridge.streams.find((s) => s.channel === 'updates:watch')!;
}

afterEach(cleanup);

describe('UpdatesSection', () => {
  it('explains a development build and offers no actions', async () => {
    const bridge = baseHandlers(new FakeBridge());
    renderSection(bridge);
    const w = await watchStream(bridge);
    act(() =>
      w.emit({ state: 'unsupported', reason: 'Updates are checked only in installed builds.' }),
    );
    expect(await screen.findByText('Updates are checked only in installed builds.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('checks, downloads on request, then restarts to update', async () => {
    const bridge = baseHandlers(new FakeBridge())
      .on('updates:check', () => ({ state: 'checking' }))
      .on('updates:download', () => ({ state: 'downloading', version: '1.1.0', percent: 0 }))
      .on('updates:restart', () => ({ restarting: true }));
    renderSection(bridge);
    const w = await watchStream(bridge);
    act(() => w.emit({ state: 'idle' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Check now' }));
    await waitFor(() => expect(bridge.channels()).toContain('updates:check'));
    act(() => w.emit({ state: 'available', version: '1.1.0' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Download' }));
    await waitFor(() => expect(bridge.channels()).toContain('updates:download'));
    act(() => w.emit({ state: 'downloading', version: '1.1.0', percent: 57 }));
    expect(await screen.findByText('Downloading version 1.1.0… 57%')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check now' }).hasAttribute('disabled')).toBe(true);
    act(() => w.emit({ state: 'downloaded', version: '1.1.0' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restart to update' }));
    await waitFor(() => expect(bridge.channels()).toContain('updates:restart'));
  });

  it('shows a failed check', async () => {
    const bridge = baseHandlers(new FakeBridge());
    renderSection(bridge);
    const w = await watchStream(bridge);
    act(() => w.emit({ state: 'error', message: 'HttpError: 404' }));
    expect(await screen.findByText('Could not update: HttpError: 404')).toBeTruthy();
  });
});
