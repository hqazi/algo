/**
 * The app shell (ported from `dsa-tutor/web/src/App.tsx`): top bar, routes,
 * toasts, and the chat's app-wide effects (T10). New problem arrives in T12.
 */
import { APP_NAME } from '@algorithm-tutor/core';
import { useCallback, useEffect, useState } from 'react';
import { ChatEffects } from './chat/ChatEffects';
import { useChatStore, useTutorStatus } from './chat/store';
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
import { OnboardingPage } from './pages/OnboardingPage';
import { SettingsPage } from './pages/SettingsPage';

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

export function Shell() {
  const app = useApp();
  const route = useRoute();
  const [nextBusy, setNextBusy] = useState(false);
  const onboarded = app.profile?.onboarded;
  const chat = useChatStore();
  const tutor = useTutorStatus(chat);
  const { refresh } = app;
  const onRefresh = useCallback(
    () => Promise.all([refresh(), chat.refreshStatus()]).then(() => undefined),
    [refresh, chat],
  );

  useEffect(() => {
    void chat.refreshStatus();
  }, [chat]);

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
        page = <OnboardingPage />;
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
      case 'settings':
        page = <SettingsPage />;
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
          <NavLink to="/settings" route={route} name="settings">
            Settings
          </NavLink>
        </nav>
        <span className="spacer" />
        {tutor &&
          (tutor.available ? (
            <span className="ai-on small" title={tutor.model ? `Model: ${tutor.model}` : undefined}>
              Tutor on
            </span>
          ) : (
            <span className="ai-off small" title={tutor.reason ?? undefined}>
              Tutor off
            </span>
          ))}
      </header>
      {page}
      <ChatEffects onRefresh={onRefresh} />
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
