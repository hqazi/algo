import type { ExplanationVersionView } from '../../../shared/tutor';
import { when } from '../lib/format';

/** "Latest · 2 hours ago", or just the time for older versions. */
export function versionLabel(v: ExplanationVersionView): string {
  const time = when(v.created_at);
  return v.latest ? `Latest · ${time}` : time;
}
