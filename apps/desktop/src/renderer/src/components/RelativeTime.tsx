/**
 * A date shown relative to now ("2 min ago", "yesterday") with the full date
 * as its tooltip (docs/design.md → Dates). One formatter for every page:
 * `relativeDate` and `fullDate` in lib/format.ts.
 */
import { fullDate, relativeDate } from '../lib/format';

export function RelativeTime({
  value,
  className,
}: {
  value: string | number | Date;
  className?: string;
}) {
  const d = value instanceof Date ? value : new Date(value);
  const iso = Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  return (
    <time dateTime={iso} title={fullDate(value)} className={className}>
      {relativeDate(value)}
    </time>
  );
}
