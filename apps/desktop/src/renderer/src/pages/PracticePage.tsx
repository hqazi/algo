/**
 * The practice view: statement | editor + results | tutor (ported from
 * `dsa-tutor/web/src/pages/PracticePage.tsx`). Saves as you type, picks up
 * edits made to the solution file in another editor, and runs and submits
 * through the main process. The tutor pane is a placeholder until T10.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProblemDetail, RecordView, ReportView } from '../../../shared/practice';
import { Editor } from '../components/Editor';
import { Markdown } from '../components/Markdown';
import { Panes } from '../components/Panes';
import { ResultsPanel } from '../components/ResultsPanel';
import { TutorPane } from '../components/TutorPane';
import { invoke, isRefusal, stream } from '../ipc';
import { errorText, useApp } from '../lib/app-context';
import { args, PROBLEM_STATUS_LABEL, titleCase } from '../lib/format';
import { hasExamplesSection, statementForApp } from '../lib/markdown';

type Busy = 'run' | 'submit' | 'give_up' | null;
type SaveState = 'saved' | 'unsaved' | 'saving' | 'error';

export const AUTOSAVE_MS = 700;

export function PracticePage({ slug }: { slug: string }) {
  const { notify, refresh, topicName } = useApp();
  const [detail, setDetail] = useState<ProblemDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initialCode, setInitialCode] = useState('');
  const [starter, setStarter] = useState('');
  const [filePath, setFilePath] = useState('');
  const [docKey, setDocKey] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [report, setReport] = useState<ReportView | null>(null);
  const [reportKind, setReportKind] = useState<Busy>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [giveUpOpen, setGiveUpOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [reference, setReference] = useState<string | null>(null);
  const [onDisk, setOnDisk] = useState<string | null>(null);
  const [tab, setTab] = useState('code');

  // Mutable working state the async helpers share.
  const code = useRef('');
  const dirty = useRef(false);
  const needsStart = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const busyRef = useRef<Busy>(null);
  const live = useRef(true);
  const gen = useRef(0);
  const docSeq = useRef(0);

  const replaceDoc = useCallback(
    (text: string, why: string) => {
      code.current = text;
      setInitialCode(text);
      setDocKey(`${slug}:${why}:${++docSeq.current}`);
    },
    [slug],
  );

  useEffect(() => {
    live.current = true;
    gen.current += 1;
    let cancelled = false;
    // The shell mounts a new page per slug (`key`), so state starts empty here.
    Promise.all([invoke('problems:get', { slug }), invoke('workspace:get', { slug })])
      .then(([d, w]) => {
        if (cancelled) return;
        setDetail(d);
        dirty.current = false;
        needsStart.current = d.status === 'new' || !w.exists;
        setStarter(w.starter);
        setFilePath(w.path);
        replaceDoc(w.code, 'load');
        setSaveState('saved');
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(errorText(err));
      });
    return () => {
      cancelled = true;
      live.current = false;
    };
  }, [slug, replaceDoc]);

  // Edits made to the solution file in another editor.
  const loaded = detail !== null;
  useEffect(() => {
    if (!loaded) return;
    const watch = stream('workspace:watch', { slug }, ({ code: text }) => {
      if (text === code.current) return;
      if (dirty.current) {
        setOnDisk(text); // keep the learner's unsaved edits; offer the file's version
        return;
      }
      replaceDoc(text, 'disk');
      setOnDisk(null);
      notify('Loaded the changes made to the solution file in another editor.', 'info');
    });
    watch.result.catch(() => undefined);
    return () => watch.cancel();
  }, [loaded, slug, replaceDoc, notify]);

  /** Start the attempt (once) and save the current code; serialised. */
  const flush = useCallback((): Promise<void> => {
    window.clearTimeout(timer.current);
    const mine = gen.current;
    const step = async (): Promise<void> => {
      if (mine !== gen.current) return; // the learner has moved to another problem
      if (needsStart.current) {
        await invoke('problems:start', { slug });
        needsStart.current = false;
      }
      if (!dirty.current || mine !== gen.current) return;
      const text = code.current;
      dirty.current = false;
      if (live.current) setSaveState('saving');
      try {
        await invoke('workspace:save', { slug, code: text });
        if (live.current) {
          setSaveState(dirty.current ? 'unsaved' : 'saved');
          setSaveError(null);
        }
      } catch (err) {
        dirty.current = true;
        if (live.current) {
          setSaveState('error');
          setSaveError(errorText(err));
        }
        throw err;
      }
    };
    const next = chain.current.catch(() => undefined).then(step);
    chain.current = next.catch(() => undefined);
    return next;
  }, [slug]);

  useEffect(
    () => () => {
      // Leaving the problem: save what is pending, captured now (the refs are
      // reused by the next problem).
      window.clearTimeout(timer.current);
      if (!dirty.current) return;
      const text = code.current;
      const start = needsStart.current;
      dirty.current = false;
      void chain.current
        .then(() => (start ? invoke('problems:start', { slug }) : undefined))
        .then(() => invoke('workspace:save', { slug, code: text }))
        .catch(() => undefined);
    },
    [slug],
  );

  useEffect(() => {
    // Closing the window: send the pending save. (Never `preventDefault`: in
    // Electron that silently keeps the window open.)
    const before = (): void => {
      if (dirty.current) void flush().catch(() => undefined);
    };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, [flush]);

  const onChange = useCallback(
    (text: string) => {
      code.current = text;
      dirty.current = true;
      setSaveState('unsaved');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        if (busyRef.current) return; // the run/submit flushes first
        void flush().catch(() => undefined);
      }, AUTOSAVE_MS);
    },
    [flush],
  );

  function celebrate(rec: RecordView | undefined): void {
    if (rec?.level_changed)
      notify(`Level up: ${topicName(rec.topic)} is now ${rec.level}.`, 'success');
  }

  async function execute(kind: 'run' | 'submit'): Promise<void> {
    if (busyRef.current || !detail) return;
    busyRef.current = kind;
    setBusy(kind);
    setRunError(null);
    setTab('code');
    try {
      await flush();
      if (kind === 'run') {
        setReport(await invoke('runs:run', { slug }));
      } else {
        const r = await invoke('runs:submit', { slug });
        setReport(r.report);
        if (r.recorded) {
          notify(
            r.record?.recorded.outcome === 'unaided'
              ? 'Solved unaided. Recorded.'
              : 'Solved. Recorded.',
            'success',
          );
          celebrate(r.record);
          setDetail((d) => (d ? { ...d, status: 'solved', attempt_recorded: true } : d));
          void refresh();
        } else {
          setDetail((d) => (d && d.status === 'new' ? { ...d, status: 'active' } : d));
        }
      }
      setReportKind(kind);
    } catch (err) {
      setRunError(
        isRefusal(err, 'busy') ? 'Tests are already running for this problem.' : errorText(err),
      );
    } finally {
      busyRef.current = null;
      setBusy(null);
      if (dirty.current) void flush().catch(() => undefined);
    }
  }

  async function giveUp(): Promise<void> {
    if (busyRef.current) return;
    setGiveUpOpen(false);
    busyRef.current = 'give_up';
    setBusy('give_up');
    setRunError(null);
    try {
      await flush().catch(() => undefined);
      const r = await invoke('attempts:give-up', {
        slug,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      setReport(r.report);
      setReportKind(r.report ? 'give_up' : null);
      setDetail((d) => (d ? { ...d, status: 'gave_up', attempt_recorded: true } : d));
      notify('Attempt recorded as gave up. The reference solution is now open.', 'info');
      celebrate(r.record);
      void refresh();
      setReference((await invoke('problems:reference', { slug })).code);
    } catch (err) {
      setRunError(errorText(err));
    } finally {
      busyRef.current = null;
      setBusy(null);
      setNotes('');
    }
  }

  async function showReference(): Promise<void> {
    try {
      setReference((await invoke('problems:reference', { slug })).code);
    } catch (err) {
      notify(errorText(err), 'error');
    }
  }

  function resetToStarter(): void {
    if (!window.confirm('Replace your code with the starter? Your current code will be lost.'))
      return;
    replaceDoc(starter, 'reset');
    dirty.current = true;
    void flush().catch(() => undefined);
  }

  function loadFromDisk(): void {
    if (onDisk === null) return;
    window.clearTimeout(timer.current);
    dirty.current = false;
    replaceDoc(onDisk, 'disk');
    setOnDisk(null);
    setSaveState('saved');
  }

  // Page-wide shortcuts (the editor handles its own and marks them handled).
  const runRef = useRef(execute);
  useEffect(() => {
    runRef.current = execute;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return;
      e.preventDefault();
      void runRef.current(e.shiftKey ? 'submit' : 'run');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (loadError) {
    return (
      <main className="page">
        <h1>Problem not available</h1>
        <p className="error-text">{loadError}</p>
      </main>
    );
  }
  if (!detail)
    return (
      <main className="page">
        <p className="muted">Loading…</p>
      </main>
    );

  const meta = detail.meta;
  const origin = detail.origin;
  // The leading "# Title" is shown as plain text above the tags.
  const full = statementForApp(detail.statement_md);
  const heading = /^\s*#\s+(.+)\n/.exec(full);
  const statement = heading ? full.slice(heading[0].length) : full;

  const problemPane = (
    <div className="statement">
      <h1 className="statement-title">{meta.title || heading?.[1]}</h1>
      <div className="statement-meta">
        <span className={`pill diff-${meta.difficulty}`}>{titleCase(meta.difficulty)}</span>
        <span className="pill">{topicName(meta.topic)}</span>
        <span className={`pill status-${detail.status}`} data-testid="problem-status">
          {PROBLEM_STATUS_LABEL[detail.status]}
        </span>
        {meta.source !== 'curated' && <span className="pill">{titleCase(meta.source)}</span>}
      </div>
      {origin && (
        <p className="origin small muted" data-testid="origin">
          {origin.kind === 'paste' ? (
            'Pasted by you for personal practice.'
          ) : (
            <>
              From {origin.name ?? origin.url}
              {origin.license && <> · {origin.license}</>}
              {origin.attribution && <> · {origin.attribution}</>}
            </>
          )}
        </p>
      )}
      <Markdown source={statement} />
      {!hasExamplesSection(statement) && detail.examples.length > 0 && (
        <section>
          <h2>Examples</h2>
          {detail.examples.map((ex) => (
            <div key={ex.id} className="example">
              <pre>
                <code>{`Input:  ${args(ex.input)}\nOutput: ${ex.expected}`}</code>
              </pre>
              {ex.explanation && <Markdown source={ex.explanation} className="small" />}
            </div>
          ))}
        </section>
      )}
      <p className="small muted">
        Target: time {meta.expected_complexity.time}, space {meta.expected_complexity.space}
      </p>
    </div>
  );

  const saveLabel = {
    saved: 'Saved',
    unsaved: 'Unsaved changes',
    saving: 'Saving…',
    error: 'Not saved',
  }[saveState];

  const codePane = (
    <div className="code-pane">
      <div className="toolbar">
        <button
          type="button"
          className="primary"
          onClick={() => void execute('run')}
          disabled={!!busy}
          title="Run visible tests (Ctrl/Cmd+Enter)"
        >
          Run
        </button>
        <button
          type="button"
          className="accent"
          onClick={() => void execute('submit')}
          disabled={!!busy}
          title="Run all tests and record when they pass (Ctrl/Cmd+Shift+Enter)"
        >
          Submit
        </button>
        <span
          className={`save-state save-${saveState}`}
          title={saveError ?? filePath}
          data-testid="save-state"
        >
          {saveLabel}
        </span>
        <span className="spacer" />
        {detail.attempt_recorded ? (
          <button type="button" onClick={() => void showReference()}>
            Reference
          </button>
        ) : (
          <button type="button" onClick={() => setGiveUpOpen(true)} disabled={!!busy}>
            Give up
          </button>
        )}
        <button
          type="button"
          onClick={resetToStarter}
          disabled={!!busy}
          title="Replace your code with the starter"
        >
          Reset
        </button>
      </div>
      {onDisk !== null && (
        <div className="notice" role="status" data-testid="disk-changed">
          The solution file was changed in another editor. Your unsaved edits here will replace it
          when they save.{' '}
          <button type="button" onClick={loadFromDisk}>
            Load the file’s version
          </button>
        </div>
      )}
      {saveState === 'error' && saveError && (
        <p className="error-text small" role="alert">
          Autosave failed: {saveError}
        </p>
      )}
      <div className="editor-wrap">
        <Editor
          value={initialCode}
          docKey={docKey}
          onChange={onChange}
          onRun={() => void execute('run')}
          onSubmit={() => void execute('submit')}
        />
      </div>
      <ResultsPanel
        report={report}
        kind={reportKind}
        examples={detail.examples}
        busy={busy}
        error={runError}
      />
    </div>
  );

  return (
    <main className="practice">
      <Panes
        tab={tab}
        onTab={setTab}
        panes={[
          { id: 'problem', title: 'Problem', content: problemPane },
          { id: 'code', title: 'Code', content: codePane },
          { id: 'tutor', title: 'Tutor', content: <TutorPane /> },
        ]}
      />

      {giveUpOpen && (
        <div className="modal-backdrop" onClick={() => setGiveUpOpen(false)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gu-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="gu-title">Give up on this one?</h2>
            <p>
              Before you do: a hint or the full explanation from the tutor often unblocks it. The
              tutor is not configured, so that is not available right now.
            </p>
            <p className="muted small">
              Giving up runs the tests one last time, records the attempt, and opens the reference
              solution.
            </p>
            <label className="field">
              Notes for later (optional)
              <textarea
                value={notes}
                maxLength={600}
                rows={3}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            <div className="actions">
              <button type="button" onClick={() => setGiveUpOpen(false)} autoFocus>
                Keep trying
              </button>
              <button type="button" className="danger" onClick={() => void giveUp()}>
                Give up and record
              </button>
            </div>
          </div>
        </div>
      )}

      {reference !== null && (
        <div className="modal-backdrop" onClick={() => setReference(null)}>
          <div
            className="modal wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ref-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="ref-title">Reference solution</h2>
            <pre className="code-block">
              <code>{reference}</code>
            </pre>
            <div className="actions">
              <button type="button" className="primary" onClick={() => setReference(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
