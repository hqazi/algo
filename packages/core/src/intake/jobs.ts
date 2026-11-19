/**
 * Intake jobs (SPEC §5.3, §6.3): generate, paste or import a problem
 * through one authoring conversation. Ported from
 * `dsa-tutor/dsa_tutor/intake/jobs.py`.
 *
 * A job runs authoring turns on the configured tutor backend with a registry
 * holding a single tool, an intake-only `create_problem`:
 *
 * - the app, not the model, decides where the problem came from: `source`,
 *   `origin` and `origin_text` in the model's spec are dropped; a paste gets
 *   `origin { kind: "paste" }` and the pasted text as `origin.md`; an import
 *   gets the open set's complete origin and a `NOTICE.md` with its licence;
 * - the topic and difficulty the learner asked for are enforced;
 * - every call counts: the first plus `MAX_REPAIRS` repairs, then the job
 *   fails with the last error; a call after the problem exists is refused.
 *
 * A turn that ends without a problem gets a repair turn with the last error
 * (counting against the same budget), so backends that stop early still get
 * their repairs. The job ends as soon as `create_problem` succeeds.
 *
 * Progress goes to the job's event log, which any number of readers replay
 * from the start (`subscribe`):
 *
 *   { type: "progress", stage, message, attempt?, max_attempts?, detail? }
 *   { type: "done", slug, title }
 *   { type: "error", code, message, detail? }
 *
 * Events never carry the spec, the pasted text or test data: a failing
 * self-check is reported by test id, category and status only (the problem's
 * hidden tests are those tests). Logs never include request text.
 */
import { DIFFICULTIES, type Difficulty } from '../problems/schema';
import type { Topic } from '../teaching/topics';
import type { SlugGuard } from '../tools/guard';
import { SlugBusyError } from '../tools/guard';
import { ToolRegistry, type Tool, type ToolOutput } from '../tools/registry';
import type {
  BackendStatus,
  NeutralMessage,
  SignalLike,
  Turn,
  TutorBackend,
} from '../tutor/backend';
import type { JsonValue } from '../types/json';
import { stringifyJson } from '../types/json';
import type { CreateOptions } from './create';
import {
  entryOf,
  noticeOf,
  OpenSetError,
  originOf,
  type OpenSetProblem,
  type OpenSets,
} from './open-sets';
import {
  buildAuthorPrompt,
  generateMessage,
  importMessage,
  NOT_A_PROBLEM,
  pasteMessage,
  repairMessage,
} from './prompt';

export const MAX_REPAIRS = 3;
export const MAX_ATTEMPTS = 1 + MAX_REPAIRS;
export const JOB_TIMEOUT_MS = 15 * 60_000;
export const MAX_JOBS_KEPT = 20;
export const MAX_PASTE_CHARS = 50_000;
export const MIN_PASTE_CHARS = 20;
export const MAX_IDEA_CHARS = 2_000;
/** The last error as the repair turn quotes it. */
export const MAX_LAST_CHARS = 6_000;
export const INTAKE_KINDS = ['generate', 'paste', 'import'] as const;
export const INTAKE_STAGES = ['started', 'fetching', 'writing', 'checking', 'repair'] as const;
export const INTAKE_ERROR_CODES = [
  'self_check',
  'not_a_problem',
  'fetch',
  'auth',
  'rate_limit',
  'refusal',
  'network',
  'backend',
  'timeout',
  'cancelled',
] as const;

export type IntakeKind = (typeof INTAKE_KINDS)[number];
export type IntakeStage = (typeof INTAKE_STAGES)[number];
export type IntakeErrorCode = (typeof INTAKE_ERROR_CODES)[number];

export type IntakeRequest =
  | { kind: 'generate'; topic: string; difficulty: Difficulty; idea?: string }
  | { kind: 'paste'; text: string; topic?: string; difficulty?: Difficulty }
  | { kind: 'import'; set: string; entry: string; topic?: string; difficulty?: Difficulty };

export interface FailureItem {
  id?: string;
  category?: string;
  status?: string;
  error_type?: string;
  message?: string;
}

