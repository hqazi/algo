/**
 * Time limits for Pyodide (SPEC §6.2, DECISIONS D-15).
 *
 * A problem's `time_limit_ms` is set from its reference solution measured in
 * Pyodide: `max(2000, 3 × the slowest test)`, rounded up to 100 ms. At run time
 * it is multiplied by the user's `execution.timeScale`.
 */

export const MIN_TIME_LIMIT_MS = 2000;
export const REFERENCE_FACTOR = 3;
/** Bounds for `execution.timeScale`. */
export const MIN_TIME_SCALE = 0.5;
export const MAX_TIME_SCALE = 10;

/** The `time_limit_ms` to store for a problem whose slowest reference test took `slowestMs`. */
export function timeLimitFromReference(slowestMs: number): number {
  const raw = Math.max(MIN_TIME_LIMIT_MS, REFERENCE_FACTOR * Math.max(0, slowestMs));
  return Math.ceil(raw / 100) * 100;
}

/** The per-test limit for a run: the problem's limit times the user's scale (clamped). */
export function effectiveTimeLimitMs(problemLimitMs: number, timeScale = 1): number {
  const scale = Number.isFinite(timeScale)
    ? Math.min(MAX_TIME_SCALE, Math.max(MIN_TIME_SCALE, timeScale))
    : 1;
  return Math.round(problemLimitMs * scale);
}
