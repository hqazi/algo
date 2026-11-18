/**
 * Redaction (SPEC §6.1, §10): before a report leaves the main process, hidden
 * tests keep only `id`, `visibility`, `category`, `status` and `timeMs`. The
 * renderer and the tutor only ever see redacted reports.
 *
 * Built field by field (an allowlist), so a field added to `TestResult` later
 * stays hidden unless it is added here on purpose.
 */
import type { RunReport, TestResult } from './types';

export function redactResult(r: TestResult): TestResult {
  if (r.visibility !== 'hidden') return { ...r };
  const out: TestResult = { id: r.id, visibility: 'hidden', status: r.status };
  if (r.category !== undefined) out.category = r.category;
  if (r.timeMs !== undefined) out.timeMs = r.timeMs;
  return out;
}

export function redactReport(report: RunReport): RunReport {
  const out: RunReport = {
    ok: report.ok,
    results: report.results.map(redactResult),
    durationMs: report.durationMs,
  };
  if (report.error) out.error = { kind: report.error.kind, message: report.error.message };
  return out;
}
