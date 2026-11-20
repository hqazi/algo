/** Helpers for the title bar (kept apart from components for fast refresh). */
import type { TutorStatusView } from '../../../shared/tutor';

const BACKEND: Record<TutorStatusView['backend'], string> = {
  anthropic: 'Anthropic API',
  'claude-code': 'Claude Code',
  fake: 'Test backend',
  none: 'No backend',
};

/** The backend's name for people ("Anthropic API"); Settings → Tutor uses it too. */
export function backendName(backend: TutorStatusView['backend']): string {
  return BACKEND[backend];
}

/** `mac` or `other`: where the window controls sit (left or right). */
export function windowPlatform(): 'mac' | 'other' {
  return /Mac/i.test(navigator.userAgent) ? 'mac' : 'other';
}

/** The tooltip for the tutor status: on or off, and the backend or the reason. */
export function tutorTooltip(t: TutorStatusView): string {
  if (!t.available) return t.reason ? `Tutor off: ${t.reason}` : 'Tutor off';
  return [`Tutor on: ${BACKEND[t.backend]}`, t.model ? `model ${t.model}` : null]
    .filter(Boolean)
    .join(', ');
}
