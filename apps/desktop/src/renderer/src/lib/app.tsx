/**
 * App-wide state (ported from `dsa-tutor/web/src/lib/app.tsx`): profile,
 * topics with levels, settings (T09), plus a toast notifier. Talks to the main
 * process only through `ipc.ts`.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ProfileResponse, TopicView } from '../../../shared/practice';
import type { SettingsPatchView, SettingsResponse } from '../../../shared/settings';
import { invoke } from '../ipc';
import { AppContext, errorText, type AppValue, type Toast } from './app-context';

let toastId = 0;

export function AppProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [topics, setTopics] = useState<TopicView[]>([]);
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
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
      Promise.all([invoke('profile:get'), invoke('catalog:topics'), invoke('settings:get')]).then(
        ([p, t, st]) => {
          setProfile(p);
          setTopics(t.topics);
          setSettings(st);
          setLoadError(null);
          setVersion((v) => v + 1);
        },
        (err: unknown) => setLoadError(errorText(err)),
      ),
    [],
  );

  const updateSettings = useCallback(
    async (patch: SettingsPatchView) => {
      try {
        setSettings(await invoke('settings:set', patch));
        return true;
      } catch (err) {
        notify(errorText(err), 'error');
        return false;
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
    settings,
    version,
    loadError,
    refresh,
    updateSettings,
    notify,
    toasts,
    dismiss,
    topicName,
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
