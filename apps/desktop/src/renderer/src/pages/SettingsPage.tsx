/**
 * Settings (SPEC §8): Tutor, Code execution, Appearance and editor, Profile,
 * Data, Updates, About. Every change is sent to main at once and applies
 * without a restart. Problems found in `settings.json` at start-up are shown
 * at the top.
 */
import { APP_NAME } from '@algorithm-tutor/core';
import { useEffect, useState } from 'react';
import type { ProfileUpdate, SettingsPatchView } from '../../../shared/settings';
import { ProfileForm } from '../components/ProfileForm';
import { invoke } from '../ipc';
import { errorText, useApp } from '../lib/app-context';
import { ExecutionSection } from './SettingsCodeExecution';
import { DataSection } from './SettingsData';
import { TutorSection } from './SettingsTutor';
import { UpdatesSection } from './SettingsUpdates';

const THEMES = [
  { id: 'system', label: 'Follow the system' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
] as const;
const KEYMAPS = [
  { id: 'default', label: 'Standard' },
  { id: 'vim', label: 'Vim' },
  { id: 'emacs', label: 'Emacs' },
] as const;

const LICENCES: { name: string; licence: string; note?: string }[] = [
  { name: APP_NAME, licence: 'Apache-2.0' },
  { name: 'Pyodide (Python in the app)', licence: 'MPL-2.0', note: 'with CPython (PSF licence)' },
  { name: 'Electron and Chromium', licence: 'MIT', note: 'Chromium: BSD-style and others' },
  { name: 'React', licence: 'MIT' },
  { name: 'CodeMirror, @replit/codemirror-vim, @replit/codemirror-emacs', licence: 'MIT' },
  { name: 'Anthropic TypeScript SDK', licence: 'Apache-2.0' },
  { name: 'marked', licence: 'MIT' },
  { name: 'DOMPurify', licence: 'MPL-2.0 or Apache-2.0' },
  { name: 'zod, fflate', licence: 'MIT' },
];

/** Keyed by the saved size, so a change from elsewhere resets the field. */
function FontSize({ saved, onSave }: { saved: number; onSave: (n: number) => void }) {
  const [font, setFont] = useState(String(saved));
  return (
    <label className="field">
      Editor font size
      <input
        aria-label="Editor font size"
        type="number"
        min={8}
        max={40}
        value={font}
        onChange={(e) => {
          setFont(e.target.value);
          const n = Number(e.target.value);
          if (Number.isInteger(n) && n >= 8 && n <= 40 && n !== saved) onSave(n);
        }}
      />
    </label>
  );
}

function AppearanceSection() {
  const app = useApp();
  const s = app.settings?.settings;
  if (!s) return null;
  const set = (patch: SettingsPatchView) => void app.updateSettings(patch);
  return (
    <section className="card" aria-labelledby="settings-look">
      <h2 id="settings-look">Appearance and editor</h2>
      <label className="field">
        Theme
        <select
          aria-label="Theme"
          value={s.ui.theme}
          onChange={(e) => set({ ui: { theme: e.target.value as typeof s.ui.theme } })}
        >
          {THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <FontSize
        key={s.editor.fontSize}
        saved={s.editor.fontSize}
        onSave={(n) => set({ editor: { fontSize: n } })}
      />
      <label className="field">
        Editor keys
        <select
          aria-label="Editor keys"
          value={s.editor.keymap}
          onChange={(e) => set({ editor: { keymap: e.target.value as typeof s.editor.keymap } })}
        >
          {KEYMAPS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}

function ProfileSection() {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const profile = app.profile?.profile ?? null;

  async function save(u: ProfileUpdate): Promise<void> {
    setBusy(true);
    try {
      await invoke('profile:set', u);
      await app.refresh();
      app.notify('Profile saved.', 'success');
    } catch (err) {
      app.notify(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="settings-profile">
      <h2 id="settings-profile">Profile</h2>
      {profile ? (
        <ProfileForm
          key={profile.updated_at}
          initial={profile}
          topics={app.topics}
          submitLabel="Save profile"
          busy={busy}
          onSubmit={(u) => void save(u)}
        />
      ) : (
        <p className="muted">Not onboarded yet.</p>
      )}
    </section>
  );
}

function AboutSection({
  versions,
}: {
  versions: { app: string; electron: string; chrome: string; node: string } | null;
}) {
  return (
    <section className="card" aria-labelledby="settings-about">
      <h2 id="settings-about">About</h2>
      {versions && (
        <p className="small">
          {APP_NAME} {versions.app} · Electron {versions.electron} · Chromium {versions.chrome} ·
          Node {versions.node}
        </p>
      )}
      <h3>Licences</h3>
      <ul className="list small" data-testid="licences">
        {LICENCES.map((l) => (
          <li key={l.name}>
            {l.name}: {l.licence}
            {l.note ? <span className="muted"> ({l.note})</span> : null}
          </li>
        ))}
      </ul>
      <p className="muted small">
        Imported problem sets show their own licence with each problem (none imported yet).
      </p>
    </section>
  );
}

export function SettingsPage() {
  const app = useApp();
  const [versions, setVersions] = useState<{
    app: string;
    electron: string;
    chrome: string;
    node: string;
  } | null>(null);
  useEffect(() => {
    void invoke('app:version').then(setVersions, () => undefined);
  }, []);
  const issues = app.settings?.issues ?? [];
  return (
    <main className="page narrow-page settings-page">
      <h1>Settings</h1>
      {issues.length > 0 && (
        <div className="card warning" role="alert" data-testid="settings-issues">
          <p>Some values in settings.json were not valid and use their defaults:</p>
          <ul className="small">
            {issues.map((i) => (
              <li key={`${i.key}:${i.message}`}>
                <code>{i.key || 'settings.json'}</code>: {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      <TutorSection />
      <ExecutionSection />
      <AppearanceSection />
      <ProfileSection />
      <DataSection />
      <UpdatesSection version={versions?.app ?? null} />
      <AboutSection versions={versions} />
    </main>
  );
}
