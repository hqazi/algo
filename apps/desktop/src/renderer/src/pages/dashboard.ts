/**
 * What Home, Problems and Progress compute from the data they load (T31),
 * kept apart from the components so it can be unit tested.
 */
import type {
  NextResponse,
  ProblemFilters,
  ProblemListItem,
  TopicView,
} from '../../../shared/practice';

type Key = keyof ProblemFilters;

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", else the date. */
export function ago(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const min = Math.round((now - t) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return new Date(t).toLocaleDateString();
}

/** The reason core gives, as a sentence for people (it is written for the tutor). */
export function reasonText(next: NextResponse): string {
  const base = next.reason.replace(/; no unattempted problem left here.*$/, '');
  return `${base.charAt(0).toUpperCase()}${base.slice(1)}.`;
}

/** Problems that pass every filter except `skip` (so a filter's counts ignore its own choice). */
export function matching(
  items: readonly ProblemListItem[],
  filters: ProblemFilters,
  skip?: Key,
): ProblemListItem[] {
  return items.filter((p) =>
    (Object.keys(filters) as Key[]).every((k) => k === skip || !filters[k] || p[k] === filters[k]),
  );
}

export function countBy(items: readonly ProblemListItem[], key: Key): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of items) out.set(p[key], (out.get(p[key]) ?? 0) + 1);
  return out;
}

/** The bar's three parts (distinct problems) and the counts worth showing. */
export function topicParts(t: Pick<TopicView, 'attempted' | 'solved' | 'solved_unaided'>): {
  unaided: number;
  helped: number;
  tried: number;
  text: string;
} {
  const unaided = t.solved_unaided;
  const helped = Math.max(0, t.solved - t.solved_unaided);
  const tried = Math.max(0, t.attempted - t.solved);
  const text = [
    [unaided, 'unaided'],
    [helped, 'with help'],
    [tried, 'tried'],
  ]
    .filter(([n]) => n)
    .map(([n, l]) => `${n} ${l}`)
    .join(' · ');
  return { unaided, helped, tried, text };
}

export interface LevelCounts {
  comfortable: number;
  learning: number;
  new: number;
  /** Problems solved, with or without help (each problem once). */
  solved: number;
}

export function levelCounts(topics: readonly TopicView[]): LevelCounts {
  const out: LevelCounts = { comfortable: 0, learning: 0, new: 0, solved: 0 };
  for (const t of topics) {
    out[t.level] += 1;
    out.solved += t.solved;
  }
  return out;
}
