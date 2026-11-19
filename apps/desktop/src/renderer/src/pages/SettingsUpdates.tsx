/**
 * Settings → Updates (T13, SPEC §11): version, channel, automatic updates,
 * the updater's state, "Check now", "Download" and "Restart to update".
 */
import { useEffect, useState } from 'react';
import type { UpdateState } from '../../../shared/updates';
import { invoke, stream } from '../ipc';
import { errorText, useApp } from '../lib/app-context';

function describe(s: UpdateState): string {
  switch (s.state) {
    case 'unsupported':
      return s.reason;
    case 'idle':
      return 'Not checked yet.';
    case 'checking':
      return 'Checking for updates…';
    case 'none':
      return `Up to date (checked ${new Date(s.checkedAt).toLocaleString()}).`;
    case 'available':
      return `Version ${s.version} is available.`;
    case 'downloading':
      return `Downloading version ${s.version}… ${s.percent}%`;
    case 'downloaded':
      return `Version ${s.version} is ready. It installs when the app quits, or restart now.`;
    case 'error':
      return `Could not update: ${s.message}`;
  }
}

export function UpdatesSection({ version }: { version: string | null }) {
  const app = useApp();
  const s = app.settings?.settings.updates;
  const [state, setState] = useState<UpdateState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const watch = stream('updates:watch', undefined, setState);
    watch.result.catch(() => undefined);
    return () => watch.cancel();
  }, []);

  async function act(fn: () => Promise<UpdateState | { restarting: boolean }>): Promise<void> {
    setError(null);
    try {
      const r = await fn();
      if ('state' in r) setState(r);
    } catch (e) {
      setError(errorText(e));
    }
  }

  if (!s) return null;
  const supported = state !== null && state.state !== 'unsupported';
  return (
    <section className="card" aria-labelledby="settings-updates">
      <h2 id="settings-updates">Updates</h2>
      <dl className="kv">
        <dt>Version</dt>
        <dd>{version ?? '…'}</dd>
      </dl>
      <label className="field">
        Channel
        <select
          aria-label="Update channel"
          value={s.channel}
          onChange={(e) =>
            void app.updateSettings({ updates: { channel: e.target.value as typeof s.channel } })
          }
        >
          <option value="stable">Stable</option>
          <option value="beta">Beta (pre-releases)</option>
        </select>
      </label>
      <label className="radio">
        <input
          type="checkbox"
          checked={s.auto}
          onChange={(e) => void app.updateSettings({ updates: { auto: e.target.checked } })}
        />{' '}
        Download updates in the background and install them when the app quits
      </label>
      <p className="muted small" role="status" data-testid="update-state">
        {state ? describe(state) : '…'}
      </p>
      {supported && (
        <div className="actions">
          {state.state === 'downloaded' ? (
            <button
              type="button"
              className="primary"
              onClick={() => void act(() => invoke('updates:restart'))}
            >
              Restart to update
            </button>
          ) : state.state === 'available' ? (
            <button type="button" onClick={() => void act(() => invoke('updates:download'))}>
              Download
            </button>
          ) : (
            <button
              type="button"
              disabled={state.state === 'checking' || state.state === 'downloading'}
              onClick={() => void act(() => invoke('updates:check'))}
            >
              Check now
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
