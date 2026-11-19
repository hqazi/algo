/**
 * The app shell (ported from `dsa-tutor/web/src/App.tsx`): top bar, routes,
 * toasts. New problem (T12), Settings (T09) and the tutor (T10) come later.
 */
import { APP_NAME } from '@algorithm-tutor/core';
import { useEffect, useState } from 'react';
import type { Theme } from '../../shared/practice';
import { Link } from './components/Link';
import { Toasts } from './components/Toasts';
import { invoke, isRefusal } from './ipc';
import { AppProvider } from './lib/app';
import { errorText, useApp } from './lib/app-context';
import { navigate, useRoute, type Route } from './lib/router';
import { HomePage } from './pages/HomePage';
import { PracticePage } from './pages/PracticePage';
import { ProblemsPage } from './pages/ProblemsPage';
import { ProgressPage } from './pages/ProgressPage';
import { WelcomePage } from './pages/WelcomePage';

function NavLink({
  to,
  route,
  name,
  children,
}: {
  to: string;
  route: Route;
  name: Route['name'];
  children: string;
}) {
  return (
    <Link to={to} className={route.name === name ? 'nav active' : 'nav'}>
      {children}
    </Link>
  );
}

const THEMES: { id: Theme; label: string }[] = [
  { id: 'system', label: 'System theme' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

export function Shell() {
  const app = useApp();
  const route = useRoute();
  const [nextBusy, setNextBusy] = useState(false);
  const onboarded = app.profile?.onboarded;

  useEffect(() => {
    if (onboarded === false && route.name !== 'welcome') navigate('/welcome', true);
  }, [onboarded, route.name]);

  async function next(): Promise<void> {
    setNextBusy(true);
    try {
      const r = await invoke('problems:next', {});
      if (r.action === 'solve') {
        await invoke('problems:start', { slug: r.slug });
        app.notify(r.reason, 'info');
        navigate(`/p/${r.slug}`);
      } else {
        // Generating a problem arrives with T12.
        app.notify(`${r.reason} New problems can be generated once the tutor is set up.`, 'info');
      }
      void app.refresh();
    } catch (err) {
      if (isRefusal(err, 'not_onboarded')) navigate('/welcome');
      else app.notify(errorText(err), 'error');
    } finally {
      setNextBusy(false);
    }
  }

  let page;
  if (app.loadError && !app.profile) {
    page = (
      <main className="page narrow-page">
        <h1>Something went wrong</h1>
        <p className="error-text">{app.loadError}</p>
        <button type="button" onClick={() => void app.refresh()}>
          Retry
        </button>
      </main>
    );
  } else if (!app.profile) {
    page = (
      <main className="page">
        <p className="muted">Loading…</p>
      </main>
    );
  } else {
    switch (route.name) {
      case 'home':
        page = <HomePage onNext={() => void next()} nextBusy={nextBusy} />;
        break;
      case 'welcome':
        page = <WelcomePage />;
        break;
      case 'problems':
        page = <ProblemsPage />;
        break;
      case 'problem':
        page = <PracticePage key={route.slug} slug={route.slug} />;
        break;
      case 'progress':
        page = <ProgressPage />;
        break;
      default:
        page = (
          <main className="page">
            <h1>Not found</h1>
            <p>
              <Link to="/">Back to practice</Link>
            </p>
          </main>
        );
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          {APP_NAME}
        </Link>
        <nav aria-label="Main">
          <button
            type="button"
            className="primary"
            onClick={() => void next()}
            disabled={nextBusy || !onboarded}
          >
            {nextBusy ? 'Picking…' : 'Next problem'}
          </button>
          <NavLink to="/problems" route={route} name="problems">
            Problems
          </NavLink>
          <NavLink to="/progress" route={route} name="progress">
            Progress
          </NavLink>
        </nav>
        <select
          className="theme-select"
          aria-label="Theme"
          value={app.theme}
          onChange={(e) => void app.setTheme(e.target.value as Theme)}
        >
          {THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <span className="ai-off small" title="The tutor is set up in Settings (coming soon).">
          Tutor off
        </span>
      </header>
      {page}
      <Toasts />
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
