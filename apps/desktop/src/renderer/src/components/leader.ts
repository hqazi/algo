/**
 * The leader key (T36, D-57): like tmux's prefix, press the leader (Ctrl+B by
 * default, `ui.leader`), let go, then one key for an action. Pages register
 * their actions with `useLeaderBindings`; `LeaderProvider` listens, shows that
 * it is waiting, and lists the actions on `?`. Kept apart from the component
 * for fast refresh.
 */
import { createContext, useContext, useEffect, useRef } from 'react';
import type { SettingsView } from '../../../shared/settings';

export type LeaderSetting = SettingsView['ui']['leader'];

export interface LeaderBinding {
  /** `KeyboardEvent.key` values that run it: `'h'`, `'ArrowLeft'`, `'['`. */
  keys: string[];
  /** For the help list: "Go to the left pane". */
  label: string;
  /** For the help list: which heading it is under ("Panes"). */
  group: string;
  run: () => void;
}

export interface LeaderApi {
  /** Adds a source of bindings (read when a key comes); returns its removal. */
  register: (get: () => LeaderBinding[]) => () => void;
  /** "Ctrl+B" ("⌃B" on macOS), or null when the leader is off. */
  label: string | null;
}

export const LeaderContext = createContext<LeaderApi | null>(null);

export function useLeader(): LeaderApi | null {
  return useContext(LeaderContext);
}

/** Registers `bindings` while mounted; the latest render's bindings are the ones used. */
export function useLeaderBindings(bindings: LeaderBinding[]): void {
  const api = useLeader();
  const latest = useRef(bindings);
  useEffect(() => {
    latest.current = bindings;
  });
  useEffect(() => api?.register(() => latest.current), [api]);
}

const mac = (): boolean => /Mac/i.test(navigator.userAgent);

/** The leader as shown to people, or null when off. */
export function leaderLabel(setting: LeaderSetting): string | null {
  if (setting === 'off') return null;
  const key = setting === 'ctrl+space' ? 'Space' : setting.slice(-1).toUpperCase();
  return mac() ? `⌃${key === 'Space' ? ' Space' : key}` : `Ctrl+${key}`;
}

/** "Ctrl+B [" for a tooltip; null when the leader is off. */
export function leaderKeys(label: string | null, key: string): string | null {
  return label ? `${label} ${key}` : null;
}

/** Whether `e` is the leader: Ctrl (also on macOS, as in tmux) and the key, nothing else. */
export function isLeader(e: KeyboardEvent, setting: LeaderSetting): boolean {
  if (setting === 'off' || !e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
  const code = { 'ctrl+b': 'KeyB', 'ctrl+a': 'KeyA', 'ctrl+space': 'Space' }[setting];
  return e.code === code;
}

/** Keys that only modify: waiting continues past them. */
export const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);
