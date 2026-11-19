/**
 * The teaching logic over injected storage, catalog and workspace: status,
 * profile, focus, next problem, start, hints, explanations and recording
 * attempts (SPEC §9). Ported from `dsa-tutor/dsa_tutor/core/state.py`; the
 * tutor tools (`../tools/`) and the app's own UI actions both call it.
 *
 * Results are the compact JSON objects the tutor sees (snake_case, as in
 * `dsa-tutor`), always with `ok: true`; expected failures throw `TutorError`.
 *
 * Every change runs inside one `storage.write`, so reads and the write that
 * depends on them are atomic and ordered with every other change.
 */
import type { Problem } from '../problems/loader';
import type { Difficulty, ProblemSource } from '../problems/schema';
import { DIFFICULTIES } from '../problems/schema';
import { languagesWithHarness } from '../problems/validate';
import type {
  AttemptOutcome,
  AttemptRecord,
  ProfileRecord,
  Storage,
  StorageReader,
  StorageWriter,
  TopicLevel,
} from '../storage';
import { ATTEMPT_OUTCOMES } from '../storage';
import type { Language } from '../types/signature';
import { checkSlug, type ProblemCatalog, type ProblemSummary } from './catalog';
import { TutorError } from './errors';
import { defaultProfile, profileView, setProfileValue, type ProfileView } from './profile';
import { computeTopics, statsOf, type TopicStats } from './progress';
import { recommend, type Recommendation } from './recommend';
import { starterCode, workspacePath, type Workspace } from './workspace';

export const MAX_HINT_LEVEL = 4;
export const MAX_NOTES_CHARS = 600;
export const RECENT_ATTEMPTS = 3;

export interface TeachingDeps {
  storage: Storage;
  catalog: ProblemCatalog;
  workspace: Workspace;
  /** The current time as an ISO 8601 string (core reads no clock itself). */
  now: () => string;
}

/** `new Date()` as ISO 8601 without milliseconds, e.g. `2026-11-19T10:00:00Z`. */
export function isoNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export type ProblemStatus = 'new' | 'active' | 'solved' | 'gave_up';

export interface StatusResult {
  ok: true;
  onboarded: boolean;
  profile?: Omit<ProfileView, 'created_at' | 'updated_at'>;
  /** Topics with an attempt, and the focus topic, in teaching order. */
  topics: ({ topic: string } & TopicStats)[];
  untouched_topics: number;
  active: { slug: string; topic: string | null; hints_used: number; started_at: string }[];
  recent: { slug: string; outcome: AttemptOutcome | null; ended_at: string | null }[];
}

export interface StartResult {
  ok: true;
  slug: string;
  resumed: boolean;
  language: Language;
  workspace: string;
  workspace_created: boolean;
  hints_used: number;
}

export type HintResult =
  | {
      ok: true;
      slug: string;
      level: number;
      max_level: number;
      hint_preference: string;
      guide: string;
    }
  | { ok: true; slug: string; level: null; hints_used: number; note: string };

export interface RecordInput {
  passed: number;
  total: number;
  gaveUp?: boolean | undefined;
  /** Normally derived; given only by maintainers' tools. */
  outcome?: AttemptOutcome | undefined;
  notes?: string | null | undefined;
}

export interface RecordResult {
  ok: true;
  recorded: {
    slug: string;
    outcome: AttemptOutcome;
    hints_used: number;
    tests_passed: number;
    tests_total: number;
  };
  /** The closed attempt's id (for its test run). */
  attempt_id: number;
  topic: string;
  level: TopicLevel;
  level_changed: boolean;
  solved_unaided: number;
}

export interface AttemptView {
  id: number;
  slug: string;
  topic: string | null;
  difficulty: Difficulty | null;
  source: ProblemSource | null;
  language: Language;
  started_at: string;
  ended_at: string | null;
  outcome: AttemptOutcome | null;
  hints_used: number;
  explanation_viewed: boolean;
  tests_passed: number | null;
  tests_total: number | null;
  notes: string;
}

export class Teaching {
  constructor(private readonly deps: TeachingDeps) {}

