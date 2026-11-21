/**
 * The practice view: statement | editor + results | tutor (ported from
 * `dsa-tutor/web/src/pages/PracticePage.tsx`). Saves as you type, picks up
 * edits made to the solution file in another editor, and runs and submits
 * through the main process. The tutor pane is the problem's chat (T10); its
 * `show_results` events show in the results panel.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { FileCode, Flag, Play, RotateCcw } from 'lucide-react';
import type {
  LanguageOption,
  ProblemDetail,
  RecordView,
  ReportView,
} from '../../../shared/practice';
import { ChatPane } from '../chat/ChatPane';
import { useChatStore, useTutorStatus } from '../chat/store';
import { windowPlatform } from '../components/app-frame';
import { Editor } from '../components/Editor';
import { ExplanationList } from '../explanation/ExplanationList';
import { Markdown } from '../components/Markdown';
import { Panes } from '../components/Panes';
import { isMod } from '../components/pane-control';
import { ResultsPanel } from '../components/ResultsPanel';
import { Dialog } from '../components/Dialog';
import {
  AutoGrowTextarea,
  Badge,
  Button,
  Menu,
  Select,
  type BadgeTone,
  type MenuItem,
} from '../components/ui';
import { invoke, isRefusal, stream } from '../ipc';
import { errorText, useApp } from '../lib/app-context';
import { args, PROBLEM_STATUS_LABEL, titleCase } from '../lib/format';
import { useStored } from '../lib/hooks';
import { hasExamplesSection, statementForApp } from '../lib/markdown';
import { splitConstraints } from './practice-statement';
import './practice.css';

type Busy = 'run' | 'submit' | 'give_up' | null;
type SaveState = 'saved' | 'unsaved' | 'saving' | 'error';

export const AUTOSAVE_MS = 700;

const LANGUAGE_LABEL = { python: 'Python', rust: 'Rust', go: 'Go' } as const;

const STATUS_TONE: Record<ProblemDetail['status'], BadgeTone> = {
  new: 'neutral',
  active: 'warn',
  solved: 'pass',
  gave_up: 'fail',
};

export function PracticePage({ slug }: { slug: string }) {
  const { notify, refresh, topicName, settings } = useApp();
  const [detail, setDetail] = useState<ProblemDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initialCode, setInitialCode] = useState('');
  const [starter, setStarter] = useState('');
  const [filePath, setFilePath] = useState('');
  const [docKey, setDocKey] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [report, setReport] = useState<ReportView | null>(null);
  const [reportKind, setReportKind] = useState<Busy | 'tutor'>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [giveUpOpen, setGiveUpOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [reference, setReference] = useState<string | null>(null);
  const [onDisk, setOnDisk] = useState<string | null>(null);
  const [tab, setTab] = useState('code');
  const [resultsCollapsed, setResultsCollapsed] = useStored('results-collapsed', false);
  const toggleResults = (): void => setResultsCollapsed(!resultsCollapsed);
  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const chat = useChatStore();
  const tutor = useTutorStatus(chat);

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
    // Which languages can run here (cargo / go found); the picker only.
    invoke('problems:languages', { slug }).then(
      (r) => {
        if (!cancelled) setLanguages(r.languages);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
      live.current = false;
    };
  }, [slug, replaceDoc]);

  // Edits made to the solution file in another editor.
  // The watch follows the language's file, so it restarts when the language changes.
  const watchLanguage = detail?.language;
  useEffect(() => {
    if (!watchLanguage) return;
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
  }, [watchLanguage, slug, replaceDoc, notify]);

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

  /** The editor's code for the tutor, saved first so its tools see the same. */
  const codeForTutor = useCallback(async (): Promise<string | undefined> => {
    await flush().catch(() => undefined);
    return code.current;
  }, [flush]);

  useEffect(
    () =>
      chat.onUi((ev) => {
        if (ev.action === 'show_results' && ev.slug === slug) {
          setReport(ev.report);
          setReportKind('tutor');
        } else if (ev.action === 'refresh_state') {
          invoke('problems:get', { slug }).then(
            (d) =>
              setDetail((cur) =>
                cur ? { ...cur, status: d.status, attempt_recorded: d.attempt_recorded } : cur,
              ),
            () => undefined,
          );
        }
      }),
    [chat, slug],
  );

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

  /** Save, then work the problem in `next` (its own solution file). */
  async function changeLanguage(next: ProblemDetail['language']): Promise<void> {
    if (busyRef.current || !detail || next === detail.language) return;
    try {
      await flush();
      const step = chain.current.then(async () => {
        const w = await invoke('problems:language', { slug, language: next });
        if (!live.current) return;
        needsStart.current = false;
        dirty.current = false;
        setDetail((d) =>
          d ? { ...d, language: w.language, status: d.status === 'new' ? 'active' : d.status } : d,
        );
        setStarter(w.starter);
        setFilePath(w.path);
        setOnDisk(null);
        setReport(null);
        replaceDoc(w.code, `language-${w.language}`);
        setSaveState('saved');
      });
      chain.current = step.catch(() => undefined);
      await step;
    } catch (err) {
      notify(errorText(err), 'error');
    }
  }

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
  // Ctrl/Cmd+J hides or shows the test results (T35); Panes has the pane keys.
  const runRef = useRef(execute);
  const toggleRef = useRef(toggleResults);
  useEffect(() => {
    runRef.current = execute;
    toggleRef.current = toggleResults;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      if (e.code === 'KeyJ' && isMod(e)) {
        e.preventDefault();
        toggleRef.current();
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return;
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
  const { body: statement, constraints } = splitConstraints(
    heading ? full.slice(heading[0].length) : full,
  );
  const title = meta.title || heading?.[1] || slug;

  const problemPane = (
    <div className="statement">
      <h1 className="statement-title">{title}</h1>
      <div className="statement-meta">
        <Badge tone={meta.difficulty} dot>
          {titleCase(meta.difficulty)}
        </Badge>
        <Badge>{topicName(meta.topic)}</Badge>
        <span data-testid="problem-status" className="statement-status">
          <Badge tone={STATUS_TONE[detail.status]}>{PROBLEM_STATUS_LABEL[detail.status]}</Badge>
        </span>
        {meta.source !== 'curated' && <Badge tone="accent">{titleCase(meta.source)}</Badge>}
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
      <Markdown source={statement} className="statement-body" />
      {!hasExamplesSection(statement) && detail.examples.length > 0 && (
        <section className="statement-body md">
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
      <section className="statement-details" aria-labelledby="details-title">
        <h2 className="section-label" id="details-title">
          Details
        </h2>
        {constraints && <Markdown source={constraints} className="details-constraints" />}
        <p className="details-target">
          <span className="muted">Target</span> time <code>{meta.expected_complexity.time}</code>,
          space <code>{meta.expected_complexity.space}</code>
        </p>
      </section>
      <ExplanationList slug={slug} title={title} active={detail.status === 'active'} />
    </div>
  );

  const saveLabel = {
    saved: 'Saved',
    unsaved: 'Unsaved changes',
    saving: 'Saving…',
    error: 'Not saved',
  }[saveState];

  const mac = windowPlatform() === 'mac';
  const moreItems: MenuItem[] = [
    detail.attempt_recorded
      ? {
          label: 'Reference',
          icon: <FileCode aria-hidden="true" />,
          title: 'Show the reference solution',
          onSelect: () => void showReference(),
        }
      : {
          label: 'Give up',
          icon: <Flag aria-hidden="true" />,
          title: 'Record the attempt as gave up and show the reference solution',
          onSelect: () => setGiveUpOpen(true),
          disabled: !!busy,
          danger: true,
        },
    {
      label: 'Reset',
      icon: <RotateCcw aria-hidden="true" />,
      title: 'Replace your code with the starter',
      onSelect: resetToStarter,
      disabled: !!busy,
    },
  ];

  // The editor toolbar sits in the Code pane's header (T29).
  const codeActions = (
    <>
      {languages.length > 1 && (
        <Select
          aria-label="Language"
          wrapperClassName="language-select"
          value={detail.language}
          disabled={!!busy}
          onChange={(e) => void changeLanguage(e.target.value as ProblemDetail['language'])}
          data-testid="language-picker"
        >
          {languages.map((l) => (
            <option
              key={l.language}
              value={l.language}
              disabled={!l.available && l.language !== detail.language}
              title={l.reason ?? l.version ?? ''}
            >
              {LANGUAGE_LABEL[l.language]}
              {l.available ? '' : ' (not installed)'}
            </option>
          ))}
        </Select>
      )}
      <span
        className={`save-state save-${saveState}`}
        title={saveError ?? filePath}
        data-testid="save-state"
      >
        {saveLabel}
      </span>
      <span className="spacer" />
      <Button
        size="sm"
        className="run-button"
        icon={<Play size={14} aria-hidden="true" />}
        onClick={() => void execute('run')}
        disabled={!!busy}
        title={`Run the visible tests (${mac ? '⌘Enter' : 'Ctrl+Enter'})`}
      >
        Run
      </Button>
      <Button
        size="sm"
        variant="primary"
        onClick={() => void execute('submit')}
        disabled={!!busy}
        title={`Run all tests and record the attempt when they pass (${mac ? '⇧⌘Enter' : 'Ctrl+Shift+Enter'})`}
      >
        Submit
      </Button>
      <Menu label="More" items={moreItems} triggerVariant="icon" />
    </>
  );

  const codePane = (
    <div className="code-pane">
      {languages.find((l) => l.language === detail.language && !l.available) && (
        <div className="notice" role="status" data-testid="language-missing">
          {LANGUAGE_LABEL[detail.language]} cannot run here:{' '}
          {languages.find((l) => l.language === detail.language)?.reason}
        </div>
      )}
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
          fontSize={settings?.settings.editor.fontSize}
          keymap={settings?.settings.editor.keymap}
          language={detail.language}
        />
      </div>
      <ResultsPanel
        report={report}
        kind={reportKind}
        examples={detail.examples}
        busy={busy}
        error={runError}
        collapsed={resultsCollapsed}
        onToggle={toggleResults}
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
          { id: 'code', title: 'Code', content: codePane, actions: codeActions },
          {
            id: 'tutor',
            title: 'Tutor',
            header: false,
            content: <ChatPane slug={slug} getCode={codeForTutor} />,
          },
        ]}
      />

      {giveUpOpen && (
        <Dialog
          titleId="gu-title"
          title="Give up on this one?"
          onClose={() => setGiveUpOpen(false)}
          footer={
            <>
              <Button onClick={() => setGiveUpOpen(false)} autoFocus>
                Keep trying
              </Button>
              <Button variant="danger" onClick={() => void giveUp()}>
                Give up and record
              </Button>
            </>
          }
        >
          <p>
            Before you do: a hint or the full explanation from the tutor often unblocks it.
            {tutor?.available
              ? ' Ask for one in the Tutor pane.'
              : ' The tutor is not set up, so that is not available right now.'}
          </p>
          <p className="muted small">
            Giving up runs the tests one last time, records the attempt, and opens the reference
            solution.
          </p>
          <label className="field">
            Notes for later (optional)
            <AutoGrowTextarea
              value={notes}
              maxLength={600}
              rows={3}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </Dialog>
      )}

      {reference !== null && (
        <Dialog
          titleId="ref-title"
          title="Reference solution"
          onClose={() => setReference(null)}
          wide
        >
          <pre className="code-block">
            <code>{reference}</code>
          </pre>
        </Dialog>
      )}
    </main>
  );
}
