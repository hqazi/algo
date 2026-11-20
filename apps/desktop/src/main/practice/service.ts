/**
 * The practice flow without AI (T08): what the UI's buttons do, over the same
 * teaching logic, storage, workspace, executor and per-problem guard as the
 * tutor's tools (T10 builds its registry from `practice.toolContext`), so a
 * chat tool and a button never run the same problem at once (DECISIONS D-21).
 *
 * Everything returned here is shaped for `shared/practice.ts` and is safe for
 * the renderer: reports are redacted with core's `runView`, and test values
 * become JSON text.
 */
import {
  checkSlug,
  runProblemTests,
  languagesWithHarness,
  runView,
  SlugBusyError,
  SlugGuard,
  starterCode,
  stringifyJson,
  Teaching,
  TutorError,
  workspacePath,
  type Executor,
  type ExecutorStatus,
  type JsonValue,
  type Language,
  type Problem,
  type RecordResult,
  type RunView,
  type Storage,
  type TestResult,
  type TutorToolContext,
} from '@algo/core';
import type {
  AttemptView,
  CaseView,
  ExampleView,
  GiveUpResponse,
  LanguageOption,
  ProblemDetail,
  ProblemFilters,
  ProblemListItem,
  ProblemStatus,
  RecordView,
  ReferenceResponse,
  ReportView,
  SubmitResponse,
  TopicView,
  WorkspaceResponse,
} from '../../shared/practice';
import type { FileCatalog } from './catalog';
import type { FileWorkspace, WatchHandle } from './file-workspace';

export interface PracticeDeps {
  storage: Storage;
  catalog: FileCatalog;
  workspace: FileWorkspace;
  executorFor: (language: Language) => Executor | null;
  /** Whether `language` can run here (the toolchain is found); default: if it has an executor. */
  languageStatus?: (language: Language) => Promise<ExecutorStatus>;
  timeScale: () => number;
  now: () => string;
}

/** An expected refusal, shown to the learner as is (IPC code `refused`). */
export class PracticeRefusal extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'PracticeRefusal';
  }
}

const text = (v: unknown): string => {
  try {
    return stringifyJson(v as JsonValue);
  } catch {
    return String(v);
  }
};

function inputText(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object') return {};
  return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, text(v)]));
}

/** One redacted case for the UI. Hidden cases are rebuilt from an allowlist (again). */
export function caseView(r: TestResult): CaseView {
  if (r.visibility === 'hidden') {
    const out: CaseView = { id: r.id, visibility: 'hidden', status: r.status };
    if (r.category !== undefined) out.category = r.category;
    if (r.timeMs !== undefined) out.time_ms = r.timeMs;
    return out;
  }
  const out: CaseView = { id: r.id, visibility: 'visible', status: r.status };
  if (r.category !== undefined) out.category = r.category;
  if (r.timeMs !== undefined) out.time_ms = r.timeMs;
  if (r.input !== undefined) out.input = inputText(r.input);
  if (r.expected !== undefined) out.expected = text(r.expected);
  if (r.actual !== undefined) out.actual = text(r.actual);
  if (r.stdout) out.stdout = r.stdout;
  if (r.message) out.message = r.message;
  if (r.errorType) out.error_type = r.errorType;
  if (r.line !== undefined) out.line = r.line;
  return out;
}

export function reportView(slug: string, language: Language, view: RunView): ReportView {
  const out: ReportView = {
    slug,
    language,
    passed: view.passed,
    total: view.total,
    all_passed: view.all_passed,
    cases: view.cases.map(caseView),
    duration_ms: view.duration_ms,
  };
  if (view.run_error) out.run_error = { ...view.run_error };
  return out;
}

function recordView(r: RecordResult): RecordView {
  return {
    recorded: { ...r.recorded },
    topic: r.topic,
    level: r.level,
    level_changed: r.level_changed,
    solved_unaided: r.solved_unaided,
  };
}

export function examplesOf(problem: Problem): ExampleView[] {
  return problem.tests
    .filter((t) => t.visibility === 'visible')
    .map((t) => {
      const ex: ExampleView = { id: t.id, input: inputText(t.input), expected: text(t.expected) };
      if (t.explanation) ex.explanation = t.explanation;
      return ex;
    });
}

export class Practice {
  readonly teaching: Teaching;
  readonly guard = new SlugGuard();

  constructor(private readonly deps: PracticeDeps) {
    this.teaching = new Teaching({
      storage: deps.storage,
      catalog: deps.catalog,
      workspace: deps.workspace,
      now: deps.now,
    });
  }

  /** What the tutor's tools need (T10), sharing this guard and teaching state. */
  get toolContext(): TutorToolContext {
    return {
      teaching: this.teaching,
      storage: this.deps.storage,
      workspace: this.deps.workspace,
      guard: this.guard,
      executorFor: this.deps.executorFor,
      timeScale: this.deps.timeScale,
    };
  }

