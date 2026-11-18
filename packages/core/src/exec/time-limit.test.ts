import { describe, expect, it } from 'vitest';
import { effectiveTimeLimitMs, timeLimitFromReference } from './time-limit';

describe('time limits', () => {
  it('is max(2000, 3 × slowest), rounded up to 100 ms', () => {
    expect(timeLimitFromReference(0)).toBe(2000);
    expect(timeLimitFromReference(600)).toBe(2000);
    expect(timeLimitFromReference(700)).toBe(2100);
    expect(timeLimitFromReference(701)).toBe(2200);
    expect(timeLimitFromReference(-5)).toBe(2000);
  });

  it('scales by execution.timeScale, clamped to 0.5–10', () => {
    expect(effectiveTimeLimitMs(2000)).toBe(2000);
    expect(effectiveTimeLimitMs(2000, 1.5)).toBe(3000);
    expect(effectiveTimeLimitMs(2000, 0.1)).toBe(1000);
    expect(effectiveTimeLimitMs(2000, 50)).toBe(20000);
    expect(effectiveTimeLimitMs(2000, Number.NaN)).toBe(2000);
  });
});