  get catalog(): ProblemCatalog {
    return this.deps.catalog;
  }

  /** The injected clock. */
  now(): string {
    return this.deps.now();
  }

  // ------------------------------------------------------------ lookups

  /** The problem's summary; `TutorError` (`no_problem`) if there is none. */
  summary(slug: string): ProblemSummary {
    checkSlug(slug);
    const s = this.deps.catalog.list().find((p) => p.slug === slug);
    if (!s) throw new TutorError(`no problem with slug "${slug}"`, 'no_problem');
    return s;
  }

  /** The full problem (main process only: hidden tests and reference). */
  async problem(slug: string): Promise<Problem> {
    this.summary(slug);
    const p = await this.deps.catalog.load(slug);
    if (!p) throw new TutorError(`no problem with slug "${slug}"`, 'no_problem');
    return p;
  }

  /** The profile if onboarded, else `null`. */
  profile(): ProfileRecord | null {
    const p = this.deps.storage.read((db) => db.getProfile());
    return p?.onboarded ? p : null;
  }

  /** The language a problem is worked in: its open attempt's, else the profile's. */
  languageFor(slug: string): Language {
    const open = this.deps.storage.read((db) => db.getOpenAttempt(slug));
    return open?.language ?? this.profile()?.language ?? 'python';
  }

  problemStatus(slug: string): ProblemStatus {
    return this.deps.storage.read((db) => {
      if (db.getOpenAttempt(slug)) return 'active';
      const outcomes = db.listAttempts({ slug, open: false }).map((a) => a.outcome);
      if (outcomes.some((o) => o === 'unaided' || o === 'with_hints')) return 'solved';
      return outcomes.length ? 'gave_up' : 'new';
    });
  }

  /** True once any attempt at `slug` has been recorded (closed). */
  attemptRecorded(slug: string): boolean {
    return this.deps.storage.read((db) => db.listAttempts({ slug, open: false }).length > 0);
  }

  /** Per-topic stats for every topic with an attempt. */
  topicStats(db?: StorageReader): Map<string, TopicStats> {
    const run = (r: StorageReader): Map<string, TopicStats> =>
      computeTopics(r.listAttempts(), this.topicOf(r));
    return db ? run(db) : this.deps.storage.read(run);
  }

  // ------------------------------------------------------------ status

  status(): StatusResult {
    return this.deps.storage.read((db) => {
      const raw = db.getProfile();
      const profile = raw?.onboarded ? raw : null;
      const stats = this.topicStats(db);
      const topicOf = this.topicOf(db);
      const topics = this.deps.catalog.topics();
      const out: StatusResult = {
        ok: true,
        onboarded: profile !== null,
        topics: topics
          .filter((t) => stats.has(t.id) || t.id === profile?.focusTopic)
          .map((t) => ({ topic: t.id, ...statsOf(stats, t.id) })),
        untouched_topics: topics.filter((t) => !statsOf(stats, t.id).attempted).length,
        active: db.listAttempts({ open: true }).map((a) => ({
          slug: a.slug,
          topic: topicOf(a.slug),
          hints_used: a.hintsUsed,
          started_at: a.startedAt,
        })),
        recent: db.listAttempts({ open: false, last: RECENT_ATTEMPTS }).map((a) => ({
          slug: a.slug,
          outcome: a.outcome,
          ended_at: a.finishedAt,
        })),
      };
      if (profile) {
        const view: Partial<ProfileView> = profileView(profile);
        delete view.created_at;
        delete view.updated_at;
        out.profile = view as NonNullable<StatusResult['profile']>;
      }
      return out;
    });
  }

  // ------------------------------------------------------------ profile

  getProfile(): { ok: true; onboarded: boolean; profile: ProfileView | null } {
    const p = this.profile();
    return { ok: true, onboarded: p !== null, profile: p ? profileView(p) : null };
  }

  /** Save the default profile; an existing profile is kept as it is. */
  async profileDefaults(): Promise<{ ok: true; profile: ProfileView; note: string }> {
    const saved = await this.deps.storage.write((db) => {
      const p = this.loadOrDefault(db);
      p.onboarded = true;
      return this.saveProfile(db, p);
    });
    return {
      ok: true,
      profile: profileView(saved),
      note: 'defaults saved; any answer can be changed later',
    };
  }

