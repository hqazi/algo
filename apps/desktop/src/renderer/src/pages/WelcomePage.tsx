/**
 * First run (SPEC §2). T08 offers only the defaults so practice works; T09
 * adds the five onboarding questions and the "Connect the tutor" step.
 */
import { useState } from 'react';
import { invoke } from '../ipc';
import { errorText, useApp } from '../lib/app-context';
import { navigate } from '../lib/router';

export function WelcomePage() {
  const { refresh, notify } = useApp();
  const [busy, setBusy] = useState(false);

  async function saveDefaults(): Promise<void> {
    setBusy(true);
    try {
      await invoke('profile:defaults');
      await refresh();
      notify('Profile saved. Pick “Next problem” to start.', 'success');
      navigate('/', true);
    } catch (err) {
      notify(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page narrow-page">
      <h1>Welcome</h1>
      <p>
        Practise data structures and algorithms: pick a problem, write a solution, run the tests.
      </p>
      <p>
        Start with the defaults: general practice, beginner, Python, starting from the basics. Every
        answer can be changed later.
      </p>
      <div className="actions">
        <button
          type="button"
          className="primary"
          onClick={() => void saveDefaults()}
          disabled={busy}
        >
          Use defaults and start
        </button>
      </div>
    </main>
  );
}
