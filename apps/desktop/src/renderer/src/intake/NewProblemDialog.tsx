/**
 * The New Problem dialog (ported from `dsa-tutor/web/src/intake/NewProblemDialog.tsx`):
 * generate a problem from a topic and difficulty, convert a pasted statement,
 * or import one from an open problem set. All three run as an intake job in
 * the main process; the problem appears only after its self-check passes.
 * The dialog stays mounted while closed, so a job keeps going (and is
 * reported) in the background.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  MAX_IDEA_CHARS,
  MAX_PASTE_CHARS,
  MIN_PASTE_CHARS,
  type IntakeRequestView,
} from '../../../shared/intake';
import { Dialog } from '../components/Dialog';
import { AutoGrowTextarea, Button, Segmented } from '../components/ui';
import { titleCase } from '../lib/format';
import { reasonText } from '../pages/dashboard';
import { ImportPanel, type ImportChoice } from './ImportPanel';
import { useIntakeJob, type JobState } from './useIntakeJob';
import './intake.css';

type Difficulty = 'easy' | 'medium' | 'hard';

export interface NewProblemDialogProps {
  open: boolean;
  /** Why the tutor cannot write problems, or null when it can. */
  tutorOff: string | null;
  /** Prefilled from a `generate` recommendation (Next problem). */
  suggestion?: { topic: string; difficulty: string; reason: string } | null;
  topics: { id: string; name: string }[];
  onClose: () => void;
  /** The job finished: `open` says whether the dialog was showing at that moment. */
  onCreated?: (slug: string, title: string | null, open: boolean) => void;
}

type Mode = 'generate' | 'paste' | 'import';
const MODE_LABELS: Record<Mode, string> = {
  generate: 'Generate',
  paste: 'Paste',
  import: 'Import',
};
const MODES: Mode[] = ['generate', 'paste', 'import'];
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
export const PASTE_NOTE =
  'Paste your own copy of a problem, for personal practice: the text stays on this computer and is ' +
  'sent only to your configured AI provider.';

function Progress({ state }: { state: JobState }) {
  const last = state.progress[state.progress.length - 1];
  return (
    <div className="intake-progress" role="status" aria-live="polite">
      <p>
        <span className="spinner" aria-hidden="true" />{' '}
        {state.phase === 'starting' ? 'Starting…' : (last?.message ?? 'Waiting for the tutor…')}
        {last?.attempt && last.max_attempts ? (
          <span className="muted small">
            {' '}
            (self-check {last.attempt} of {last.max_attempts})
          </span>
        ) : null}
      </p>
      {state.progress.length > 1 && (
        <ol className="intake-steps small muted">
          {state.progress.slice(0, -1).map((p, i) => (
            <li key={i}>{p.message}</li>
          ))}
        </ol>
      )}
      <p className="muted small">
        This can take a minute or two. You can close this dialog; the problem keeps being written.
      </p>
    </div>
  );
}