  /**
   * Set profile values (`comfort.<group>` / `comfort.all` for comfort); a
   * first call starts from the defaults. Saving marks the learner onboarded.
   */
  async setProfile(
    pairs: Record<string, string | null>,
  ): Promise<{ ok: true; profile: ProfileView }> {
    const items = Object.entries(pairs);
    if (!items.length) throw new TutorError('give at least one profile value, e.g. goal=interview');
    const topics = this.deps.catalog.topics();
    const languages = languagesWithHarness();
    const saved = await this.deps.storage.write((db) => {
      const p = this.loadOrDefault(db);
      for (const [key, value] of items) setProfileValue(p, key.trim(), value, topics, languages);
      if (p.goal === 'general') p.interviewDate = null;
      p.onboarded = true;
      return this.saveProfile(db, p);
    });
    return { ok: true, profile: profileView(saved) };
  }

  /** Set the focus topic, or clear it with `null`. Needs a profile. */
  async setFocus(topic: string | null): Promise<{ ok: true; focus_topic: string | null }> {
    const topics = this.deps.catalog.topics();
    const saved = await this.deps.storage.write((db) => {
      const p = this.requireProfile(db);
      setProfileValue(p, 'focus_topic', topic, topics, languagesWithHarness());
      return this.saveProfile(db, p);
    });
    return { ok: true, focus_topic: saved.focusTopic };
  }

  // ------------------------------------------------------------ next / start

  /** Recommend one problem, or say one should be generated; may move the focus topic. */
  async nextProblem(
    options: { topic?: string | undefined; difficulty?: string | undefined; dryRun?: boolean } = {},
  ): Promise<Recommendation> {
    const { topic, difficulty, dryRun = false } = options;
    if (difficulty !== undefined && !(DIFFICULTIES as readonly string[]).includes(difficulty))
      throw new TutorError(`difficulty must be one of ${DIFFICULTIES.join(', ')}`);
    const compute = (db: StorageReader): { rec: Recommendation; profile: ProfileRecord } => {
      const profile = this.requireProfile(db);
      const attempts = db.listAttempts();
      const rec = recommend({
        profile,
        topics: this.deps.catalog.topics(),
        stats: computeTopics(attempts, this.topicOf(db)),
        problems: this.deps.catalog.list(),
        attempted: new Set(attempts.map((a) => a.slug)),
        unfinished: [...new Set(attempts.filter((a) => a.outcome === null).map((a) => a.slug))],
        topic,
        difficulty: difficulty as Difficulty | undefined,
      });
      return { rec, profile };
    };
    if (dryRun) return this.deps.storage.read((db) => compute(db).rec);
    return this.deps.storage.write((db) => {
      const { rec, profile } = compute(db);
      if (rec.focus_changed) this.saveProfile(db, { ...profile, focusTopic: rec.topic });
      return rec;
    });
  }

  /** Open an attempt (or resume the open one) and create the starter solution file. */
  async start(slug: string, language?: Language): Promise<StartResult> {
    const problem = await this.problem(slug);
    const { attempt, resumed } = await this.deps.storage.write((db) => {
      const open = db.getOpenAttempt(slug);
      if (open) return { attempt: open, resumed: true };
      const lang = language ?? this.loadOrDefault(db).language;
      const offered = problem.meta.languages.filter((l) => languagesWithHarness().includes(l));
      if (!offered.includes(lang))
        throw new TutorError(
          `${slug} is not available in ${lang}; languages: ${offered.join(', ')}`,
          'no_language',
        );
      const created = db.createAttempt({ slug, language: lang, startedAt: this.deps.now() });
      this.refreshTopic(db, problem.meta.topic);
      return { attempt: created, resumed: false };
    });
    const topicName =
      this.deps.catalog.topics().find((t) => t.id === problem.meta.topic)?.name ??
      problem.meta.topic;
    const { created } = await this.deps.workspace.create(
      slug,
      attempt.language,
      starterCode(problem.meta, attempt.language, topicName),
    );
    return {
      ok: true,
      slug,
      resumed,
      language: attempt.language,
      workspace: workspacePath(slug, attempt.language),
      workspace_created: created,
      hints_used: attempt.hintsUsed,
    };
  }

