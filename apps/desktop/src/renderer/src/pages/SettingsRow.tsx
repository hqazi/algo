/**
 * Building blocks for the Settings sections (T33, docs/design.md →
 * Settings): a status as a coloured dot and text, and an aligned row with a
 * label on the left and its value or control on the right.
 */
import type { ReactNode } from 'react';

/** ok: working; off: not set up or not running; warn: works with a caveat; error: failed. */
export type StatusTone = 'ok' | 'off' | 'warn' | 'error' | 'pending';

export function StatusText({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className={`status-text tone-${tone}`}>
      <span className="status-dot" aria-hidden="true" />
      <span className="status-words">{children}</span>
    </span>
  );
}

/** A label and its value, aligned with the form rows around it. */
export function SettingRow({
  label,
  children,
  testId,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <div
      className={['setting-row', className ?? ''].filter(Boolean).join(' ')}
      data-testid={testId}
    >
      <span className="setting-label">{label}</span>
      <div className="setting-value">{children}</div>
    </div>
  );
}
