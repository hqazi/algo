import { describe, expect, it } from 'vitest';
import { relativeTime } from './relative-time';

const NOW = new Date(2026, 10, 20, 15, 0, 0).getTime();
const at = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

describe('relativeTime', () => {
  it('reads recent times relative to now', () => {
    expect(relativeTime(at(10_000), NOW)).toBe('just now');
    expect(relativeTime(at(-5_000), NOW)).toBe('just now');
    expect(relativeTime(at(2 * MIN), NOW)).toBe('2 min ago');
    expect(relativeTime(at(59 * MIN), NOW)).toBe('59 min ago');
    expect(relativeTime(at(3 * 60 * MIN), NOW)).toBe('3 h ago');
  });

  it('uses calendar days for older times', () => {
    expect(relativeTime(new Date(2026, 10, 19, 23, 0).toISOString(), NOW)).toBe('yesterday');
    expect(relativeTime(new Date(2026, 10, 16, 9, 0).toISOString(), NOW)).toBe('4 days ago');
    const old = relativeTime(new Date(2026, 2, 3).toISOString(), NOW);
    expect(old).toMatch(/3/);
    expect(old).not.toMatch(/2026/);
    expect(relativeTime(new Date(2025, 2, 3).toISOString(), NOW)).toMatch(/2025/);
  });

  it('passes through missing and unparsable values', () => {
    expect(relativeTime(null, NOW)).toBe('');
    expect(relativeTime('not a date', NOW)).toBe('not a date');
  });
});
