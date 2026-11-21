/**
 * What a collapsible pane gives its header (kept apart from components for
 * fast refresh): `PaneHeader` reads it and adds the collapse button, so panes
 * that draw their own header (the Tutor, the Library's chats) get one too.
 */
import { createContext, useContext } from 'react';

export interface PaneControl {
  /** Which edge the pane collapses to. */
  side: 'left' | 'right';
  /** The pane's title ("Problem"), for the button's label. */
  title: string;
  /** The shortcut, as shown to people ("Ctrl+B ["); null when there is none. */
  shortcut: string | null;
  collapse: () => void;
}

export const PaneControlContext = createContext<PaneControl | null>(null);

export function usePaneControl(): PaneControl | null {
  return useContext(PaneControlContext);
}

const mac = (): boolean => /Mac/i.test(navigator.userAgent);

/** Shortcut text for people: `shortcutLabel('B', { alt: true })` → "Ctrl+Alt+B" or "⌥⌘B". */
export function shortcutLabel(key: string, { alt = false }: { alt?: boolean } = {}): string {
  if (mac()) return `${alt ? '⌥' : ''}⌘${key}`;
  return `Ctrl+${alt ? 'Alt+' : ''}${key}`;
}

/** Ctrl (Cmd on macOS) held, Shift not; `alt` says whether Alt must be held or not. */
export function isMod(e: KeyboardEvent, { alt = false }: { alt?: boolean } = {}): boolean {
  const mod = mac() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  return mod && !e.shiftKey && e.altKey === alt;
}
