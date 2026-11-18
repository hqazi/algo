import { describe, expect, it } from 'vitest';
import { compareValues, valuesEqual, type CompareSpec } from './compare';
import { parseJson } from '../types/json';
import golden from './fixtures/dsa-tutor-cases.json';

interface GoldenCase {
  name: string;
  actual: unknown;
  expected: unknown;
  spec: CompareSpec | null;
  equal: boolean;
}

describe('compareValues matches dsa-tutor grading.compare()', () => {
  const cases = golden.cases as GoldenCase[];

  it('has the full case list', () => {
    expect(cases.length).toBeGreaterThanOrEqual(60);
  });

  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(compareValues(c.actual, c.expected, c.spec ?? undefined)).toBe(c.equal);
  });
});

describe('compareValues with 64-bit integers', () => {
  const big = parseJson(
    '[4660046610375530309, 999999999999999999, 1000000000000000000]',
  ) as bigint[];

  it('compares big integers exactly', () => {
    expect(compareValues(big[0], parseJson('4660046610375530309'))).toBe(true);
    expect(compareValues(big[1], big[2])).toBe(false);
    // As doubles both would be 1e18.
    expect(compareValues(big[1], 1e18)).toBe(false);
    expect(compareValues(big[2], 1e18)).toBe(true);
  });

  it('sorts big integers in unordered modes', () => {
    expect(compareValues([big[2], big[1]], [big[1], big[2]], { mode: 'unordered' })).toBe(true);
    expect(compareValues([[big[1]], [1]], [[1], [big[1]]], { mode: 'unordered_deep' })).toBe(true);
  });

  it('uses the tolerance for big integers in float mode', () => {
    expect(compareValues(big[1], big[2], { mode: 'float' })).toBe(true);
  });
});

describe('valuesEqual', () => {
  it('treats a missing actual value as null', () => {
    expect(valuesEqual(undefined, null)).toBe(true);
    expect(valuesEqual(undefined, 0)).toBe(false);
  });

  it('does not match inherited keys', () => {
    expect(valuesEqual({ toString: 1 }, { valueOf: 1 })).toBe(false);
  });
});
