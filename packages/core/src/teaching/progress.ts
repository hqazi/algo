/**
 * Topic levels from attempts (SPEC §9.1). Ported from
 * `dsa-tutor/dsa_tutor/core/state.py` (`level_for`, `compute_topics`).
 *
 * Levels are always derived from the attempts table; `topic_progress` rows
 * are a cache kept up to date for the UI.
 */
import type { AttemptRecord, TopicLevel } from '../storage';

/** Unaided solves of different problems needed for "comfortable". */
export const COMFORTABLE_AFTER = 3;
/** Unaided solves in a topic before medium problems are recommended. */
export const MEDIUM_AFTER = 2;

export interface TopicStats {
  /** Different problems attempted (open attempts included). */
  attempted: number;
  /** Different problems solved (unaided or with hints). */
  solved: number;
  /** Different problems solved without hints or an explanation. */
  solved_unaided: number;
  last_practised: string | null;
  level: TopicLevel;
}

export function levelFor(stats: Pick<TopicStats, 'attempted' | 'solved_unaided'>): TopicLevel {
  if (stats.solved_unaided >= COMFORTABLE_AFTER) return 'comfortable';
  if (stats.attempted > 0) return 'learning';
  return 'new';
}

export const EMPTY_STATS: TopicStats = {
  attempted: 0,
  solved: 0,
  solved_unaided: 0,
  last_practised: null,
  level: 'new',
};

/**
 * Stats per topic for every topic with an attempt. `topicOf` maps a slug to
 * its topic (`null` for a problem that no longer exists: its attempts are
 * left out).
 */
export function computeTopics(
  attempts: readonly AttemptRecord[],
  topicOf: (slug: string) => string | null,
): Map<string, TopicStats> {
  const sets = new Map<
    string,
    { attempted: Set<string>; solved: Set<string>; unaided: Set<string>; last: string }
  >();
  for (const a of attempts) {
    const topic = topicOf(a.slug);
    if (topic === null) continue;
    let b = sets.get(topic);
    if (!b) {
      b = { attempted: new Set(), solved: new Set(), unaided: new Set(), last: '' };
      sets.set(topic, b);
    }
    b.attempted.add(a.slug);
    if (a.outcome === 'unaided' || a.outcome === 'with_hints') b.solved.add(a.slug);
    if (a.outcome === 'unaided') b.unaided.add(a.slug);
    const stamp = a.finishedAt ?? a.startedAt;
    if (stamp > b.last) b.last = stamp;
  }
  const out = new Map<string, TopicStats>();
  for (const [topic, b] of sets) {
    const stats = {
      attempted: b.attempted.size,
      solved: b.solved.size,
      solved_unaided: b.unaided.size,
      last_practised: b.last || null,
    };
    out.set(topic, { ...stats, level: levelFor(stats) });
  }
  return out;
}

export function statsOf(topics: ReadonlyMap<string, TopicStats>, topic: string): TopicStats {
  return topics.get(topic) ?? EMPTY_STATS;
}
