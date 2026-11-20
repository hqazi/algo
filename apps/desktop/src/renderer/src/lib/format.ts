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

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function parse(value: string | number | Date): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Midnight of the day `d` falls on, in local time. */
function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export interface DateFormatOptions {
  /** "Now" for the comparison (tests pass a fixed one). */
  now?: Date;
  /** A BCP 47 locale; the system's when left out. */
  locale?: string;
}

/**
 * A date for lists and status lines (docs/design.md → Dates): "just now",
 * "2 min ago", "3 h ago" (today), "yesterday", "4 days ago" (within a
 * week), then the date itself ("12 Nov", with the year when it is not this
 * year's). A time a little in the future (clock skew) reads "just now".
 * Unparseable input comes back unchanged; empty input gives "".
 * Pair it with `fullDate` as the tooltip.
 */
export function relativeDate(
  value: string | number | Date | null | undefined,
  { now = new Date(), locale }: DateFormatOptions = {},
): string {
  if (value === null || value === undefined || value === '') return '';
  const d = parse(value);
  if (!d) return String(value);
  const ms = now.getTime() - d.getTime();
  if (ms < MINUTE) return 'just now';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`;
  const days = Math.round((startOfDay(now) - startOfDay(d)) / DAY);
  if (days <= 0) return `${Math.floor(ms / HOUR)} h ago`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** The full date and time, for a tooltip next to `relativeDate`. */
export function fullDate(
  value: string | number | Date | null | undefined,
  { locale }: Pick<DateFormatOptions, 'locale'> = {},
): string {
  if (value === null || value === undefined || value === '') return '';
  const d = parse(value);
  if (!d) return String(value);
  return d.toLocaleString(locale, { dateStyle: 'full', timeStyle: 'short' });
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