function Failure({ state }: { state: JobState }) {
  const err = state.error!;
  const d = err.detail;
  return (
    <div className="intake-failure" role="alert">
      <p className="error-text">{err.message}</p>
      {d && (
        <details open={err.code === 'self_check'}>
          <summary>Self-check details</summary>
          {d.error && <p className="small">{d.error}</p>}
          {d.problems && d.problems.length > 0 && (
            <ul className="small">
              {d.problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
          {d.failures && d.failures.length > 0 && (
            <ul className="small">
              {d.failures.map((f, i) => (
                <li key={i}>
                  <code>{f.id}</code>
                  {f.category ? ` (${f.category})` : ''}: {f.status}
                  {f.error_type ? ` · ${f.error_type}` : ''}
                  {f.message ? ` · ${f.message}` : ''}
                </li>
              ))}
              {d.more_failures ? <li>…and {d.more_failures} more</li> : null}
            </ul>
          )}
        </details>
      )}
    </div>
  );
}

export function NewProblemDialog({
  open,
  tutorOff,
  suggestion,
  topics,
  onClose,
  onCreated,
}: NewProblemDialogProps) {
  // Report a finished job once (from the hook, not an effect), then clear it.
  const report = useRef({ onCreated, open });
  useEffect(() => {
    report.current = { onCreated, open };
  });
  const { state, run, stop, reset } = useIntakeJob((slug, title) => {
    report.current.onCreated?.(slug, title, report.current.open);
    return true;
  });
  const [mode, setMode] = useState<Mode>('generate');
  const [topicChoice, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [idea, setIdea] = useState('');
  const [text, setText] = useState('');
  const [pasteTopic, setPasteTopic] = useState('');
  const [pasteDifficulty, setPasteDifficulty] = useState<'' | Difficulty>('');
  const [choice, setChoice] = useState<ImportChoice | null>(null);
  const busy = state.phase === 'starting' || state.phase === 'running';
  const topic = topicChoice || topics[0]?.id || '';

  // A recommendation prefills the generate form when the dialog opens with
  // it (only while no job is running): adjusted during render, not in an effect.
  const [applied, setApplied] = useState<NewProblemDialogProps['suggestion']>(null);
  if (open && !busy && suggestion && suggestion !== applied) {
    setApplied(suggestion);
    setMode('generate');
    setTopic(suggestion.topic);
    if ((DIFFICULTIES as string[]).includes(suggestion.difficulty))
      setDifficulty(suggestion.difficulty as Difficulty);
  }

  if (!open) return null;
  const pasteLen = text.trim().length;
  const valid =
    mode === 'generate'
      ? Boolean(topic)
      : mode === 'paste'
        ? pasteLen >= MIN_PASTE_CHARS && pasteLen <= MAX_PASTE_CHARS
        : choice !== null;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy || tutorOff) return;
    let body: IntakeRequestView;
    if (mode === 'generate') {
      body = { kind: 'generate', topic, difficulty, ...(idea.trim() ? { idea: idea.trim() } : {}) };
    } else if (mode === 'import') {
      body = { kind: 'import', set: choice!.set, entry: choice!.entry };
    } else {
      body = {
        kind: 'paste',
        text,
        ...(pasteTopic ? { topic: pasteTopic } : {}),
        ...(pasteDifficulty ? { difficulty: pasteDifficulty } : {}),
      };
    }
    void run(body);
  }

  function close() {
    if (state.phase === 'failed' || state.phase === 'done') reset();
    onClose();
  }

  const form = (
    <>
      <Segmented
        tabs
        className="intake-modes"
        aria-label="How to make the problem"
        value={mode}
        onChange={setMode}
        controls={{ generate: 'np-panel', paste: 'np-panel', import: 'np-panel' }}
        options={MODES.map((m) => ({ value: m, label: MODE_LABELS[m] }))}
      />
      {mode === 'generate' ? (
        <div role="tabpanel" id="np-panel" aria-label="Generate">
          {suggestion && <p className="intake-suggestion">{reasonText(suggestion)}</p>}
          <div className="intake-row">
            <label className="field">
              Topic
              <select value={topic} onChange={(e) => setTopic(e.target.value)}>
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Difficulty
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as Difficulty)}
              >
                {DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {titleCase(d)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            Idea (optional)
            <AutoGrowTextarea
              rows={3}
              maxHeight={200}
              maxLength={MAX_IDEA_CHARS}
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="e.g. something about train timetables"
            />
          </label>
        </div>
      ) : mode === 'import' ? (
        <ImportPanel value={choice} onChange={setChoice} topics={topics} />
      ) : (
        <div role="tabpanel" id="np-panel" aria-label="Paste">
          <p className="muted small" data-testid="paste-note">
            {PASTE_NOTE}
          </p>
          <label className="field">
            Problem statement
            <AutoGrowTextarea
              rows={8}
              maxHeight={360}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={MAX_PASTE_CHARS}
            />
          </label>
          {pasteLen > 0 && pasteLen < MIN_PASTE_CHARS && (
            <p className="muted small">Paste the whole statement.</p>
          )}
          <div className="intake-row">
            <label className="field">
              Topic
              <select value={pasteTopic} onChange={(e) => setPasteTopic(e.target.value)}>
                <option value="">Let the tutor choose</option>
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Difficulty
              <select
                value={pasteDifficulty}
                onChange={(e) => setPasteDifficulty(e.target.value as '' | Difficulty)}
              >
                <option value="">Let the tutor judge</option>
                {DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {titleCase(d)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}
      {tutorOff && (
        <p className="error-text small">
          Needs the AI tutor: {tutorOff} Meanwhile, pick any problem from the problem list.
        </p>
      )}
      {state.phase === 'failed' && <Failure state={state} />}
    </>
  );

  const formFooter = (
    <>
      <Button onClick={close}>Cancel</Button>
      <Button type="submit" variant="primary" disabled={!valid || Boolean(tutorOff)}>
        {state.phase === 'failed'
          ? 'Try again'
          : mode === 'generate'
            ? 'Generate'
            : mode === 'paste'
              ? 'Convert'
              : 'Import'}
      </Button>
    </>
  );

  return busy ? (
    <Dialog
      titleId="np-title"
      title="New problem"
      wide
      backdropCloses={false}
      onClose={onClose}
      footer={
        <>
          <Button onClick={() => void stop()}>Stop</Button>
          <Button variant="primary" onClick={onClose}>
            Close (keeps working)
          </Button>
        </>
      }
    >
      <Progress state={state} />
    </Dialog>
  ) : (
    <Dialog
      titleId="np-title"
      title="New problem"
      wide
      onClose={close}
      onSubmit={submit}
      footer={formFooter}
    >
      {form}
    </Dialog>
  );
}
