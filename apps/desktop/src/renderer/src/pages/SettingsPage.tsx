/**
 * Settings (SPEC §8): Tutor, Code execution, Appearance and editor, Profile,
 * Data, Updates, About. Every change is sent to main at once and applies
 * without a restart. Problems found in `settings.json` at start-up are shown
 * at the top.
 *
 * The look (T33, docs/design.md → Settings): a list of the sections on the
 * left that follows the scroll position (scroll-spy) and jumps to a
 * section, and aligned rows (label left, control right) in each section.
 * Every section stays on the page, so search, keyboard and the tests reach
 * every control without a click first.
 */
import { APP_NAME } from '@algo/core';
import {
  Bot,
  Cpu,
  Database,
  Info,
  Library,
  Palette,
  RefreshCw,
  User,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { ProfileUpdate, SettingsPatchView } from '../../../shared/settings';
import { ProfileForm } from '../components/ProfileForm';
import { invoke } from '../ipc';
import { errorText, useApp } from '../lib/app-context';
import { ExecutionSection } from './SettingsCodeExecution';
import { DataSection } from './SettingsData';
import { LibrarySection } from './SettingsLibrary';
import { TutorSection } from './SettingsTutor';
import { SettingRow } from './SettingsRow';
import { UpdatesSection } from './SettingsUpdates';
import './settings.css';

/** The sections in page order: the id of each one's heading, its name and icon. */
const SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'settings-tutor', label: 'Tutor', icon: Bot },
  { id: 'settings-exec', label: 'Code execution', icon: Cpu },
  { id: 'settings-look', label: 'Appearance', icon: Palette },
  { id: 'settings-library', label: 'Library', icon: Library },
  { id: 'settings-profile', label: 'Profile', icon: User },
  { id: 'settings-data', label: 'Data', icon: Database },
  { id: 'settings-updates', label: 'Updates', icon: RefreshCw },
  { id: 'settings-about', label: 'About', icon: Info },
];

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
  { name: 'Inter and JetBrains Mono (fonts)', licence: 'OFL-1.1' },
  { name: 'Lucide icons (lucide-react)', licence: 'ISC', note: 'some icons from Feather, MIT' },
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
    <section className="card settings-section" aria-labelledby="settings-look">
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
    <section className="card settings-section" aria-labelledby="settings-profile">
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
    <section className="card settings-section" aria-labelledby="settings-about">
      <h2 id="settings-about">About</h2>
      {versions && (
        <>
          <SettingRow label="Version">
            <span className="num">
              {APP_NAME} {versions.app}
            </span>
          </SettingRow>
          <SettingRow label="Built with">
            <span className="small num">
              Electron {versions.electron} · Chromium {versions.chrome} · Node {versions.node}
            </span>
          </SettingRow>
        </>
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

/**
 * Which section is current: the last one whose heading has reached the top
 * of the page (or the last one at the very bottom). After a jump, the
 * clicked section stays current until the scrolling stops.
 */
function useScrollSpy(page: RefObject<HTMLElement | null>) {
  const [current, setCurrent] = useState(SECTIONS[0]!.id);
  const lock = useRef<{ id: string; timer: number } | null>(null);

  useEffect(() => {
    const el = page.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (lock.current) {
        // Keep the clicked section until the scroll it started settles.
        const id = lock.current.id;
        window.clearTimeout(lock.current.timer);
        lock.current.timer = window.setTimeout(() => (lock.current = null), 150);
        setCurrent(id);
        return;
      }
      // A section is current once its heading is in the top third.
      const top = el.getBoundingClientRect().top + Math.min(240, el.clientHeight / 3);
      let id = SECTIONS[0]!.id;
      for (const s of SECTIONS) {
        const h = document.getElementById(s.id);
        if (h && h.getBoundingClientRect().top <= top) id = s.id;
      }
      if (el.scrollTop > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 2)
        id = SECTIONS[SECTIONS.length - 1]!.id;
      setCurrent(id);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
      if (lock.current) window.clearTimeout(lock.current.timer);
    };
  }, [page]);

  const jump = useCallback((id: string) => {
    const heading = document.getElementById(id);
    if (!heading) return;
    if (lock.current) window.clearTimeout(lock.current.timer);
    lock.current = { id, timer: window.setTimeout(() => (lock.current = null), 800) };
    setCurrent(id);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const section = heading.closest('section') ?? heading;
    section.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }, []);

  return { current, jump };
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
  const page = useRef<HTMLElement>(null);
  const { current, jump } = useScrollSpy(page);
  return (
    <main className="page settings-page" ref={page}>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          <h1>Settings</h1>
          <ul>
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <li key={id}>
                <button
                  type="button"
                  className="settings-nav-item"
                  aria-current={current === id ? 'true' : undefined}
                  onClick={() => jump(id)}
                >
                  <Icon aria-hidden="true" />
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="settings-content">
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
          <LibrarySection />
          <ProfileSection />
          <DataSection />
          <UpdatesSection version={versions?.app ?? null} />
          <AboutSection versions={versions} />
        </div>
      </div>
    </main>
  );
}
