// @vitest-environment jsdom
// Ported from dsa-tutor/web/tests/results.test.tsx; values are JSON text now.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CaseView, ExampleView, ReportView } from '../../../shared/practice';
import { ResultsPanel } from './ResultsPanel';

afterEach(cleanup);

const examples: ExampleView[] = [
  { id: 'example-1', input: { nums: '[2,7]', target: '9' }, expected: '[0,1]' },
  { id: 'example-2', input: { nums: '[3,3]', target: '6' }, expected: '[0,1]' },
];

const report: ReportView = {
  slug: 'two-sum',
  language: 'python',
  passed: 2,
  total: 5,
  all_passed: false,
  duration_ms: 9,
  cases: [
    { id: 'example-1', visibility: 'visible', category: 'example', status: 'pass', time_ms: 1 },
    {
      id: 'example-2',
      visibility: 'visible',
      category: 'example',
      status: 'fail',
      time_ms: 2,
      input: { nums: '[3,3]', target: '6' },
      expected: '[0,1]',
      actual: '[0,0]',
      stdout: 'debug line\n',
    },
    { id: 'hidden-1', visibility: 'hidden', category: 'duplicates', status: 'pass' },
    { id: 'hidden-2', visibility: 'hidden', category: 'negative-numbers', status: 'fail' },
    { id: 'hidden-3', visibility: 'hidden', category: 'large-input', status: 'timeout' },
  ],
};

describe('ResultsPanel', () => {
  it('shows the summary and one row per test', () => {
    render(<ResultsPanel report={report} kind="submit" examples={examples} />);
    expect(screen.getByTestId('summary').textContent).toBe('2/5 passed');
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByText(/2 hidden tests failed/)).toBeTruthy();
  });

  it('shows input, expected, actual and stdout for a failing visible test', () => {
    render(<ResultsPanel report={report} kind="run" examples={examples} />);
    const row = within(screen.getByTestId('case-example-2'));
    expect(row.getByText('Fail')).toBeTruthy();
    expect(row.getByText('nums = [3,3], target = 6')).toBeTruthy();
    expect(row.getByText('[0,1]')).toBeTruthy();
    expect(row.getByText('[0,0]')).toBeTruthy();
    expect(row.getByText('debug line')).toBeTruthy();
  });

  it('fills a passing visible test from the public examples', () => {
    render(<ResultsPanel report={report} kind="run" examples={examples} />);
    const row = within(screen.getByTestId('case-example-1'));
    expect(row.getByText('nums = [2,7], target = 9')).toBeTruthy();
    expect(row.queryByText('Actual')).toBeNull();
  });

  it('shows only category and status for hidden tests', () => {
    render(<ResultsPanel report={report} kind="submit" examples={examples} />);
    const row = screen.getByTestId('case-hidden-2');
    expect(row.textContent).toContain('Negative Numbers');
    expect(row.textContent).toContain('Fail');
    expect(row.querySelector('dl')).toBeNull();
    expect(within(screen.getByTestId('case-hidden-3')).getByText('Timeout')).toBeTruthy();
  });

  it('does not show hidden data even if a report carried it', () => {
    const leaky: ReportView = {
      ...report,
      cases: [
        {
          id: 'hidden-9',
          visibility: 'hidden',
          category: 'edge',
          status: 'fail',
          input: { secret: '42' },
          expected: 'SECRET',
          actual: 'x',
          stdout: 'out',
        } as unknown as CaseView,
      ],
    };
    const { container } = render(<ResultsPanel report={leaky} kind="submit" />);
    expect(container.textContent).not.toContain('SECRET');
    expect(container.textContent).not.toContain('42');
  });

  it('shows errors with type and line', () => {
    const r: ReportView = {
      ...report,
      cases: [
        {
          id: 'example-1',
          visibility: 'visible',
          category: 'example',
          status: 'error',
          error_type: 'IndexError',
          line: 4,
          message: 'list index out of range',
          input: { nums: '[]', target: '0' },
          expected: '[]',
        },
      ],
    };
    render(<ResultsPanel report={r} kind="run" />);
    expect(screen.getByText('IndexError (line 4)')).toBeTruthy();
    expect(screen.getByText('list index out of range')).toBeTruthy();
  });

  it('shows a solution that did not load', () => {
    const r: ReportView = {
      ...report,
      passed: 0,
      all_passed: false,
      cases: [],
      run_error: { kind: 'compile', message: 'SyntaxError: invalid syntax (line 3)' },
    };
    render(<ResultsPanel report={r} kind="run" />);
    expect(screen.getByTestId('run-error').textContent).toContain('did not load');
    expect(screen.getByText(/invalid syntax/)).toBeTruthy();
  });

  it('renders busy, error and empty states', () => {
    const { rerender } = render(<ResultsPanel report={null} kind={null} busy="submit" />);
    expect(screen.getByText(/Running all tests/)).toBeTruthy();
    rerender(<ResultsPanel report={null} kind={null} error="tests are already running" />);
    expect(screen.getByRole('alert').textContent).toContain('already running');
    rerender(<ResultsPanel report={null} kind={null} />);
    expect(screen.getByText(/Submit runs every test/)).toBeTruthy();
  });
});