  // ------------------------------------------------------------ catalog

  topics(): TopicView[] {
    const stats = this.teaching.topicStats();
    return this.deps.catalog.topics().map((t) => {
      const s = stats.get(t.id);
      return {
        id: t.id,
        name: t.name,
        group: t.group,
        prerequisites: [...t.prerequisites],
        attempted: s?.attempted ?? 0,
        solved: s?.solved ?? 0,
        solved_unaided: s?.solved_unaided ?? 0,
        last_practised: s?.last_practised ?? null,
        level: s?.level ?? 'new',
      };
    });
  }

  /** Problems in teaching order (topic, then difficulty, then title), with the learner's status. */
  problems(filters: ProblemFilters = {}): ProblemListItem[] {
    const order = new Map(this.deps.catalog.topics().map((t, i) => [t.id, i]));
    const rank = { easy: 0, medium: 1, hard: 2 } as const;
    const items = this.deps.catalog.list().map((p) => ({
      slug: p.slug,
      title: p.title,
      topic: p.topic,
      difficulty: p.difficulty,
      source: p.source,
      languages: [...p.languages],
      status: this.teaching.problemStatus(p.slug) as ProblemStatus,
    }));
    return items
      .filter(
        (i) =>
          (!filters.topic || i.topic === filters.topic) &&
          (!filters.difficulty || i.difficulty === filters.difficulty) &&
          (!filters.source || i.source === filters.source) &&
          (!filters.status || i.status === filters.status),
      )
      .sort(
        (a, b) =>
          (order.get(a.topic) ?? order.size) - (order.get(b.topic) ?? order.size) ||
          rank[a.difficulty] - rank[b.difficulty] ||
          a.title.localeCompare(b.title),
      );
  }

  async problem(slug: string): Promise<ProblemDetail> {
    const p = await this.teaching.problem(slug);
    const m = p.meta;
    return {
      meta: {
        slug: m.slug,
        title: m.title,
        topic: m.topic,
        difficulty: m.difficulty,
        source: m.source,
        languages: [...m.languages],
        expected_complexity: { ...m.expected_complexity },
        time_limit_ms: m.time_limit_ms,
      },
      statement_md: p.statement,
      examples: examplesOf(p),
      origin: m.origin ? { ...m.origin } : null,
      status: this.teaching.problemStatus(slug) as ProblemStatus,
      language: this.languageOf(p),
      attempt_recorded: this.teaching.attemptRecorded(slug),
    };
  }

  async reference(slug: string): Promise<ReferenceResponse> {
    const p = await this.teaching.problem(slug);
    if (!this.teaching.attemptRecorded(slug))
      throw new PracticeRefusal(
        'locked',
        'The reference solution opens once you solve the problem or give up.',
      );
    return { slug, language: 'python', code: p.reference };
  }

  attempts(options: { slug?: string | undefined; last?: number | undefined }): AttemptView[] {
    return this.teaching.attempts(options).attempts.map((a) => ({ ...a }));
  }

  // ------------------------------------------------------------ languages

  /** The languages the problem is offered in, and whether each can run here. */
  async languages(slug: string): Promise<LanguageOption[]> {
    const p = await this.teaching.problem(slug);
    const offered = p.meta.languages.filter((l) => languagesWithHarness().includes(l));
    return Promise.all(
      offered.map(async (language): Promise<LanguageOption> => {
        const s: ExecutorStatus = this.deps.languageStatus
          ? await this.deps.languageStatus(language).catch((e: unknown) => ({
              available: false,
              reason: e instanceof Error ? e.message : String(e),
            }))
          : { available: this.deps.executorFor(language) !== null };
        const out: LanguageOption = { language, available: s.available };
        if (s.reason) out.reason = s.reason;
        const v = Object.entries(s.versions ?? {})[0];
        if (v) out.version = `${v[0]} ${v[1]}`;
        return out;
      }),
    );
  }

  /** Work `slug` in `language`: switches the attempt; returns that language's workspace. */
  async switchLanguage(slug: string, language: Language): Promise<WorkspaceResponse> {
    if (this.guard.isBusy(slug))
      throw new PracticeRefusal(
        'busy',
        'Tests are running for this problem; switch languages when they finish.',
      );
    await this.teaching.switchLanguage(slug, language);
    return this.workspace(slug);
  }

  // ------------------------------------------------------------ workspace

  async workspace(slug: string): Promise<WorkspaceResponse> {
    const p = await this.teaching.problem(slug);
    const language = this.languageOf(p);
    const starter = this.starter(p, language);
    const code = await this.deps.workspace.read(slug, language);
    return {
      slug,
      language,
      exists: code !== null,
      code: code ?? starter,
      starter,
      path: this.deps.workspace.file(slug, language),
    };
  }

