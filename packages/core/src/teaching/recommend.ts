/**
 * What to practise next (SPEC §9.2). Ported from
 * `dsa-tutor/dsa_tutor/core/state.py` (`recommend`, `pick_problem`).
 *
 * Stay on the focus topic until comfortable; otherwise the weakest topic whose
 * prerequisites are met (a prerequisite is met when it is comfortable or its
 * group was rated `solid`); ties go to the topic listed first. Easy until
 * `MEDIUM_AFTER` unaided solves in the topic, then medium. Curated problems
 * before others; when nothing unattempted is left, suggest generating one.
 */
import type { Difficulty, ProblemSource } from '../problems/schema';
import type { ProfileRecord } from '../storage';
import type { Language } from '../types/signature';
import type { ProblemSummary } from './catalog';
import { TutorError } from './errors';
import { COMFORTABLE_AFTER, MEDIUM_AFTER, statsOf, type TopicStats } from './progress';
import type { Topic } from './topics';

const COMFORT_RANK: Record<string, number> = { none: 0, some: 1, solid: 2 };

export type Recommendation = {
  ok: true;
  topic: string;
  topic_name: string;
  difficulty: Difficulty;
  /** The focus topic moves to `topic` (the caller saves it). */
  focus_changed: boolean;
  /** One line for the learner. */
  reason: string;
  /** Slugs with an open attempt. */
  unfinished?: string[];
} & (
  { action: 'solve'; slug: string; title: string; source: ProblemSource } | { action: 'generate' }
);

export interface RecommendInput {
  profile: ProfileRecord;
  topics: readonly Topic[];
  stats: ReadonlyMap<string, TopicStats>;
  problems: readonly ProblemSummary[];
  /** Every slug with an attempt, open or closed. */
  attempted: ReadonlySet<string>;
  unfinished: readonly string[];
  topic?: string | undefined;
  difficulty?: Difficulty | undefined;
}

export function recommend(input: RecommendInput): Recommendation {
  const { profile, topics, stats } = input;
  const byId = new Map(topics.map((t) => [t.id, t]));
  const order = new Map(topics.map((t, i) => [t.id, i]));
  const level = (id: string): string => statsOf(stats, id).level;
  const prereqMet = (id: string): boolean =>
    level(id) === 'comfortable' || profile.comfort[byId.get(id)!.group] === 'solid';

  const focus = profile.focusTopic;
  const focusTopic = focus !== null ? byId.get(focus) : undefined;
  let chosen: Topic;
  let reason: string;
  let focusChanged = false;
  if (input.topic !== undefined) {
    const t = byId.get(input.topic);
    if (!t)
      throw new TutorError(
        `unknown topic "${input.topic}"; topics: ${topics.map((x) => x.id).join(', ')}`,
      );
    chosen = t;
    reason = 'you asked for this topic';
  } else if (focusTopic && level(focusTopic.id) !== 'comfortable') {
    const u = statsOf(stats, focusTopic.id).solved_unaided;
    chosen = focusTopic;
    reason =
      `staying on your focus topic, ${focusTopic.name}, until it is comfortable ` +
      `(${u}/${COMFORTABLE_AFTER} unaided solves)`;
  } else {
    const prefix = focusTopic ? `${focusTopic.name} is comfortable now; ` : '';
    const candidates = topics.filter(
      (t) =>
        level(t.id) !== 'comfortable' && t.prerequisites.every((p) => !byId.has(p) || prereqMet(p)),
    );
    if (candidates.length) {
      const key = (t: Topic): [number, number, number] => [
        COMFORT_RANK[profile.comfort[t.group] ?? 'none'] ?? 0,
        statsOf(stats, t.id).solved_unaided,
        order.get(t.id)!,
      ];
      chosen = minBy(candidates, key);
      reason = `${prefix}${chosen.name} is your weakest topic whose prerequisites you have covered`;
    } else {
      // Everything comfortable: revisit the topic practised longest ago.
      chosen = minBy(topics, (t) => [statsOf(stats, t.id).last_practised ?? '']);
      reason = `${prefix}every topic is comfortable; ${chosen.name} is the one practised longest ago`;
    }
    if (chosen.id !== focus) focusChanged = true;
  }

  const unaided = statsOf(stats, chosen.id).solved_unaided;
  let difficulty: Difficulty;
  if (input.difficulty !== undefined) {
    difficulty = input.difficulty;
  } else if (unaided < MEDIUM_AFTER) {
    difficulty = 'easy';
    reason += `; easy until ${MEDIUM_AFTER} unaided solves here (${unaided} so far)`;
  } else {
    difficulty = 'medium';
    reason += `; medium now that you have ${unaided} unaided solves here`;
  }

  const head = {
    ok: true as const,
    topic: chosen.id,
    topic_name: chosen.name,
    difficulty,
    focus_changed: focusChanged,
    ...(input.unfinished.length ? { unfinished: [...input.unfinished].sort() } : {}),
  };
  const picked = pickProblem(
    input.problems,
    chosen.id,
    difficulty,
    input.attempted,
    profile.language,
  );
  if (picked)
    return {
      ...head,
      action: 'solve',
      slug: picked.slug,
      title: picked.title,
      source: picked.source,
      reason,
    };
  return {
    ...head,
    action: 'generate',
    reason: `${reason}; no unattempted problem left here, so generate one (create_problem)`,
  };
}

/** The first unattempted problem in catalog order, curated before the rest. */
export function pickProblem(
  problems: readonly ProblemSummary[],
  topic: string,
  difficulty: Difficulty,
  attempted: ReadonlySet<string>,
  language: Language,
): ProblemSummary | null {
  const pool = problems.filter(
    (p) =>
      p.topic === topic &&
      p.difficulty === difficulty &&
      !attempted.has(p.slug) &&
      p.languages.includes(language),
  );
  return pool.find((p) => p.source === 'curated') ?? pool[0] ?? null;
}

function minBy<T extends object>(items: readonly T[], key: (item: T) => (number | string)[]): T {
  let best = items[0]!;
  let bestKey = key(best);
  for (const item of items.slice(1)) {
    const k = key(item);
    if (compareKeys(k, bestKey) < 0) {
      best = item;
      bestKey = k;
    }
  }
  return best;
}

function compareKeys(a: (number | string)[], b: (number | string)[]): number {
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}
