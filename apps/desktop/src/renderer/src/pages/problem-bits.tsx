/**
 * Small pieces Home, Problems and Progress share (T31): the difficulty dot,
 * the status icon and the topic level counts.
 */
import { Circle, CircleCheck, CircleSlash, Contrast } from 'lucide-react';
import type { ProblemListItem } from '../../../shared/practice';
import { PROBLEM_STATUS_LABEL, titleCase } from '../lib/format';
import './problem-bits.css';

/** A coloured dot and the word ("Easy"). */
export function DifficultyDot({ difficulty }: { difficulty: string }) {
  return <span className={`diff-dot diff-dot-${difficulty}`}>{titleCase(difficulty)}</span>;
}

const STATUS_ICON = {
  new: Circle,
  active: Contrast,
  solved: CircleCheck,
  gave_up: CircleSlash,
} as const;

/** An icon for a problem's status (empty circle, half circle, check), named for screen readers. */
export function StatusIcon({ status }: { status: ProblemListItem['status'] }) {
  const Icon = STATUS_ICON[status];
  const label = PROBLEM_STATUS_LABEL[status] ?? status;
  return (
    <span className={`status-icon status-icon-${status}`} title={label}>
      <Icon aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
