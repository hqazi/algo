/** Display helpers (ported from `dsa-tutor/web/src/lib/format.ts`). Values arrive as JSON text. */
import type { CaseView, ExampleView } from '../../../shared/practice';

/** `{a: "1", b: "[2]"}` → `a = 1, b = [2]` */
export function args(input: Record<string, string> | undefined): string {
  if (!input) return '';
  return Object.entries(input)
    .map(([k, v]) => `${k} = ${v}`)
    .join(', ');
}

export const STATUS_LABEL: Record<string, string> = {
  pass: 'Pass',
  fail: 'Fail',
  error: 'Error',
  timeout: 'Timeout',
};

export const PROBLEM_STATUS_LABEL: Record<string, string> = {
  new: 'New',
  active: 'In progress',
  solved: 'Solved',
  gave_up: 'Gave up',
};

export const OUTCOME_LABEL: Record<string, string> = {
  unaided: 'Solved',
  with_hints: 'Solved with help',
  gave_up: 'Gave up',
};

export function titleCase(s: string): string {
  return s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function when(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/**
 * Fill visible cases that came without their input (a report stored before
 * it had one) from the problem's examples.
 */
export function withExamples(cases: CaseView[], examples: ExampleView[]): CaseView[] {
  const byId = new Map(examples.map((e) => [e.id, e]));
  return cases.map((c) => {
    if (c.visibility !== 'visible' || c.input !== undefined) return c;
    const ex = byId.get(c.id);
    return ex ? { ...c, input: ex.input, expected: ex.expected } : c;
  });
}
