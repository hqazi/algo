/**
 * Compare a solution's result with the expected value (SPEC §5.1, §6.1).
 *
 * Ported from `dsa-tutor/dsa_tutor/core/grading.py` (`values_equal`, `_canon`,
 * `compare`) with the same behaviour:
 *
 * - `exact`: deep equality; booleans never equal numbers; objects need the
 *   same keys.
 * - `unordered`: when both are lists, compare as multisets (top level only).
 * - `unordered_deep`: like `unordered`, and nested lists are unordered too
 *   (lists inside objects keep their order, as in dsa-tutor).
 * - `float`: numbers anywhere in the value match within
 *   `tolerance * max(1, |expected|)`; default tolerance 1e-6.
 *
 * Values come from `parseJson`, so big integers are `bigint`. JSON has no
 * int/float distinction once parsed, so `1` equals `1.0` here as in Python.
 */
import { stringifyJson } from '../types/json';

export const COMPARE_MODES = ['exact', 'unordered', 'unordered_deep', 'float'] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];

export type CompareSpec =
  | { mode: 'exact' | 'unordered' | 'unordered_deep' }
  | { mode: 'float'; tolerance?: number | undefined };

export const DEFAULT_TOLERANCE = 1e-6;

/** True if `actual` matches `expected` under `spec` (default: exact). */
export function compareValues(actual: unknown, expected: unknown, spec?: CompareSpec): boolean {
  const mode = spec?.mode ?? 'exact';
  const tol = spec?.mode === 'float' ? (spec.tolerance ?? DEFAULT_TOLERANCE) : undefined;
  if (
    (mode === 'unordered' || mode === 'unordered_deep') &&
    Array.isArray(actual) &&
    Array.isArray(expected)
  ) {
    const deep = mode === 'unordered_deep';
    return valuesEqual(canon(actual, deep), canon(expected, deep));
  }
  return valuesEqual(actual, expected, tol);
}

/** Deep equality with an optional relative tolerance for numbers. */
export function valuesEqual(a: unknown, b: unknown, tol?: number): boolean {
  if (typeof a === 'boolean' || typeof b === 'boolean') return a === b;
  if (isNum(a) && isNum(b)) {
    if (tol !== undefined) {
      const x = Number(a);
      const y = Number(b);
      return Math.abs(x - y) <= tol * Math.max(1, Math.abs(y));
    }
    return numEqual(a, b);
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => valuesEqual(x, b[i], tol));
  }
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length || !ka.every((k) => Object.hasOwn(b, k))) return false;
    return ka.every((k) => valuesEqual(a[k], b[k], tol));
  }
  // Strings and null; a missing result (undefined) counts as null, like Python's None.
  return (a ?? null) === (b ?? null);
}

function isNum(x: unknown): x is number | bigint {
  return typeof x === 'number' || typeof x === 'bigint';
}

function numEqual(a: number | bigint, b: number | bigint): boolean {
  if (typeof a === typeof b) return a === b;
  // Mixed bigint and number: equal only if the number is that exact integer.
  const n = (typeof a === 'number' ? a : b) as number;
  const big = (typeof a === 'bigint' ? a : b) as bigint;
  return Number.isInteger(n) && BigInt(n) === big;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Sort a list by each item's canonical JSON (Python: `json.dumps(v, sort_keys=True)`). */
function canon(x: unknown, deep: boolean): unknown {
  if (!Array.isArray(x)) return x;
  const items = deep ? x.map((v) => canon(v, deep)) : x;
  return items
    .map((v) => [sortKey(v), v] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, v]) => v);
}

function sortKey(v: unknown): string {
  return stringifyJson(sortObjectKeys(v));
}

function sortObjectKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortObjectKeys);
  if (isObject(v)) {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, sortObjectKeys(v[k])]),
    );
  }
  return v;
}
