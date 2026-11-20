/**
 * Relative times for the Library's chat list (T32, docs/design.md → Library):
 * "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", then the
 * date. A local helper until T34 moves the Library onto the shared formatter
 * T33 adds to `lib/format.ts`.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** `iso` relative to `now` (ms); '' for a missing value, the text itself if it is not a date. */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const ago = now - t;
  // A clock a little ahead of the stored time still reads as now.
  if (ago < 45_000) return 'just now';
  if (ago < HOUR) return `${Math.max(1, Math.round(ago / MIN))} min ago`;
  const days = Math.round((startOfDay(now) - startOfDay(t)) / DAY);
  if (days === 0) return `${Math.floor(ago / HOUR)} h ago`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}
