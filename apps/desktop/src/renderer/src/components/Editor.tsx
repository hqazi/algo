/**
 * CodeMirror 6 with Python (ported from `dsa-tutor/web`). Uncontrolled:
 * `value` is applied only when `docKey` changes (a new problem, a reset to the
 * starter, or an edit made in another editor), so typing never fights with
 * React state. Such replacements do not call `onChange`.
 *
 * The one-dark theme follows `prefers-color-scheme`, which the main process
 * sets from the theme setting.
 */
import { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';

export interface EditorProps {
  value: string;
  docKey: string;
  onChange: (code: string) => void;
  onRun?: () => void;
  onSubmit?: () => void;
  readOnly?: boolean;
  label?: string;
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
  const external = useRef(false);

  useEffect(() => {
    handlers.current = props;
  });

  useEffect(() => {
    if (!host.current) return;
    const keys = Prec.highest(
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
        keys,
        basicSetup,
        keymap.of([indentWithTab]),
        indentUnit.of('    '),
        python(),
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

  const { value, docKey, readOnly } = props;
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

  return <div className="editor" ref={host} />;
}
