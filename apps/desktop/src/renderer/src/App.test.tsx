// @vitest-environment jsdom
/** The shell: first run goes to Welcome, Next problem opens a problem, the theme setting. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { FakeBridge, installBridge } from './test/fake-bridge';
import { baseHandlers, DETAIL, PROFILE, WORKSPACE } from './test/fixtures';

beforeEach(() => window.history.replaceState(null, '', '/index.html'));
afterEach(cleanup);

describe('App', () => {
  it('sends a first run to Welcome, and "use defaults" to Home', async () => {
    let onboarded = false;
    const bridge = baseHandlers(new FakeBridge(), { onboarded: false, profile: null });
    bridge
      .on('profile:get', () => (onboarded ? PROFILE : { onboarded: false, profile: null }))
      .on('profile:defaults', () => {
        onboarded = true;
        return PROFILE;
      });
    installBridge(bridge);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeTruthy();
    expect(window.location.hash).toBe('#/welcome');
    fireEvent.click(screen.getByRole('button', { name: 'Use defaults and start' }));
    expect(await screen.findByRole('heading', { name: 'Practice' })).toBeTruthy();
    expect(window.location.hash).toBe('#/');
  });

  it('Next problem starts the recommended problem and opens it', async () => {
    const bridge = baseHandlers(new FakeBridge())
      .on('problems:next', () => ({
        action: 'solve',
        slug: 'pair-with-target',
        title: 'Two Receipts',
        source: 'curated',
        topic: 'hashing',
        topic_name: 'Hash maps & sets',
        difficulty: 'easy',
        focus_changed: true,
        reason: 'Starting with hash maps.',
      }))
      .on('problems:start', () => ({
        slug: 'pair-with-target',
        resumed: false,
        language: 'python',
        workspace: 'workspace/pair-with-target/solution.py',
        workspace_created: true,
        hints_used: 0,
      }))
      .on('problems:get', () => ({ ...DETAIL, status: 'active' }))
      .on('workspace:get', () => ({ ...WORKSPACE, exists: true }));
    installBridge(bridge);
    render(<App />);
    await screen.findByRole('heading', { name: 'Practice' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Next problem' })[0]!);
    expect(await screen.findByText('Two Receipts', { selector: 'h1' })).toBeTruthy();
    expect(window.location.hash).toBe('#/p/pair-with-target');
    expect(screen.getByText('Starting with hash maps.')).toBeTruthy();
  });

  it('changes the theme through the main process', async () => {
    const bridge = baseHandlers(new FakeBridge());
    installBridge(bridge);
    render(<App />);
    const select = await screen.findByRole('combobox', { name: 'Theme' });
    fireEvent.change(select, { target: { value: 'dark' } });
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe('dark'));
    expect(bridge.calls.find((c) => c.channel === 'settings:set-theme')?.request).toEqual({
      theme: 'dark',
    });
  });
});
