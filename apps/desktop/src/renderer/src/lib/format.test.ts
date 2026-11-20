/** The shared date formatter (T33, docs/design.md → Dates). */
import { describe, expect, it } from 'vitest';
import { fullDate, relativeDate } from './format';

// Local time, so the calendar-day rules do not depend on the machine's zone.
const now = new Date(2026, 10, 20, 14, 30, 0);
const ago = (ms: number) => new Date(now.getTime() - ms);
const opts = { now, locale: 'en-GB' };
const MIN = 60_000;

describe('relativeDate', () => {
  it('says "just now" under a minute, and for a time slightly ahead', () => {
    expect(relativeDate(ago(0), opts)).toBe('just now');
    expect(relativeDate(ago(59_000), opts)).toBe('just now');
    expect(relativeDate(ago(-30_000), opts)).toBe('just now');
  });

  it('counts minutes, then hours within today', () => {
    expect(relativeDate(ago(2 * MIN), opts)).toBe('2 min ago');
    expect(relativeDate(ago(59 * MIN + 59_000), opts)).toBe('59 min ago');
    expect(relativeDate(ago(3 * 60 * MIN), opts)).toBe('3 h ago');
    expect(relativeDate(new Date(2026, 10, 20, 0, 5), opts)).toBe('14 h ago');
  });

  it('uses calendar days: yesterday, then days within a week', () => {
    expect(relativeDate(new Date(2026, 10, 19, 23, 50), opts)).toBe('yesterday');
    expect(relativeDate(new Date(2026, 10, 19, 0, 1), opts)).toBe('yesterday');
    expect(relativeDate(new Date(2026, 10, 18, 12, 0), opts)).toBe('2 days ago');
    expect(relativeDate(new Date(2026, 10, 14, 9, 0), opts)).toBe('6 days ago');
  });

  it('shows the date beyond a week, with the year only when it differs', () => {
    expect(relativeDate(new Date(2026, 10, 13, 9, 0), opts)).toBe('13 Nov');
    expect(relativeDate(new Date(2025, 11, 31, 9, 0), opts)).toBe('31 Dec 2025');
  });

  it('accepts ISO text and epoch numbers, and passes bad input through', () => {
    expect(relativeDate(ago(5 * MIN).toISOString(), opts)).toBe('5 min ago');
    expect(relativeDate(ago(5 * MIN).getTime(), opts)).toBe('5 min ago');
    expect(relativeDate('not a date', opts)).toBe('not a date');
    expect(relativeDate(null, opts)).toBe('');
    expect(relativeDate(undefined, opts)).toBe('');
    expect(relativeDate('', opts)).toBe('');
  });
});

describe('fullDate', () => {
  it('gives the full date and time for a tooltip', () => {
    const text = fullDate(new Date(2026, 10, 20, 14, 5), { locale: 'en-GB' });
    expect(text).toContain('Friday');
    expect(text).toContain('20 November 2026');
    expect(text).toContain('14:05');
  });

  it('passes bad input through and gives "" for none', () => {
    expect(fullDate('soon')).toBe('soon');
    expect(fullDate(null)).toBe('');
  });
});
