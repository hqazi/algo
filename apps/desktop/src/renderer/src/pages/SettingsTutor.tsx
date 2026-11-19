/**
 * Settings → Tutor (SPEC §8): backend, API key (entered here, stored by main
 * in the OS keychain, shown back only as "…abcd"), test connection, model,
 * effort, and the tutor's status. `KeyForm` is also onboarding's "Connect
 * the tutor" step.
 */
import { useEffect, useState, type FormEvent } from 'react';
import type { KeyStatusView, TestResultView } from '../../../shared/settings';
import { useChatStore, useTutorStatus } from '../chat/store';
import { invoke } from '../ipc';
import { errorText, useApp } from '../lib/app-context';
import { keyText, useKeyStatus } from './SettingsShared';

const BACKENDS = [
  { id: 'auto', label: 'Automatic (Anthropic API when a key is set)' },
  { id: 'anthropic', label: 'Anthropic API' },
  { id: 'claude-code', label: 'Claude Code (not available yet)' },
  { id: 'none', label: 'Off' },
] as const;
const EFFORTS = ['low', 'medium', 'high'] as const;

export interface KeyFormProps {
  status: KeyStatusView | null;
  onStatus: (s: KeyStatusView) => void;
  /** After a key is saved and tested. */
  onConnected?: (result: TestResultView) => void;
}

export function KeyForm({ status, onStatus, onConnected }: KeyFormProps) {
  const { notify } = useApp();
  const chat = useChatStore();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<TestResultView | null>(null);

  async function runTest(): Promise<TestResultView | null> {
    try {
      const r = await invoke('tutor:test');
      setTest(r);
      return r;
    } catch (err) {
      notify(errorText(err), 'error');
      return null;
    } finally {
      void chat.refreshStatus();
    }
  }

  async function save(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setTest(null);
    try {
      const s = await invoke('secrets:set-key', { key });
      // The key is in the keychain now; the page keeps no copy.
      setKey('');
      onStatus(s);
      const r = await runTest();
      if (r?.ok) onConnected?.(r);
    } catch (err) {
      notify(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    setBusy(true);
    try {
      onStatus(await invoke('secrets:clear-key'));
      setTest(null);
      void chat.refreshStatus();
      notify('The stored API key was removed.', 'success');
    } catch (err) {
      notify(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function testNow(): Promise<void> {
    setBusy(true);
    try {
      await runTest();
    } finally {
      setBusy(false);
    }
  }

  const fromEnv = status?.source === 'environment';
  return (
    <div className="key-form">
      {status && (
        <p data-testid="key-status">
          <strong>API key:</strong> {keyText(status)}
          {fromEnv && status.stored && (
            <span className="muted small">
              {' '}
              (a stored key is also kept; the environment’s wins)
            </span>
          )}
        </p>
      )}
      {status?.problem && <p className="error-text small">{status.problem}</p>}
      {status?.storage.weak && (
        <p className="warning small" role="note" data-testid="weak-storage">
          No system keyring was found, so the key is stored with weak encryption that any program
          running as you could undo. Install and unlock a keyring (GNOME Keyring or KWallet), or set
          ANTHROPIC_API_KEY instead.
        </p>
      )}
      {status && !status.storage.available && !fromEnv && (
        <p className="error-text small">
          This system cannot store the key safely. Set ANTHROPIC_API_KEY in the environment instead.
        </p>
      )}
      {fromEnv ? (
        <p className="muted small">
          The key from the environment is read-only here. Unset ANTHROPIC_API_KEY to use a stored
          key.
        </p>
      ) : (
        <form className="inline-form" onSubmit={(e) => void save(e)}>
          <label className="field">
            {status?.source === 'stored' ? 'Replace the key' : 'Anthropic API key'}
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-ant-…"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              aria-label="Anthropic API key"
            />
          </label>
          <button type="submit" className="primary" disabled={busy || !key.trim()}>
            Save and test
          </button>
        </form>
      )}
      <div className="actions">
        <button
          type="button"
          onClick={() => void testNow()}
          disabled={busy || !status || status.source === 'none'}
        >
          Test connection
        </button>
        {status?.stored && (
          <button type="button" onClick={() => void remove()} disabled={busy}>
            Remove stored key
          </button>
        )}
      </div>
      {test && (
        <p
          className={test.ok ? 'pass-text small' : 'error-text small'}
          role="status"
          data-testid="test-result"
        >
          {test.message}
        </p>
      )}
      <p className="muted small">
        Get a key at console.anthropic.com. The key is kept in your system keychain and used only by
        the app’s main process; this page never sees it again.
      </p>
    </div>
  );
}

/** Keyed by the saved model, so a saved change resets the field. */
function ModelForm({
  saved,
  defaultModel,
  onSave,
}: {
  saved: string | null;
  defaultModel: string;
  onSave: (model: string | null) => void;
}) {
  const [model, setModel] = useState(saved ?? '');
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(model.trim() || null);
      }}
    >
      <label className="field">
        Model
        <input
          aria-label="Model"
          spellCheck={false}
          value={model}
          placeholder={`Default: ${defaultModel}`}
          onChange={(e) => setModel(e.target.value)}
        />
      </label>
      <button type="submit" disabled={(saved ?? '') === model.trim()}>
        Save model
      </button>
    </form>
  );
}

export function TutorSection() {
  const app = useApp();
  const chat = useChatStore();
  const tutor = useTutorStatus(chat);
  const [keyStatus, setKeyStatus] = useKeyStatus();
  const s = app.settings;
  useEffect(() => {
    void chat.refreshStatus();
  }, [chat]);

  if (!s) return null;
  const t = s.settings.tutor;

  async function change(patch: Parameters<typeof app.updateSettings>[0]): Promise<void> {
    if (await app.updateSettings(patch)) void chat.refreshStatus();
  }

  return (
    <section className="card" aria-labelledby="settings-tutor">
      <h2 id="settings-tutor">Tutor</h2>
      <p data-testid="tutor-status-line">
        {tutor ? (
          tutor.available ? (
            <>
              <span className="pass-text">On</span> · {tutor.backend}
              {tutor.model ? ` · ${tutor.model}` : ''}
            </>
          ) : (
            <>
              <span className="error-text">Off</span>
              {tutor.reason ? ` · ${tutor.reason}` : ''}
            </>
          )
        ) : (
          'Checking…'
        )}
      </p>
      <label className="field">
        Backend
        <select
          aria-label="Tutor backend"
          value={t.backend}
          onChange={(e) => void change({ tutor: { backend: e.target.value as typeof t.backend } })}
        >
          {BACKENDS.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
      </label>
      <KeyForm status={keyStatus} onStatus={setKeyStatus} />
      <ModelForm
        key={t.model ?? ''}
        saved={t.model}
        defaultModel={s.default_model}
        onSave={(model) => void change({ tutor: { model } })}
      />
      <label className="field">
        Effort
        <select
          aria-label="Effort"
          value={t.effort}
          onChange={(e) => void change({ tutor: { effort: e.target.value as typeof t.effort } })}
        >
          {EFFORTS.map((x) => (
            <option key={x} value={x}>
              {x[0]!.toUpperCase() + x.slice(1)}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">
        Higher effort thinks longer before answering: better reviews, slower replies, more tokens.
        Changes apply from the next message.
      </p>
    </section>
  );
}