  /**
   * Work `slug` in `language` from now on: switches the open attempt's
   * language (opening one if there is none) and creates that language's
   * solution file if missing. Each language keeps its own file, so switching
   * back finds the code where it was left.
   */
  async switchLanguage(slug: string, language: Language): Promise<StartResult> {
    const problem = await this.problem(slug);
    const offered = problem.meta.languages.filter((l) => languagesWithHarness().includes(l));
    if (!offered.includes(language))
      throw new TutorError(
        `${slug} is not available in ${language}; languages: ${offered.join(', ')}`,
        'no_language',
      );
    const switched = await this.deps.storage.write((db) => {
      const open = db.getOpenAttempt(slug);
      if (!open || open.language === language) return false;
      db.updateAttempt(open.id, { language });
      return true;
    });
    const started = await this.start(slug, language);
    return switched ? { ...started, resumed: true } : started;
  }

  // ------------------------------------------------------------ hints, explanations

  /** Count a hint; returns the ladder level to give (`null` once all four are used). */
  async hint(slug: string): Promise<HintResult> {
    const summary = this.summary(slug);
    return this.deps.storage.write((db): HintResult => {
      const attempt = this.openOrCreate(db, slug);
      if (attempt.hintsUsed >= MAX_HINT_LEVEL)
        return {
          ok: true,
          slug,
          level: null,
          hints_used: attempt.hintsUsed,
          note: 'all four hint levels used; offer the full explanation (render_explanation)',
        };
      const level = attempt.hintsUsed + 1;
      db.updateAttempt(attempt.id, { hintsUsed: level });
      db.addHint({ attemptId: attempt.id, level, givenAt: this.deps.now() });
      this.refreshTopic(db, summary.topic);
      return {
        ok: true,
        slug,
        level,
        max_level: MAX_HINT_LEVEL,
        hint_preference: this.loadOrDefault(db).hintPreference,
        guide: 'hint_ladder.md',
      };
    });
  }

  /** Mark the open attempt as explained (a later solve counts as with hints); `false` if none is open. */
  async markExplained(slug: string): Promise<boolean> {
    checkSlug(slug);
    return this.deps.storage.write((db) => {
      const open = db.getOpenAttempt(slug);
      if (!open) return false;
      db.updateAttempt(open.id, { explained: true });
      return true;
    });
  }

  // ------------------------------------------------------------ record

  /** Close the attempt with its test counts; the outcome is derived unless given. */
  async record(slug: string, input: RecordInput): Promise<RecordResult> {
    this.summary(slug);
    return this.deps.storage.write((db) => this.recordWith(db, slug, input));
  }

  /** `record` inside a write the caller already holds (e.g. `storage.serial`). */
  recordWith(db: StorageWriter, slug: string, input: RecordInput): RecordResult {
    const { passed, total, gaveUp = false, outcome: given, notes } = input;
    const summary = this.summary(slug);
    if (given !== undefined && !ATTEMPT_OUTCOMES.includes(given))
      throw new TutorError(`outcome must be one of ${ATTEMPT_OUTCOMES.join(', ')}`);
    if (!Number.isInteger(passed) || !Number.isInteger(total))
      throw new TutorError('passed and total must be integers');
    if (passed < 0 || total <= 0 || passed > total)
      throw new TutorError('need 0 <= passed <= total and total > 0');
    const attempt = this.openOrCreate(db, slug);
    let outcome: AttemptOutcome;
    if (given) outcome = given;
    else if (gaveUp || passed < total) outcome = 'gave_up';
    else if (attempt.hintsUsed || attempt.explained) outcome = 'with_hints';
    else outcome = 'unaided';
    if (outcome !== 'gave_up' && passed < total)
      throw new TutorError(
        'only a run where every test passes counts as solved; use outcome gave_up',
      );
    const before = statsOf(this.topicStats(db), summary.topic).level;
    const closed = db.updateAttempt(attempt.id, {
      finishedAt: this.deps.now(),
      passed,
      total,
      outcome,
      notes: (notes ?? '').trim().slice(0, MAX_NOTES_CHARS),
    });
    const after = this.refreshTopic(db, summary.topic);
    return {
      ok: true,
      recorded: {
        slug,
        outcome,
        hints_used: closed.hintsUsed,
        tests_passed: passed,
        tests_total: total,
      },
      attempt_id: closed.id,
      topic: summary.topic,
      level: after.level,
      level_changed: after.level !== before,
      solved_unaided: after.solved_unaided,
    };
  }

