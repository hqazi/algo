/**
 * First run (SPEC §2): the five questions (or "use defaults"), then the
 * optional "Connect the tutor" step, then home. Ported from
 * `dsa-tutor/web/src/pages/OnboardingPage.tsx`. The tutor step is skipped
 * when a tutor is already available (e.g. a key in the environment).
 * Claude Code joins the tutor step in T11.
 */
import { useState } from 'react';
import type { ProfileUpdate } from '../../../shared/settings';
import { useChatStore } from '../chat/store';
import { ProfileForm } from '../components/ProfileForm';
import { invoke } from '../ipc';
import { errorText, useApp } from '../lib/app-context';
import { navigate } from '../lib/router';
import { useKeyStatus } from './SettingsShared';
import { KeyForm } from './SettingsTutor';

function done(notify: (t: string, k?: 'info' | 'success' | 'error') => void, tutor: boolean) {
  notify(
    tutor
      ? 'All set. Pick “Next problem” to start.'
      : 'Profile saved. Pick “Next problem” to start. The tutor can be connected later in Settings.',
    'success',
  );
  navigate('/', true);
}

function ConnectStep() {
  const { notify } = useApp();
  const [status, setStatus] = useKeyStatus();
  return (
    <main className="page narrow-page">
      <h1>Connect the tutor</h1>
      <p>
        The tutor gives hints, reviews your code and explains solutions. It uses the Anthropic API
        with your own API key, billed to your Anthropic account. You can practise without it and
        connect it later in Settings.
      </p>
      <section className="card">
        <KeyForm status={status} onStatus={setStatus} onConnected={() => done(notify, true)} />
      </section>
      <div className="actions">
        <button type="button" onClick={() => done(notify, false)}>
          Skip for now
        </button>
        {status?.source && status.source !== 'none' && (
          <button type="button" className="primary" onClick={() => done(notify, true)}>
            Continue
          </button>
        )}
      </div>
    </main>
  );
}

export function OnboardingPage() {
  const { topics, refresh, notify } = useApp();
  const chat = useChatStore();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<'questions' | 'tutor'>('questions');

  async function save(fn: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    try {
      await fn();
      await refresh();
      const tutor = await chat.refreshStatus();
      if (tutor?.available) done(notify, true);
      else setStep('tutor');
    } catch (err) {
      notify(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (step === 'tutor') return <ConnectStep />;
  return (
    <main className="page narrow-page">
      <h1>Welcome</h1>
      <p>
        Practise data structures and algorithms: pick a problem, write a solution, run the tests.
        Five quick questions help pick the right problems; any answer can be changed later in
        Settings.
      </p>
      <ProfileForm
        initial={null}
        topics={topics}
        submitLabel="Save and continue"
        busy={busy}
        onSubmit={(u: ProfileUpdate) => void save(() => invoke('profile:set', u))}
        onDefaults={() => void save(() => invoke('profile:defaults'))}
        defaultsLabel="Use defaults and start"
      />
    </main>
  );
}
