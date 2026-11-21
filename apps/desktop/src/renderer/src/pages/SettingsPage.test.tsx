// @vitest-environment jsdom
/**
 * Settings (T09): every change goes to main at once; the API key is sent once
 * and never shown again; key sources and weak storage are explained; reset
 * goes through main (which confirms and backs up).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { KeyStatusView } from '../../../shared/settings';
import { Toasts } from '../components/Toasts';
import { AppProvider } from '../lib/app';
import { FakeBridge, installBridge, Refused } from '../test/fake-bridge';
import { baseHandlers, KEY_NONE, PROFILE, TUTOR_ON } from '../test/fixtures';
import { SettingsPage } from './SettingsPage';
import { reasonHere } from './settings-text';

const FAKE_KEY = 'sk-ant-test-0000000000000000000000-WXYZ';

function bridgeWith(key: KeyStatusView = KEY_NONE): FakeBridge {
  let status = key;
  return baseHandlers(new FakeBridge())
    .on('secrets:status', () => status)
    .on('secrets:set-key', () => {
      status = { ...status, source: 'stored', hint: '…WXYZ', stored: true };
      return status;
    })
    .on('secrets:clear-key', () => {
      status = { ...status, source: 'none', hint: null, stored: false };
      return status;
    })
    .on('tutor:test', () => ({
      ok: true,
      kind: null,
      message: 'Connected. The tutor will use claude-opus-5-5.',
      model: 'claude-opus-5-5',
    }))
    .on('exec:status', () => ({
      python: { available: true, reason: null, versions: { pyodide: '314.0.7' } },
    }))
    .on('data:info', () => ({ dir: '/data', backups: '/data/backups' }))
    .on('data:reset', () => ({ done: true, backup: '/data/backups/x.zip', restarting: false }))
    .on('app:version', () => ({ app: '0.1.0', electron: '45.3.4', chrome: '1', node: '24' }))
    .on('profile:set', () => PROFILE);
}

function renderPage(bridge: FakeBridge) {
  installBridge(bridge);
  return render(
    <AppProvider>
      <SettingsPage />
      <Toasts />
    </AppProvider>,
  );
}

const setCalls = (b: FakeBridge) =>
  b.calls.filter((c) => c.channel === 'settings:set').map((c) => c.request);

beforeEach(() => window.history.replaceState(null, '', '/index.html'));
afterEach(cleanup);

describe('SettingsPage', () => {
  it('sends model, effort, backend, editor and time-limit changes at once', async () => {
    const bridge = bridgeWith();
    renderPage(bridge);
    const effort = await screen.findByRole('combobox', { name: 'Effort' });
    fireEvent.change(effort, { target: { value: 'high' } });
    await waitFor(() => expect((effort as HTMLSelectElement).value).toBe('high'));

    const model = screen.getByRole('textbox', { name: 'Model' });
    expect(model.getAttribute('placeholder')).toBe('Default: claude-opus-5-5');
    fireEvent.change(model, { target: { value: ' claude-sonnet-5-5 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save model' }));
    await waitFor(() => expect(setCalls(bridge)).toHaveLength(2));

    fireEvent.change(screen.getByRole('combobox', { name: 'Tutor backend' }), {
      target: { value: 'none' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Editor keys' }), {
      target: { value: 'vim' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Editor font size' }), {
      target: { value: '18' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Time limit multiplier' }), {
      target: { value: '2' },
    });
    await waitFor(() => expect(setCalls(bridge)).toHaveLength(6));
    expect(setCalls(bridge)).toEqual([
      { tutor: { effort: 'high' } },
      { tutor: { model: 'claude-sonnet-5-5' } },
      { tutor: { backend: 'none' } },
      { editor: { keymap: 'vim' } },
      { editor: { fontSize: 18 } },
      { execution: { timeScale: 2 } },
    ]);
    // Each change refreshes the tutor's status (the top bar and the status line).
    expect(bridge.calls.filter((c) => c.channel === 'tutor:status').length).toBeGreaterThan(1);
  });

  it('lists the sections and jumps to one, which becomes the current section', async () => {
    renderPage(bridgeWith());
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' });
    const items = [...nav.querySelectorAll('button')].map((b) => b.textContent);
    expect(items).toEqual([
      'Tutor',
      'Code execution',
      'Appearance',
      'Library',
      'Profile',
      'Data',
      'Updates',
      'About',
    ]);
    const tutor = screen.getByRole('button', { name: 'Tutor' });
    expect(tutor.getAttribute('aria-current')).toBe('true');
    await screen.findByRole('heading', { name: 'Library' });
    fireEvent.click(screen.getByRole('button', { name: 'Library' }));
    expect(screen.getByRole('button', { name: 'Library' }).getAttribute('aria-current')).toBe(
      'true',
    );
    expect(tutor.hasAttribute('aria-current')).toBe(false);
    // The section's heading takes focus, so keyboard users land in it.
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Library' }));
    // Every section stays on the page: controls of the others are still there.
    expect(screen.getByRole('button', { name: 'Add folder…' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Theme' })).toBeTruthy();
  });

  it('shows the tutor status as a dot and words', async () => {
    renderPage(bridgeWith().on('tutor:status', () => TUTOR_ON));
    await waitFor(() =>
      expect(screen.getByTestId('tutor-status-line').querySelector('.tone-ok')).toBeTruthy(),
    );
    const line = screen.getByTestId('tutor-status-line').textContent;
    expect(line).toMatch(/^StatusOn: Anthropic API/);
    expect(line).not.toMatch(/ · /);
  });

  it('says where to add the key in words that fit this page', async () => {
    renderPage(
      bridgeWith().on('tutor:status', () => ({
        ...TUTOR_ON,
        available: false,
        reason: 'No tutor is set up. Add an Anthropic API key in Settings to use the tutor.',
      })),
    );
    await waitFor(() =>
      expect(screen.getByTestId('tutor-status-line').textContent).toBe(
        'StatusOff: No tutor is set up. Add an Anthropic API key below to use the tutor.',
      ),
    );
    expect(reasonHere('The tutor is turned off in Settings.')).toBe(
      'The backend below is set to Off.',
    );
    expect(reasonHere('Add the key in Settings → Tutor.')).toBe('Add the key below.');
  });

  it('sends the key once, clears the field, shows only the last four characters', async () => {
    const bridge = bridgeWith();
    renderPage(bridge);
    expect((await screen.findByTestId('key-status')).textContent).toContain('No key');
    const input = screen.getByLabelText('Anthropic API key') as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.change(input, { target: { value: FAKE_KEY } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and test' }));
    expect((await screen.findByTestId('test-result')).textContent).toContain('Connected');
    expect(screen.getByTestId('key-status').textContent).toContain('Stored, ends in …WXYZ');
    expect((screen.getByLabelText('Replace the key') as HTMLInputElement).value).toBe('');
    expect(document.body.innerHTML).not.toContain(FAKE_KEY);
    const withKey = bridge.calls.filter((c) =>
      JSON.stringify(c.request ?? null).includes(FAKE_KEY),
    );
    expect(withKey.map((c) => c.channel)).toEqual(['secrets:set-key']);

    fireEvent.click(screen.getByRole('button', { name: 'Remove stored key' }));
    await waitFor(() => expect(screen.getByTestId('key-status').textContent).toContain('No key'));
  });

  it('shows an environment key as read-only, and warns about weak storage', async () => {
    renderPage(
      bridgeWith({
        source: 'environment',
        hint: '…abcd',
        stored: false,
        storage: { available: true, backend: 'basic_text', weak: true },
        problem: null,
      }),
    );
    expect((await screen.findByTestId('key-status')).textContent).toContain(
      'From the environment (ANTHROPIC_API_KEY), ends in …abcd',
    );
    expect(screen.queryByLabelText('Anthropic API key')).toBeNull();
    expect(screen.getByTestId('weak-storage').textContent).toContain('weak encryption');
  });

  it('shows the tutor status and the settings.json problems', async () => {
    const bridge = bridgeWith().on('tutor:status', () => TUTOR_ON);
    bridge.on('settings:get', () => ({
      settings: {
        tutor: { backend: 'auto', model: null, effort: 'medium', claudeCodePath: null },
        execution: { runtime: 'local', timeScale: 1 },
        editor: { fontSize: 14, keymap: 'default' },
        ui: { theme: 'system', leader: 'ctrl+b' },
        updates: { channel: 'stable', auto: true },
        library: { images: 'on-open', readAloudGpu: false },
      },
      issues: [{ key: 'ui.theme', message: '"neon" is not valid; using "system"' }],
      default_model: 'claude-opus-5-5',
    }));
    renderPage(bridge);
    expect((await screen.findByTestId('settings-issues')).textContent).toContain('ui.theme');
    await waitFor(() =>
      expect(screen.getByTestId('tutor-status-line').textContent).toContain('claude-opus-5-5'),
    );
    expect((await screen.findByTestId('exec-status')).textContent).toContain('pyodide 314.0.7');
  });

  it('Claude Code: status, a path to use instead, and recheck', async () => {
    let info = {
      found: false,
      path: null as string | null,
      version: null as string | null,
      usable: false,
      reason: 'Claude Code was not found.' as string | null,
      min_version: '2.1.328',
    };
    const bridge = bridgeWith().on('tutor:claude-code', () => info);
    renderPage(bridge);
    expect(await screen.findByLabelText('Tutor backend')).toBeTruthy();
    expect(screen.queryByTestId('claude-code')).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Tutor backend' }), {
      target: { value: 'claude-code' },
    });
    expect((await screen.findByTestId('claude-code-status')).textContent).toContain(
      'Claude Code was not found.',
    );
    expect(screen.getByTestId('claude-code').textContent).toContain('2.1.328 or later');
    expect(screen.getByTestId('claude-code').textContent).toMatch(/not the\s+Claude account/);

    info = {
      ...info,
      found: true,
      path: '/opt/claude',
      version: '2.1.400',
      usable: true,
      reason: null,
    };
    fireEvent.change(screen.getByLabelText('Claude Code path'), {
      target: { value: ' /opt/claude ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save path' }));
    await waitFor(() =>
      expect(setCalls(bridge).at(-1)).toEqual({ tutor: { claudeCodePath: '/opt/claude' } }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('claude-code-status').textContent).toBe(
        'Claude CodeFound: /opt/claude (version 2.1.400)',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Recheck' }));
    await waitFor(() =>
      expect(
        bridge.calls.filter((c) => c.channel === 'tutor:claude-code').map((c) => c.request),
      ).toContainEqual({ recheck: true }),
    );
  });

  it('reset progress goes to main and reports the backup', async () => {
    const bridge = bridgeWith();
    renderPage(bridge);
    fireEvent.click(await screen.findByRole('button', { name: 'Reset progress…' }));
    expect(
      await screen.findByText(/Progress reset\. A backup is at \/data\/backups\/x\.zip/),
    ).toBeTruthy();
    expect(bridge.calls.find((c) => c.channel === 'data:reset')?.request).toEqual({
      scope: 'progress',
    });
  });

  it('shows a refused key as an error and keeps the field', async () => {
    const bridge = bridgeWith().on('secrets:set-key', () => {
      throw new Refused('invalid_key', 'That does not look like an API key (wrong length).');
    });
    renderPage(bridge);
    const input = (await screen.findByLabelText('Anthropic API key')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and test' }));
    expect(await screen.findByText(/wrong length/)).toBeTruthy();
    expect(input.value).toBe('short');
  });
});