/** What the UI may see of a failed `create_problem`. */
export interface FailureDetail {
  error: string;
  problems?: string[];
  failures?: FailureItem[];
  more_failures?: number;
}

export type IntakeEvent =
  | {
      type: 'progress';
      stage: IntakeStage;
      message: string;
      attempt?: number;
      max_attempts?: number;
      detail?: FailureDetail;
    }
  | { type: 'done'; slug: string; title: string }
  | { type: 'error'; code: IntakeErrorCode; message: string; detail?: FailureDetail };

/** A request the service refuses before a job starts. */
export class IntakeError extends Error {
  constructor(
    readonly code: 'invalid' | 'busy' | 'unavailable' | 'unknown_set' | 'unknown_entry',
    message: string,
  ) {
    super(message);
    this.name = 'IntakeError';
  }
}

/** Checks a request; returns it trimmed. Throws `IntakeError('invalid')`. */
export function checkRequest(request: IntakeRequest, topics: ReadonlySet<string>): IntakeRequest {
  const bad = (m: string): never => {
    throw new IntakeError('invalid', m);
  };
  if (!(INTAKE_KINDS as readonly string[]).includes(request.kind))
    bad(`kind must be one of ${INTAKE_KINDS.join(', ')}`);
  if (request.topic !== undefined && !topics.has(request.topic))
    bad(`unknown topic "${request.topic}"`);
  if (
    request.difficulty !== undefined &&
    !(DIFFICULTIES as readonly string[]).includes(request.difficulty)
  )
    bad(`difficulty must be one of ${DIFFICULTIES.join(', ')}`);
  if (request.kind === 'generate') {
    if (!request.topic || !request.difficulty) bad('generate needs a topic and a difficulty');
    const idea = request.idea?.trim();
    if (idea && idea.length > MAX_IDEA_CHARS)
      bad(`the idea is longer than ${MAX_IDEA_CHARS} characters`);
    const out: IntakeRequest = {
      kind: 'generate',
      topic: request.topic,
      difficulty: request.difficulty,
    };
    if (idea) out.idea = idea;
    return out;
  }
  if (request.kind === 'paste') {
    const text = (request.text ?? '').trim();
    if (text.length < MIN_PASTE_CHARS) bad('paste the problem statement (at least a sentence)');
    if (text.length > MAX_PASTE_CHARS)
      bad(`the pasted text is longer than ${MAX_PASTE_CHARS} characters`);
    return { ...request, text };
  }
  if (!request.set || !request.entry) bad('import needs a set and an entry');
  return request;
}

const clip = (s: unknown, n: number): string => String(s ?? '').slice(0, n);

/**
 * What the UI may see of a failed `create_problem`: the error, spec problems,
 * and per failing test only id, category and status (plus the error type,
 * and, when `withMessages`, the message of a visible test).
 */
export function publicFailure(
  output: ToolOutput | null | undefined,
  withMessages = false,
): FailureDetail | undefined {
  if (!output) return undefined;
  const out: FailureDetail = { error: clip(output.error ?? 'create_problem failed', 500) };
  if (Array.isArray(output.problems))
    out.problems = output.problems.slice(0, 20).map((p) => clip(p, 300));
  if (Array.isArray(output.failures)) {
    const items: FailureItem[] = [];
    for (const f of output.failures.slice(0, 20) as unknown[]) {
      if (typeof f !== 'object' || f === null) continue;
      const r = f as Record<string, unknown>;
      const item: FailureItem = {};
      if (typeof r.id === 'string') item.id = r.id;
      if (typeof r.category === 'string') item.category = r.category;
      if (typeof r.status === 'string') item.status = r.status;
      if (typeof r.error_type === 'string') item.error_type = clip(r.error_type, 80);
      // A message can quote a test's input: only visible tests' messages are shown.
      if (withMessages && r.visibility === 'visible' && typeof r.message === 'string')
        item.message = clip(r.message, 200);
      items.push(item);
    }
    out.failures = items;
    const more = output.failures.length - 20 + (Number(output.more_failures) || 0);
    if (more > 0) out.more_failures = more;
  }
  return out;
}

