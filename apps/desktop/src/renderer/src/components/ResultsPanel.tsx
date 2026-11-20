/**
 * Per-test results (ported from `dsa-tutor/web`; restyled in T30, docs/design.md
 * → Practice). A summary bar stays at the top ("10/11 passed", the run kind
 * and time). Passing tests are one line each and open on click; failing ones
 * start open with input, expected and got in a compact grid. Hidden cases show
 * category and status only (the main process never sends more for them, and
 * the IPC contract refuses more).
 */
import { useState } from 'react';
import { ChevronRight, CircleCheck, CircleX } from 'lucide-react';
import type { CaseView, ExampleView, ReportView } from '../../../shared/practice';
import { args, STATUS_LABEL, withExamples } from '../lib/format';

export interface ResultsProps {
  report: ReportView | null;
  /** What produced the report; `tutor`: the tutor's `run_tests`. */
  kind: 'run' | 'submit' | 'give_up' | 'tutor' | null;
  examples?: ExampleView[];
  busy?: 'run' | 'submit' | 'give_up' | null;
  error?: string | null;
}

/** "negative-numbers" → "negative numbers". */
function words(category: string): string {
  return category.replace(/[-_]+/g, ' ').trim();
}

type VisibleCase = Extract<CaseView, { visibility: 'visible' }>;

function CaseBody({ c }: { c: VisibleCase }) {
  const failed = c.status !== 'pass';
  return (
    <dl className="case-body">
      {c.input !== undefined && (
        <>
          <dt>Input</dt>
          <dd>
            <code>{args(c.input)}</code>
          </dd>
        </>
      )}
      {c.expected !== undefined && (
        <>
          <dt>Expected</dt>
          <dd className={failed ? 'case-expected' : undefined}>
            <code>{c.expected}</code>
          </dd>
        </>
      )}
      {c.status === 'fail' && c.actual !== undefined && (
        <>
          <dt>Got</dt>
          <dd className="case-got">
            <code>{c.actual}</code>
          </dd>
        </>
      )}
      {c.error_type && (
        <>
          <dt>Error</dt>
          <dd className="case-got">
            <code>
              {c.error_type}
              {c.line ? ` (line ${c.line})` : ''}
            </code>
          </dd>
        </>
      )}
      {c.message && (
        <>
          <dt>Message</dt>
          <dd>
            <pre>{c.message}</pre>
          </dd>
        </>
      )}
      {c.stdout && (
        <>
          <dt>Stdout</dt>
          <dd>
            <pre>{c.stdout}</pre>
          </dd>
        </>
      )}
    </dl>
  );
}

function CaseRow({ c }: { c: CaseView }) {
  const hidden = c.visibility === 'hidden';
  const [open, setOpen] = useState(!hidden && c.status !== 'pass');
  const label = hidden ? `Hidden test: ${words(c.category || 'test')}` : c.id;
  const head = (
    <>
      {!hidden && <ChevronRight className="case-chevron" size={14} aria-hidden="true" />}
      <span className={`badge badge-${c.status}`}>{STATUS_LABEL[c.status] ?? c.status}</span>
      <span className="case-name">{label}</span>
      {!hidden && c.category && c.category !== 'example' && (
        <span className="case-cat">{words(c.category)}</span>
      )}
      {c.visibility === 'visible' && !open && c.input !== undefined && (
        <code className="case-peek">{args(c.input)}</code>
      )}
      {c.time_ms !== undefined && <span className="case-time">{c.time_ms} ms</span>}
    </>
  );
  return (
    <li className={`case case-${c.status}${open ? ' open' : ''}`} data-testid={`case-${c.id}`}>
      {hidden ? (
        <div className="case-head">{head}</div>
      ) : (
        <button
          type="button"
          className="case-head"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {head}
        </button>
      )}
      {c.visibility === 'visible' && open && <CaseBody c={c} />}
    </li>
  );
}

const BUSY_TEXT = {
  run: 'Running visible tests…',
  submit: 'Running all tests…',
  give_up: 'Recording…',
};
const RUN_ERROR_TEXT: Record<string, string> = {
  compile: 'Your code did not load (a syntax error or an error at the top level).',
  harness: 'The test runner failed.',
  'runtime-missing': 'Python is not available to run this.',
  cancelled: 'The run was cancelled.',
};
const KIND_TEXT = {
  run: 'Run (visible tests)',
  submit: 'Submit (all tests)',
  give_up: 'Final run',
  tutor: 'Run by the tutor',
};

/** "a, b and c". */
function list(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function seconds(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function ResultsPanel({ report, kind, examples = [], busy, error }: ResultsProps) {
  if (busy)
    return (
      <section className="results" aria-live="polite">
        <p className="results-note muted">
          <span className="results-spinner" aria-hidden="true" />
          {BUSY_TEXT[busy]}
        </p>
      </section>
    );
  if (error)
    return (
      <section className="results" aria-live="polite">
        <p className="results-note error-text" role="alert">
          {error}
        </p>
      </section>
    );
  if (!report) {
    return (
      <section className="results" aria-live="polite">
        <p className="results-note muted">
          Run checks the visible examples; Submit runs every test, including hidden ones.
        </p>
      </section>
    );
  }
  // Failing tests first (each group keeps its order): they are what to look at.
  const all = withExamples(report.cases, examples);
  const cases = [
    ...all.filter((c) => c.status !== 'pass'),
    ...all.filter((c) => c.status === 'pass'),
  ];
  const hiddenFailed = cases.filter((c) => c.visibility === 'hidden' && c.status !== 'pass');
  const categories = [...new Set(hiddenFailed.map((c) => words(c.category || 'test')))];
  const Icon = report.all_passed ? CircleCheck : CircleX;
  return (
    <section className="results" aria-live="polite">
      <div className={`results-summary ${report.all_passed ? 'summary-pass' : 'summary-fail'}`}>
        <Icon size={16} aria-hidden="true" />
        <strong data-testid="summary">
          {report.passed}/{report.total} passed
        </strong>
        {kind && <span className="muted">{KIND_TEXT[kind]}</span>}
        <span className="spacer" />
        {report.duration_ms > 0 && (
          <span className="results-time faint">{seconds(report.duration_ms)}</span>
        )}
      </div>
      {report.run_error && (
        <div className="run-error" role="alert" data-testid="run-error">
          <p className="error-text">
            <strong>{RUN_ERROR_TEXT[report.run_error.kind] ?? 'The tests could not run.'}</strong>
          </p>
          <pre className="code-block">{report.run_error.message}</pre>
        </div>
      )}
      {hiddenFailed.length > 0 && (
        <p className="results-hidden muted small">
          {hiddenFailed.length === 1
            ? '1 hidden test failed'
            : `${hiddenFailed.length} hidden tests failed`}{' '}
          ({list(categories)}). Hidden tests show their category only; think about which cases that
          covers.
        </p>
      )}
      <ul className="cases">
        {cases.map((c) => (
          <CaseRow key={`${c.id}:${c.status}`} c={c} />
        ))}
      </ul>
    </section>
  );
}
