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

/** The reason core gives, as a sentence for people (it is written for the tutor). */
export function reasonText(next: Pick<NextResponse, 'reason'>): string {
  const base = next.reason.replace(/; no unattempted problem left here.*$/, '').replace(/\.$/, '');
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