function forModel(output: ToolOutput): unknown {
  const text = stringifyJson(output);
  if (text.length <= MAX_LAST_CHARS) return output;
  return {
    error: output.error,
    problems: output.problems,
    failures_excerpt: `${text.slice(0, MAX_LAST_CHARS)}...(truncated)`,
  };
}

// ---------------------------------------------------------------- cancellation

/** A `SignalLike` core can create (core has no `AbortController`). */
export class Canceller implements SignalLike {
  aborted = false;
  private listeners = new Set<() => void>();

  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    for (const l of [...this.listeners]) l();
    this.listeners.clear();
  }

  addEventListener(_type: 'abort', listener: () => void): void {
    if (this.aborted) listener();
    else this.listeners.add(listener);
  }

  removeEventListener(_type: 'abort', listener: () => void): void {
    this.listeners.delete(listener);
  }
}

// ---------------------------------------------------------------- the restricted tool

/** Validates, self-checks and saves a spec (`createProblem` over the app's deps). */
export type CreateFn = (
  spec: Record<string, unknown>,
  options: CreateOptions,
) => Promise<ToolOutput>;

/** The intake-only `create_problem` for one job, and what it saw. */
class Authoring {
  attempts = 0;
  slug: string | null = null;
  title: string | null = null;
  /** The last failing output, as the tool returned it. */
  last: ToolOutput | null = null;
  /** Import: the fetched entry, set before the first turn. */
  imported: OpenSetProblem | null = null;
  readonly registry: ToolRegistry<null>;

  constructor(
    private readonly request: IntakeRequest,
    base: Tool<never>,
    private readonly create: CreateFn,
    private readonly guard: SlugGuard | undefined,
    log: (m: string, e: unknown) => void,
  ) {
    const schema = jsonCopy(base.inputSchema);
    delete (schema.properties as Record<string, unknown>).origin;
    const tool: Tool<null> = {
      name: base.name,
      title: base.title,
      startSummary: base.startSummary,
      description: `${base.description.split(' On success returns')[0]} On success returns the slug and test counts; then stop.`,
      inputSchema: schema,
      handler: (_ctx, args) => this.handle(args),
      mutates: true,
    };
    if (base.summarize) tool.summarize = base.summarize;
    this.registry = new ToolRegistry<null>(null, [tool], log);
  }

  private async handle(args: Record<string, unknown>): Promise<ToolOutput> {
    if (this.slug !== null)
      return { ok: false, error: `the problem "${this.slug}" was already created; stop now` };
    if (this.attempts >= MAX_ATTEMPTS)
      return { ok: false, error: 'no create_problem calls left for this job; stop now' };
    this.attempts += 1;
    const spec = { ...(args.spec as Record<string, unknown>) };
    for (const key of ['source', 'origin', 'origin_text']) delete spec[key];
    const req = this.request;
    const wrong: string[] = [];
    if (req.topic && spec.topic !== req.topic)
      wrong.push(`topic must be "${req.topic}" for this job`);
    if (req.difficulty && spec.difficulty !== req.difficulty)
      wrong.push(`difficulty must be "${req.difficulty}" for this job`);
    let out: ToolOutput;
    if (wrong.length) {
      out = { ok: false, error: 'invalid spec', problems: wrong };
    } else {
      const options: CreateOptions = {};
      if (req.kind === 'paste') {
        options.origin = { kind: 'paste' };
        options.originText = req.text;
      } else if (req.kind === 'import' && this.imported) {
        options.origin = originOf(this.imported);
        options.notice = noticeOf(this.imported);
      }
      out = await this.guarded(spec, options);
    }
    if (out.ok) {
      this.slug = String(out.slug);
      this.title = typeof out.title === 'string' ? out.title : String(spec.title ?? out.slug);
    } else {
      this.last = out;
    }
    return out;
  }

  private async guarded(
    spec: Record<string, unknown>,
    options: CreateOptions,
  ): Promise<ToolOutput> {
    const slug = spec.slug;
    if (!this.guard || typeof slug !== 'string') return this.create(spec, options);
    try {
      return await this.guard.hold(`create:${slug}`, () => this.create(spec, options));
    } catch (e) {
      if (e instanceof SlugBusyError)
        return {
          ok: false,
          code: 'busy',
          error: `a problem with slug "${slug}" is being created already`,
        };
      throw e;
    }
  }
}