  async save(slug: string, code: string): Promise<{ bytes: number }> {
    const p = await this.teaching.problem(slug);
    if (this.guard.isBusy(slug))
      throw new PracticeRefusal(
        'busy',
        'Tests are running for this problem; your code is saved when they finish.',
      );
    return this.deps.workspace.write(slug, this.languageOf(p), code);
  }

  async watch(slug: string, onChange: (code: string) => void): Promise<WatchHandle> {
    const p = await this.teaching.problem(slug);
    return this.deps.workspace.watch(slug, this.languageOf(p), onChange);
  }

  // ------------------------------------------------------------ runs and records

  /** Visible tests; stored as a `run` on the open attempt, if any. */
  async run(slug: string): Promise<ReportView> {
    const { problem, language, code } = await this.solution(slug);
    return this.hold(slug, async () => {
      const view = runView(
        await runProblemTests(this.toolContext, problem, code, language, 'visible'),
      );
      const open = this.deps.storage.read((db) => db.getOpenAttempt(slug));
      if (open)
        await this.deps.storage.write((db) =>
          db.addTestRun({
            attemptId: open.id,
            kind: 'run',
            report: view as unknown as JsonValue,
            createdAt: this.deps.now(),
          }),
        );
      return reportView(slug, language, view);
    });
  }

  /**
   * Every test. When all pass, closes the attempt (opening one first if
   * needed) inside the same storage task as the run, so nothing lands in
   * between; otherwise the attempt stays open and the run is stored on it.
   */
  async submit(slug: string): Promise<SubmitResponse> {
    const { problem, language, code } = await this.solution(slug);
    return this.hold(slug, () =>
      this.deps.storage.serial(async (write) => {
        const view = runView(await runProblemTests(this.toolContext, problem, code, language));
        const report = reportView(slug, language, view);
        if (!view.all_passed) {
          write((db) => {
            const open = db.getOpenAttempt(slug);
            if (open)
              db.addTestRun({
                attemptId: open.id,
                kind: 'submit',
                report: view as unknown as JsonValue,
                createdAt: this.deps.now(),
              });
          });
          return { report, recorded: false };
        }
        const rec = write((db) => {
          const r = this.teaching.recordWith(db, slug, { passed: view.passed, total: view.total });
          db.addTestRun({
            attemptId: r.attempt_id,
            kind: 'submit',
            report: view as unknown as JsonValue,
            createdAt: this.deps.now(),
          });
          return r;
        });
        return { report, recorded: true, record: recordView(rec) };
      }),
    );
  }

  /** Runs every test once more (if code was saved) and records the attempt as gave up. */
  async giveUp(slug: string, notes?: string): Promise<GiveUpResponse> {
    const problem = await this.teaching.problem(slug);
    const language = this.languageOf(problem);
    const code = await this.deps.workspace.read(slug, language);
    return this.hold(slug, () =>
      this.deps.storage.serial(async (write) => {
        const view =
          code === null
            ? null
            : runView(await runProblemTests(this.toolContext, problem, code, language));
        const rec = write((db) => {
          const r = this.teaching.recordWith(db, slug, {
            passed: view?.passed ?? 0,
            total: view?.total ?? problem.tests.length,
            gaveUp: true,
            notes,
          });
          if (view)
            db.addTestRun({
              attemptId: r.attempt_id,
              kind: 'submit',
              report: view as unknown as JsonValue,
              createdAt: this.deps.now(),
            });
          return r;
        });
        return {
          report: view ? reportView(slug, language, view) : null,
          record: recordView(rec),
        };
      }),
    );
  }

  // ------------------------------------------------------------ internals

  private languageOf(problem: Problem): Language {
    const lang = this.teaching.languageFor(problem.meta.slug);
    return problem.meta.languages.includes(lang) ? lang : problem.meta.languages[0]!;
  }

  private starter(problem: Problem, language: Language): string {
    const topic =
      this.deps.catalog.topics().find((t) => t.id === problem.meta.topic)?.name ??
      problem.meta.topic;
    return starterCode(problem.meta, language, topic);
  }

  private async solution(
    slug: string,
  ): Promise<{ problem: Problem; language: Language; code: string }> {
    checkSlug(slug);
    const problem = await this.teaching.problem(slug);
    const language = this.languageOf(problem);
    const code = await this.deps.workspace.read(slug, language);
    if (code === null)
      throw new PracticeRefusal(
        'no_solution',
        `No solution is saved yet (${workspacePath(slug, language)}). Start the problem or type some code first.`,
      );
    return { problem, language, code };
  }

  private async hold<T>(slug: string, task: () => Promise<T>): Promise<T> {
    try {
      return await this.guard.hold(slug, task);
    } catch (e) {
      if (e instanceof SlugBusyError)
        throw new PracticeRefusal('busy', 'Tests are already running for this problem.');
      if (e instanceof TutorError && e.code === 'runtime_missing')
        throw new PracticeRefusal('runtime_missing', e.message);
      throw e;
    }
  }
}