  /** Recorded (closed) attempts, oldest first; the newest `last` of them (default 10, 0 for all). */
  attempts(options: { slug?: string | undefined; last?: number | undefined } = {}): {
    ok: true;
    attempts: AttemptView[];
  } {
    const { slug, last = 10 } = options;
    if (slug !== undefined) checkSlug(slug);
    return this.deps.storage.read((db) => {
      const filter: { slug?: string; open: boolean; last?: number } = { open: false };
      if (slug !== undefined) filter.slug = slug;
      if (last) filter.last = last;
      const bySlug = this.summaries();
      return {
        ok: true,
        attempts: db.listAttempts(filter).map((a) => this.attemptView(db, a, bySlug)),
      };
    });
  }

  // ------------------------------------------------------------ internals

  private summaries(): Map<string, ProblemSummary> {
    return new Map(this.deps.catalog.list().map((p) => [p.slug, p]));
  }

  /** Slug → topic: the catalog, else the problems index (removed problems keep their history). */
  private topicOf(db: StorageReader): (slug: string) => string | null {
    const bySlug = this.summaries();
    return (slug) => bySlug.get(slug)?.topic ?? db.getProblem(slug)?.topic ?? null;
  }

  private attemptView(
    db: StorageReader,
    a: AttemptRecord,
    bySlug: Map<string, ProblemSummary>,
  ): AttemptView {
    const p = bySlug.get(a.slug) ?? db.getProblem(a.slug);
    return {
      id: a.id,
      slug: a.slug,
      topic: p?.topic ?? null,
      difficulty: p?.difficulty ?? null,
      source: p?.source ?? null,
      language: a.language,
      started_at: a.startedAt,
      ended_at: a.finishedAt,
      outcome: a.outcome,
      hints_used: a.hintsUsed,
      explanation_viewed: a.explained,
      tests_passed: a.passed,
      tests_total: a.total,
      notes: a.notes,
    };
  }

  private requireProfile(db: StorageReader): ProfileRecord {
    const p = db.getProfile();
    if (!p?.onboarded)
      throw new TutorError(
        'not onboarded yet: ask the onboarding questions (questionnaire) and save them with ' +
          'set_profile, or save the defaults',
        'not_onboarded',
      );
    return { ...p };
  }

  private loadOrDefault(db: StorageReader): ProfileRecord {
    const p = db.getProfile();
    return p
      ? { ...p, comfort: { ...p.comfort } }
      : defaultProfile(this.deps.catalog.topics(), this.deps.now());
  }

  private saveProfile(db: StorageWriter, p: ProfileRecord): ProfileRecord {
    const saved = { ...p, updatedAt: this.deps.now() };
    db.saveProfile(saved);
    return saved;
  }

  private openOrCreate(db: StorageWriter, slug: string): AttemptRecord {
    return (
      db.getOpenAttempt(slug) ??
      db.createAttempt({
        slug,
        language: this.loadOrDefault(db).language,
        startedAt: this.deps.now(),
      })
    );
  }

  /** Recompute one topic's stats and update its `topic_progress` row. */
  private refreshTopic(db: StorageWriter, topic: string): TopicStats {
    const stats = statsOf(this.topicStats(db), topic);
    db.saveTopicProgress({
      topic,
      level: stats.level,
      unaidedSolves: stats.solved_unaided,
      updatedAt: this.deps.now(),
    });
    return stats;
  }
}