function jsonCopy<T>(v: T): T & { properties?: unknown } {
  return JSON.parse(JSON.stringify(v)) as T & { properties?: unknown };
}

// ---------------------------------------------------------------- jobs

export class IntakeJob {
  readonly events: IntakeEvent[] = [];
  finished = false;
  slug: string | null = null;
  readonly signal = new Canceller();
  /** Why the signal was aborted. */
  stopReason: 'cancelled' | 'timeout' | null = null;
  private listeners = new Set<(e: IntakeEvent) => void>();

  constructor(
    readonly id: string,
    readonly kind: IntakeKind,
    readonly created: number,
  ) {}

  emit(event: IntakeEvent): void {
    if (this.finished) return;
    this.events.push(event);
    if (event.type === 'done' || event.type === 'error') this.finished = true;
    for (const l of [...this.listeners]) l(event);
    if (this.finished) this.listeners.clear();
  }

  progress(stage: IntakeStage, message: string, attempt?: number): void {
    const event: IntakeEvent = { type: 'progress', stage, message };
    if (attempt !== undefined) {
      event.attempt = attempt;
      event.max_attempts = MAX_ATTEMPTS;
    }
    this.emit(event);
  }

  fail(code: IntakeErrorCode, message: string, detail?: FailureDetail): void {
    const event: IntakeEvent = { type: 'error', code, message };
    if (detail) event.detail = detail;
    this.emit(event);
  }

  /** Replays every event from `from`, then calls `listener` for new ones until the job ends. */
  subscribe(listener: (e: IntakeEvent) => void, from = 0): () => void {
    for (const e of this.events.slice(from)) listener(e);
    if (this.finished) return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Resolves with the last event (`done` or `error`). */
  outcome(): Promise<IntakeEvent> {
    const last = this.events.at(-1);
    if (this.finished && last) return Promise.resolve(last);
    return new Promise((resolve) => {
      this.listeners.add((e) => {
        if (e.type !== 'progress') resolve(e);
      });
    });
  }

  stop(reason: 'cancelled' | 'timeout'): void {
    if (this.finished || this.signal.aborted) return;
    this.stopReason = reason;
    this.signal.abort();
  }
}

export interface IntakeDeps {
  backend: () => TutorBackend;
  /** The full tutor registry; only its `create_problem` definition is used. */
  tools: { get(name: string): Tool<never> | undefined };
  create: CreateFn;
  topics: () => readonly Topic[];
  /** Every slug in use (curated, generated, pasted, imported). */
  slugs: () => readonly string[];
  openSets: OpenSets;
  /** `content/references/*.md` by name (`problem_spec` and `topics`). */
  guides: Record<string, string>;
  guard?: SlugGuard;
  newId: () => string;
  /** Calls `fn` after `ms`; returns a function that cancels it. */
  schedule: (ms: number, fn: () => void) => () => void;
  /** Milliseconds, for ordering kept jobs. */
  clock?: () => number;
  timeoutMs?: number;
  /** Never given request text. */
  log?: (message: string, error?: unknown) => void;
}

const START_MESSAGES: Record<IntakeKind, string> = {
  generate: 'Asking the tutor to write the problem',
  paste: 'Asking the tutor to convert the pasted problem',
  import: 'Importing the problem from the open set',
};

const ERROR_FOR_KIND: Record<string, IntakeErrorCode> = {
  auth: 'auth',
  rate_limit: 'rate_limit',
  refusal: 'refusal',
  network: 'network',
  cancelled: 'cancelled',
};

/** Starts and keeps intake jobs. One job runs at a time; finished ones are kept for their readers. */
export class IntakeService {
  readonly systemPrompt: string;
  private readonly jobs = new Map<string, IntakeJob>();
  private seq = 0;

  constructor(private readonly deps: IntakeDeps) {
    this.systemPrompt = buildAuthorPrompt(deps.guides, MAX_ATTEMPTS);
  }

  get(id: string): IntakeJob | undefined {
    return this.jobs.get(id);
  }

