/**
 * App-wide state (ported from `dsa-tutor/web/src/lib/app.tsx`): profile,
 * topics with levels, theme, plus a toast notifier. Talks to the main
 * process only through `ipc.ts`.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ProfileResponse, Theme, TopicView } from '../../../shared/practice';
import { invoke } from '../ipc';
import { AppContext, errorText, type AppValue, type Toast } from './app-context';

let toastId = 0;

export function AppProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [topics, setTopics] = useState<TopicView[]>([]);
  const [theme, setThemeState] = useState<Theme>('system');
  const [version, setVersion] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = useCallback(
    (text: string, kind: Toast['kind'] = 'info') => {
      const id = ++toastId;
      setToasts((t) => [...t.slice(-3), { id, kind, text }]);
      window.setTimeout(() => dismiss(id), kind === 'error' ? 8000 : 4000);
    },
    [dismiss],
  );

  const refresh = useCallback(
    () =>
      Promise.all([invoke('profile:get'), invoke('catalog:topics'), invoke('settings:theme')]).then(
        ([p, t, th]) => {
          setProfile(p);
          setTopics(t.topics);
          setThemeState(th.theme);
          setLoadError(null);
          setVersion((v) => v + 1);
        },
        (err: unknown) => setLoadError(errorText(err)),
      ),
    [],
  );

  const setTheme = useCallback(
    async (next: Theme) => {
      try {
        setThemeState((await invoke('settings:set-theme', { theme: next })).theme);
      } catch (err) {
        notify(errorText(err), 'error');
      }
    },
    [notify],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const names = useMemo(() => new Map(topics.map((t) => [t.id, t.name])), [topics]);
  const topicName = useCallback((id: string) => names.get(id) ?? id, [names]);

  const value: AppValue = {
    profile,
    topics,
    theme,
    version,
    loadError,
    refresh,
    setTheme,
    notify,
    toasts,
    dismiss,
    topicName,
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
