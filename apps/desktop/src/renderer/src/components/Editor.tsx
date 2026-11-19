/**
 * CodeMirror 6 with Python (ported from `dsa-tutor/web`). Uncontrolled:
 * `value` is applied only when `docKey` changes (a new problem, a reset to the
 * starter, or an edit made in another editor), so typing never fights with
 * React state. Such replacements do not call `onChange`.
 *
 * The one-dark theme follows `prefers-color-scheme`, which the main process
 * sets from the theme setting. Font size and keymap (default, Vim, Emacs)
 * come from the editor settings and change without a reload (T09).
 */
import { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
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
        theme.current.of(prefersDark() ? oneDark : []),
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
      v.dispatch({ effects: theme.current.reconfigure(prefersDark() ? oneDark : []) });
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