  running(): IntakeJob | undefined {
    return [...this.jobs.values()].find((j) => !j.finished);
  }

  /** Stops a running job (it ends with `cancelled`). */
  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.finished) return false;
    job.stop('cancelled');
    return true;
  }

  private log(message: string, error?: unknown): void {
    this.deps.log?.(message, error);
  }

  async start(raw: IntakeRequest): Promise<IntakeJob> {
    const topics = this.deps.topics();
    let request = checkRequest(raw, new Set(topics.map((t) => t.id)));
    if (request.kind === 'import') {
      // The entry must exist; its suggested topic and difficulty are defaults.
      let entry;
      try {
        entry = entryOf(this.deps.openSets.get(request.set), request.entry);
      } catch (e) {
        if (e instanceof OpenSetError && e.code !== 'fetch')
          throw new IntakeError(e.code, e.message);
        throw e;
      }
      request = {
        ...request,
        topic: request.topic ?? entry.topic,
        difficulty: request.difficulty ?? entry.difficulty,
      };
    }
    if (!this.deps.tools.get('create_problem'))
      throw new IntakeError('unavailable', 'problems cannot be created here');
    const backend = this.deps.backend();
    let status: BackendStatus;
    try {
      status = await backend.status();
    } catch {
      status = { available: false, reason: 'The tutor could not report its status.', model: null };
    }
    if (!status.available)
      throw new IntakeError('unavailable', status.reason ?? 'The tutor is not available.');
    if (this.running())
      throw new IntakeError(
        'busy',
        'A new problem is already being written; wait for it to finish.',
      );
    const job = new IntakeJob(this.deps.newId(), request.kind, this.deps.clock?.() ?? ++this.seq);
    this.jobs.set(job.id, job);
    const finished = [...this.jobs.values()]
      .filter((j) => j.finished)
      .sort((a, b) => a.created - b.created);
    for (const old of finished.slice(0, Math.max(0, this.jobs.size - MAX_JOBS_KEPT)))
      this.jobs.delete(old.id);
    void this.run(job, backend, request);
    return job;
  }

  private async run(job: IntakeJob, backend: TutorBackend, request: IntakeRequest): Promise<void> {
    this.log(`intake job ${job.id} (${request.kind}) started on ${backend.id}`);
    job.progress('started', START_MESSAGES[request.kind]);
    const clear = this.deps.schedule(this.deps.timeoutMs ?? JOB_TIMEOUT_MS, () =>
      job.stop('timeout'),
    );
    try {
      await this.author(job, backend, request);
    } catch (e) {
      if (!job.signal.aborted) {
        this.log(`intake job ${job.id} failed`, e);
        job.fail('backend', 'Writing the problem failed unexpectedly. Try again.');
      }
    } finally {
      clear();
      if (!job.finished) {
        if (job.stopReason === 'timeout')
          job.fail('timeout', 'Writing the problem took too long and was stopped. Try again.');
        else if (job.stopReason === 'cancelled') job.fail('cancelled', 'Stopped.');
        else job.fail('backend', 'The tutor stopped without writing the problem.');
      }
      const last = job.events.at(-1);
      this.log(
        `intake job ${job.id} ended: ${last?.type === 'error' ? last.code : (last?.type ?? '?')}`,
      );
    }
  }

  private async author(
    job: IntakeJob,
    backend: TutorBackend,
    request: IntakeRequest,
  ): Promise<void> {
    const authoring = new Authoring(
      request,
      this.deps.tools.get('create_problem')!,
      this.deps.create,
      this.deps.guard,
      (m, e) => this.log(m, e),
    );
    const topics = this.deps.topics();
    const taken = this.deps.slugs();
    let text: string;
    if (request.kind === 'generate') {
      text = generateMessage(topics, request.topic, request.difficulty, request.idea, taken);
    } else if (request.kind === 'import') {
      const importer = this.deps.openSets.get(request.set);
      job.progress('fetching', `Fetching the problem from ${importer.name}`);
      try {
        authoring.imported = await importer.fetch(request.entry);
      } catch (e) {
        if (e instanceof OpenSetError) {
          job.fail('fetch', e.message);
          return;
        }
        throw e;
      }
      if (job.signal.aborted) return;
      text = importMessage(topics, authoring.imported, request.topic!, request.difficulty!, taken);
    } else {
      text = pasteMessage(topics, request.text, request.topic, request.difficulty, taken);
    }

    const history: NeutralMessage[] = [];
    const state: Record<string, JsonValue> = {};
    for (let turnNo = 1; turnNo <= MAX_ATTEMPTS; turnNo++) {
      if (job.signal.aborted) return;
      if (turnNo > 1)
        text = repairMessage(
          authoring.attempts + 1,
          MAX_ATTEMPTS,
          authoring.last ? forModel(authoring.last) : null,
        );
      job.progress(
        'writing',
        turnNo === 1 ? 'The tutor is writing the problem' : 'The tutor is fixing the problem',
      );
      const turn: Turn = {
        threadId: `intake-${job.id}`,
        systemPrompt: this.systemPrompt,
        history: [...history],
        userText: text,
        context: {},
        tools: authoring.registry,
        backendState: state,
      };
      const { reply, error } = await this.turn(job, backend, turn, authoring);
      history.push({ role: 'user', text }, { role: 'assistant', text: reply });
      if (authoring.slug) {
        job.slug = authoring.slug;
        job.emit({ type: 'done', slug: authoring.slug, title: authoring.title ?? authoring.slug });
        return;
      }
      if (job.signal.aborted) return;
      if (error) {
        job.fail(ERROR_FOR_KIND[error.kind] ?? 'backend', error.message || 'The tutor failed.');
        return;
      }
      const at = reply.indexOf(NOT_A_PROBLEM);
      if (at >= 0) {
        const reason = reply
          .slice(at + NOT_A_PROBLEM.length)
          .trim()
          .split('\n')[0]
          ?.trim();
        job.fail(
          'not_a_problem',
          `${request.kind === 'import' ? 'The exercise' : 'The pasted text'} could not be turned into a problem` +
            (reason ? `: ${reason.slice(0, 300)}` : '.'),
        );
        return;
      }
      if (authoring.attempts >= MAX_ATTEMPTS) break;
    }
    const last = authoring.last;
    job.fail(
      'self_check',
      `The problem did not pass the self-check after ${MAX_REPAIRS} repairs` +
        (last ? '.' : ' (no problem was written).'),
      publicFailure(last, true),
    );
  }

  /** One turn: its reply text and error, stopping early once the problem exists. */
  private async turn(
    job: IntakeJob,
    backend: TutorBackend,
    turn: Turn,
    authoring: Authoring,
  ): Promise<{ reply: string; error: { kind: string; message: string } | null }> {
    let reply = '';
    let error: { kind: string; message: string } | null = null;
    // This turn's create_problem calls: id -> attempts before it.
    const ours = new Map<string, number>();
    for await (const event of backend.runTurn(turn, job.signal)) {
      if (event.type === 'text_delta') reply += event.text;
      else if (event.type === 'tool_start' && event.name === 'create_problem') {
        ours.set(event.id, authoring.attempts);
        job.progress('checking', 'Running the self-check', authoring.attempts + 1);
      } else if (event.type === 'tool_end' && ours.has(event.id)) {
        if (authoring.slug) break;
        if (!event.ok) {
          const ranIt = authoring.attempts > ours.get(event.id)!; // else its input was rejected
          const detail = (ranIt ? publicFailure(authoring.last) : undefined) ?? {
            error: clip(event.summary || 'create_problem failed', 500),
          };
          const what =
            ranIt && detail.error.includes('self-check')
              ? 'The self-check failed'
              : 'The problem was rejected';
          const more =
            authoring.attempts < MAX_ATTEMPTS ? 'the tutor is fixing it' : 'no repairs left';
          job.emit({
            type: 'progress',
            stage: 'repair',
            attempt: authoring.attempts,
            max_attempts: MAX_ATTEMPTS,
            message: `${what}; ${more}`,
            detail,
          });
          if (authoring.attempts >= MAX_ATTEMPTS) break;
        }
      } else if (event.type === 'error') {
        error = event;
        break;
      } else if (event.type === 'done') break;
    }
    return { reply, error };
  }
}
