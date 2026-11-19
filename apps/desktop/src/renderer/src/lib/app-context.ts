/**
 * App-wide state shared by every page: the context type, `useApp` and
 * `errorText`. The provider is in `app.tsx`.
 */
import { createContext, useContext } from 'react';
import type { ProfileResponse, TopicView } from '../../../shared/practice';
import type { SettingsPatchView, SettingsResponse } from '../../../shared/settings';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
}

export interface AppValue {
  profile: ProfileResponse | null;
  topics: TopicView[];
  /** `settings.json` as main has it, with load issues and the default model. */
  settings: SettingsResponse | null;
  /** Bumped by refresh(); pages that show progress reload when it changes. */
  version: number;
  loadError: string | null;
  refresh: () => Promise<void>;
  /** Applies a change at once; `false` (and a toast) if main refused it. */
  updateSettings: (patch: SettingsPatchView) => Promise<boolean>;
  notify: (text: string, kind?: Toast['kind']) => void;
  toasts: Toast[];
  dismiss: (id: number) => void;
  topicName: (id: string) => string;
}

export const AppContext = createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const v = useContext(AppContext);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
