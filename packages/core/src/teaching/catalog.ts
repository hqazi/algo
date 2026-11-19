/**
 * The problem catalog teaching logic and tools read (SPEC §5.3): every
 * curated, generated, pasted and imported problem, by slug (slugs are unique
 * across sources). Ported from `dsa-tutor/dsa_tutor/core/catalog.py`.
 *
 * The desktop app implements it over `content/problems/` and the data
 * folder; tests use `memoryCatalog`. Listing is synchronous (the recommender
 * runs inside a storage write); loading a full problem is not.
 */
import type { Problem } from '../problems/loader';
import type { Difficulty, ProblemSource } from '../problems/schema';
import { SLUG_RE } from '../problems/schema';
import type { Language } from '../types/signature';
import { TutorError } from './errors';
import type { Topic } from './topics';

export interface ProblemSummary {
  slug: string;
  title: string;
  topic: string;
  difficulty: Difficulty;
  source: ProblemSource;
  languages: Language[];
}

export interface ProblemCatalog {
  /** The topics table, in teaching order. */
  topics(): readonly Topic[];
  /**
   * Every problem: curated first (by topic, then slug), then the others (by
   * slug). The recommender takes the first unattempted match in this order.
   */
  list(): readonly ProblemSummary[];
  /** The full problem (hidden tests and reference included: main process only). */
  load(slug: string): Promise<Problem | null>;
}

export function checkSlug(slug: string): string {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug))
    throw new TutorError(`invalid slug ${JSON.stringify(slug)}`, 'invalid_slug');
  return slug;
}

export function summaryOf(problem: Problem): ProblemSummary {
  const m = problem.meta;
  return {
    slug: m.slug,
    title: m.title,
    topic: m.topic,
    difficulty: m.difficulty,
    source: m.source,
    languages: [...m.languages],
  };
}

/** Catalog order: curated by topic then slug, then the rest by slug. */
export function catalogOrder(a: ProblemSummary, b: ProblemSummary): number {
  const ac = a.source === 'curated' ? 0 : 1;
  const bc = b.source === 'curated' ? 0 : 1;
  if (ac !== bc) return ac - bc;
  if (ac === 0 && a.topic !== b.topic) return a.topic < b.topic ? -1 : 1;
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

/** A catalog over problems already loaded (tests; small sets). `add` replaces by slug. */
export function memoryCatalog(
  topics: readonly Topic[],
  problems: readonly Problem[] = [],
): ProblemCatalog & { add(problem: Problem): void } {
  const bySlug = new Map<string, Problem>();
  let order: ProblemSummary[] = [];
  const add = (p: Problem): void => {
    bySlug.set(p.meta.slug, p);
    order = [...bySlug.values()].map(summaryOf).sort(catalogOrder);
  };
  problems.forEach(add);
  return {
    topics: () => topics,
    list: () => order,
    load: (slug) => Promise.resolve(bySlug.get(slug) ?? null),
    add,
  };
}
