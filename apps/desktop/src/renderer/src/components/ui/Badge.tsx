/** A small pill (20px, tinted background, no border) for statuses, tags and difficulty. */
import type { ReactNode } from 'react';

export type BadgeTone =
  'neutral' | 'accent' | 'pass' | 'fail' | 'warn' | 'easy' | 'medium' | 'hard';

export interface BadgeProps {
  tone?: BadgeTone | undefined;
  /** A coloured dot before the text (difficulty). */
  dot?: boolean | undefined;
  className?: string | undefined;
  title?: string | undefined;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', dot, className, title, children }: BadgeProps) {
  const cls = [
    'ui-badge',
    tone === 'neutral' ? '' : `ui-badge-${tone}`,
    dot ? 'ui-badge-dot' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={cls} title={title}>
      {children}
    </span>
  );
}
