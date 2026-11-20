import type { ExplanationVersionView } from '../../../shared/tutor';
import { fullDate, relativeDate } from '../lib/format';

/** "Latest · 2 h ago", or just the time for older versions (docs/design.md → Dates). */
export function versionLabel(v: ExplanationVersionView): string {
  const time = relativeDate(v.created_at);
  return v.latest ? `Latest · ${time}` : time;
}

/** The full date, for the label's tooltip. */
export function versionTitle(v: ExplanationVersionView): string {
  return fullDate(v.created_at);
}
