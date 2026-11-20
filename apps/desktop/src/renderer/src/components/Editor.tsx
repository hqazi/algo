/**
 * CodeMirror 6 with Python (ported from `dsa-tutor/web`). Uncontrolled:
 * `value` is applied only when `docKey` changes (a new problem, a reset to the
 * starter, or an edit made in another editor), so typing never fights with
 * React state. Such replacements do not call `onChange`.
 *
 * The light and dark themes take their colours from the design tokens in
 * styles.css (T28) and follow `prefers-color-scheme`, which the main process
 * sets from the theme setting. Font size and keymap (default, Vim, Emacs)
 * come from the editor settings and change without a reload (T09).
 */
import { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { indentUnit, syntaxHighlighting } from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';
import { emacs } from '@replit/codemirror-emacs';
import { vim } from '@replit/codemirror-vim';
import type { Extension } from '@codemirror/state';

export type EditorKeymap = 'default' | 'vim' | 'emacs';

export interface EditorProps {
  value: string;
  docKey: string;
  onChange: (code: string) => void;
  onRun?: () => void;
  onSubmit?: () => void;
  readOnly?: boolean;
  label?: string;
  fontSize?: number | undefined;
  keymap?: EditorKeymap | undefined;
  /** Python gets highlighting; Rust and Go are plain text for now (Go indents with tabs). */
  language?: 'python' | 'rust' | 'go' | undefined;
}

function keymapExtension(k: EditorKeymap | undefined): Extension {
  if (k === 'vim') return vim();
  if (k === 'emacs') return emacs();
  return [];
}

function languageExtension(language: EditorProps['language']): Extension {
  if (language === 'go') return indentUnit.of('\t');
  if (language === 'rust') return indentUnit.of('    ');
  return [indentUnit.of('    '), python()];
}

function fontExtension(px: number | undefined): Extension {
  return EditorView.theme({ '&': { fontSize: `${px ?? 14}px` } });
}

const DARK = '(prefers-color-scheme: dark)';

/** Editor chrome from the tokens: pane background, no gutter border, a faint accent active line. */
function chrome(dark: boolean): Extension {
  return EditorView.theme(
    {
      '&': { color: 'var(--text)', backgroundColor: 'var(--surface)' },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': {
        fontFamily: 'var(--mono)',
        lineHeight: '1.6',
        fontVariantLigatures: 'none',
      },
      '.cm-content': { caretColor: 'var(--text)', padding: '8px 0' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)', borderLeftWidth: '2px' },
      '.cm-gutters': {
        backgroundColor: 'var(--surface)',
        color: 'var(--faint)',
        border: 'none',
      },
      '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px' },
      '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--muted)' },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
        { backgroundColor: 'var(--selection)' },
      '.cm-selectionMatch': { backgroundColor: 'var(--accent-subtle)' },
      '&.cm-focused .cm-matchingBracket': {
        backgroundColor: 'var(--accent-subtle)',
        outline: '1px solid var(--accent-ring)',
      },
      '.cm-foldPlaceholder': {
        backgroundColor: 'var(--surface-2)',
        border: 'none',
        color: 'var(--muted)',
      },
      '.cm-tooltip': {
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        boxShadow: 'var(--shadow)',
      },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: 'var(--accent-subtle)',
        color: 'var(--text)',
      },
      '.cm-panels': { backgroundColor: 'var(--surface-2)', color: 'var(--text)' },
      '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
      '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
      '.cm-searchMatch': {
        backgroundColor: 'color-mix(in srgb, var(--warn) 25%, transparent)',
      },
      '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--selection)' },
    },
    { dark },
  );
}

const LIGHT_THEME: Extension = chrome(false);
// Light keeps basicSetup's default highlight style; dark uses One Dark's colours.
const DARK_THEME: Extension = [chrome(true), syntaxHighlighting(oneDarkHighlightStyle)];

function themeFor(dark: boolean): Extension {
  return dark ? DARK_THEME : LIGHT_THEME;
}

function prefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK).matches;
}

export function Editor(props: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const handlers = useRef(props);
  const theme = useRef(new Compartment());
  const ro = useRef(new Compartment());
  const keys = useRef(new Compartment());
  const font = useRef(new Compartment());
  const lang = useRef(new Compartment());
  const external = useRef(false);

  useEffect(() => {
    handlers.current = props;
  });

  useEffect(() => {
    if (!host.current) return;
    const runKeys = Prec.highest(
      keymap.of([
        {
          key: 'Mod-Enter',
          run: () => {
            handlers.current.onRun?.();
            return true;
          },
        },
        {
          key: 'Mod-Shift-Enter',
          run: () => {
            handlers.current.onSubmit?.();
            return true;
          },
        },
      ]),
    );
    const initial = handlers.current;
    const state = EditorState.create({
      doc: initial.value,
      extensions: [
        // Vim and Emacs bindings must come before the default keymaps.
        keys.current.of(keymapExtension(initial.keymap)),
        runKeys,
        basicSetup,
        font.current.of(fontExtension(initial.fontSize)),
        keymap.of([indentWithTab]),
        lang.current.of(languageExtension(initial.language)),
        theme.current.of(themeFor(prefersDark())),
        ro.current.of(EditorState.readOnly.of(!!initial.readOnly)),
        EditorView.contentAttributes.of({ 'aria-label': initial.label ?? 'Solution code' }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !external.current) handlers.current.onChange(u.state.doc.toString());
        }),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia(DARK) : null;
    const onScheme = (): void =>
      v.dispatch({ effects: theme.current.reconfigure(themeFor(prefersDark())) });
    mq?.addEventListener('change', onScheme);
    return () => {
      mq?.removeEventListener('change', onScheme);
      v.destroy();
      view.current = null;
    };
  }, []);

  const { value, docKey, readOnly, fontSize, keymap: keymapSetting, language } = props;
  useEffect(() => {
    view.current?.dispatch({ effects: lang.current.reconfigure(languageExtension(language)) });
  }, [language]);
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current !== value) {
      external.current = true;
      try {
        const head = Math.min(v.state.selection.main.head, value.length);
        v.dispatch({
          changes: { from: 0, to: current.length, insert: value },
          selection: { anchor: head },
        });
      } finally {
        external.current = false;
      }
    }
    // Only a new docKey replaces the document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  useEffect(() => {
    view.current?.dispatch({
      effects: ro.current.reconfigure(EditorState.readOnly.of(!!readOnly)),
    });
  }, [readOnly]);

  useEffect(() => {
    view.current?.dispatch({ effects: keys.current.reconfigure(keymapExtension(keymapSetting)) });
  }, [keymapSetting]);

  useEffect(() => {
    view.current?.dispatch({ effects: font.current.reconfigure(fontExtension(fontSize)) });
  }, [fontSize]);

  return <div className="editor" ref={host} data-keymap={keymapSetting ?? 'default'} />;
}
