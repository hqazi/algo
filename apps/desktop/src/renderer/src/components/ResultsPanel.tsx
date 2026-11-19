/**
 * Per-test results (ported from `dsa-tutor/web`). Visible cases show input,
 * expected, actual and stdout; hidden cases show category and status only (the
 * main process never sends more for them, and the IPC contract refuses more).
 */
import type { CaseView, ExampleView, ReportView } from '../../../shared/practice';
import { args, STATUS_LABEL, titleCase, withExamples } from '../lib/format';

export interface ResultsProps {
  report: ReportView | null;
  kind: 'run' | 'submit' | 'give_up' | null;
  examples?: ExampleView[];
  busy?: 'run' | 'submit' | 'give_up' | null;
  error?: string | null;
}

function CaseRow({ c }: { c: CaseView }) {
  const hidden = c.visibility === 'hidden';
  const label = hidden ? `Hidden · ${titleCase(c.category || 'test')}` : c.id;
  return (
    <li className={`case case-${c.status}`} data-testid={`case-${c.id}`}>
      <div className="case-head">
        <span className={`badge badge-${c.status}`}>{STATUS_LABEL[c.status] ?? c.status}</span>
        <span className="case-name">{label}</span>
        {!hidden && c.category && c.category !== 'example' && (
          <span className="case-cat">{titleCase(c.category)}</span>
        )}
        {c.time_ms !== undefined && <span className="case-time">{c.time_ms} ms</span>}
      </div>
      {!hidden && (
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
              <dd>
                <code>{c.expected}</code>
              </dd>
            </>
          )}
          {c.status === 'fail' && c.actual !== undefined && (
            <>
              <dt>Actual</dt>
              <dd>
                <code>{c.actual}</code>
              </dd>
            </>
          )}
          {c.error_type && (
            <>
              <dt>Error</dt>
              <dd>
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
      )}
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
};

export function ResultsPanel({ report, kind, examples = [], busy, error }: ResultsProps) {
  if (busy)
    return (
      <section className="results" aria-live="polite">
        <p className="muted">{BUSY_TEXT[busy]}</p>
      </section>
    );
  if (error)
    return (
      <section className="results" aria-live="polite">
        <p className="error-text" role="alert">
          {error}
        </p>
      </section>
    );
  if (!report) {
    return (
      <section className="results" aria-live="polite">
        <p className="muted">
          Run checks the visible examples; Submit runs every test, including hidden ones.
        </p>
      </section>
    );
  }
  const cases = withExamples(report.cases, examples);
  const hiddenFailed = cases.filter((c) => c.visibility === 'hidden' && c.status !== 'pass').length;
  return (
    <section className="results" aria-live="polite">
      <div className={`summary ${report.all_passed ? 'summary-pass' : 'summary-fail'}`}>
        <strong data-testid="summary">
          {report.passed}/{report.total} passed
        </strong>
        {kind && <span className="muted"> · {KIND_TEXT[kind]}</span>}
        {report.all_passed && <span> ✓</span>}
      </div>
      {report.run_error && (
        <div className="run-error" role="alert" data-testid="run-error">
          <p className="error-text">
            <strong>{RUN_ERROR_TEXT[report.run_error.kind] ?? 'The tests could not run.'}</strong>
          </p>
          <pre className="code-block">{report.run_error.message}</pre>
        </div>
      )}
      {hiddenFailed > 0 && (
        <p className="muted small">
          {hiddenFailed} hidden test{hiddenFailed === 1 ? '' : 's'} failed. Hidden tests show their
          category only; think about which cases that category covers.
        </p>
      )}
      <ul className="cases">
        {cases.map((c) => (
          <CaseRow key={c.id} c={c} />
        ))}
      </ul>
    </section>
  );
}
