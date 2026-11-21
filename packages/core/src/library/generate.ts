/**
 * Articles the tutor writes (SPEC §15.1, T25, T43): the request (a brief,
 * level, length and, for a series, how many parts), the writer's prompt and
 * its tools (`plan_series` for a series, then `save_article`), the cleaning
 * of what the model wrote, and the file it becomes. Main decides where the
 * file goes (the folder the user chose) and its name.
 *
 * A generated article holds no images: image syntax is turned into its alt
 * text before saving, so the model can never cause a download (§15.4).
 */
import { TutorError } from '../teaching/errors';
import type { SignalLike, Turn, TutorBackend } from '../tutor/backend';
import { ToolRegistry, type Tool } from '../tools/registry';
import type { JsonValue } from '../types/json';
import { normalizeSpace } from './anchors';
import { noteFileName } from './files';

/** The index's folder id for generated articles (settings folder ids are UUIDs). */
export const GENERATED_FOLDER_ID = 'generated';
export const GENERATED_GROUP_NAME = 'Written by the tutor';

export const ARTICLE_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export const ARTICLE_LENGTHS = ['short', 'medium', 'long'] as const;
export type ArticleLevel = (typeof ARTICLE_LEVELS)[number];
export type ArticleLength = (typeof ARTICLE_LENGTHS)[number];
/** About how many words each length asks for. */
export const LENGTH_WORDS: Record<ArticleLength, number> = { short: 600, medium: 1200, long: 2500 };

/** The user's brief: what the article (or series) should cover. */
export const MAX_BRIEF_CHARS = 4000;
export const MIN_SERIES_PARTS = 2;
export const MAX_SERIES_PARTS = 12;
export const MAX_ARTICLE_CHARS = 60_000;
export const MAX_TAGS = 8;
/** Turns per article: the first and one reminder to call `save_article`. */
export const MAX_WRITER_TURNS = 2;
/** `save_article` calls per article. */
export const MAX_SAVE_CALLS = 3;

export interface ArticleRequest {
  brief: string;
  level: ArticleLevel;
  length: ArticleLength;
  /** 1: one article; 2–12: a series of that many parts. */
  parts: number;
}

export type GenerateErrorCode =
  'invalid' | 'unavailable' | 'busy' | 'not_written' | 'cancelled' | 'backend';

export class GenerateError extends Error {
  constructor(
    readonly code: GenerateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GenerateError';
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function checkArticleRequest(raw: unknown): ArticleRequest {
  if (!isObj(raw)) throw new GenerateError('invalid', 'Say what the article should cover.');
  // Line breaks are kept (a brief can be a list); other runs of space are not.
  const brief =
    typeof raw.brief === 'string'
      ? raw.brief
          .replace(/\r\n?/g, '\n')
          .split('\n')
          .map((l) => normalizeSpace(l))
          .join('\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
      : '';
  if (!brief) throw new GenerateError('invalid', 'Say what the article should cover.');
  if (brief.length > MAX_BRIEF_CHARS)
    throw new GenerateError('invalid', `The brief is longer than ${MAX_BRIEF_CHARS} characters.`);
  const level = raw.level ?? 'intermediate';
  const length = raw.length ?? 'medium';
  const parts = raw.parts ?? 1;
  if (!ARTICLE_LEVELS.includes(level as ArticleLevel))
    throw new GenerateError('invalid', 'Unknown level.');
  if (!ARTICLE_LENGTHS.includes(length as ArticleLength))
    throw new GenerateError('invalid', 'Unknown length.');
  if (
    typeof parts !== 'number' ||
    !Number.isInteger(parts) ||
    parts < 1 ||
    parts > MAX_SERIES_PARTS
  )
    throw new GenerateError(
      'invalid',
      `A series has ${MIN_SERIES_PARTS} to ${MAX_SERIES_PARTS} parts.`,
    );
  return { brief, level: level as ArticleLevel, length: length as ArticleLength, parts };
}

/** Lower-case tags of letters, digits, `-` and `/`; at most `MAX_TAGS`, no repeats. */
export function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  for (const t of tags) {
    if (typeof t !== 'string') continue;
    const tag = t
      .trim()
      .replace(/^#/, '')
      .toLowerCase()
      .replace(/[^a-z0-9/-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/**
 * What the model wrote, made safe to save: no frontmatter of its own, no
 * leading `# Title` repeating the title, and no images (Markdown, reference
 * style or Obsidian embeds of image files become their alt text or go).
 */
export function cleanArticleBody(body: string, title: string): string {
  let text = body.replace(/\r\n?/g, '\n').trim();
  // Frontmatter is the app's to write.
  const fm = /^---\n[\s\S]*?\n---(?:\n|$)/.exec(text);
  if (fm) text = text.slice(fm[0].length).trimStart();
  const h1 = /^#\s+(.+)\n?/.exec(text);
  if (h1 && normalizeSpace(h1[1]!).toLowerCase() === normalizeSpace(title).toLowerCase())
    text = text.slice(h1[0].length).trimStart();
  text = text
    // Obsidian embeds: `![[x.png]]` goes; a note embed becomes a link.
    .replace(/!\[\[([^[\]\n]+)\]\]/g, (_m, inner: string) =>
      /\.(?:png|jpe?g|gif|webp|svg|bmp|avif)(?:[|#].*)?$/i.test(inner.trim()) ? '' : `[[${inner}]]`,
    )
    // `![alt](url)`, `![alt][ref]`, `![alt][]` and `![ref]` → alt text.
    .replace(/!\[((?:[^\]\\\n]|\\.)*)\](?:\([^)\n]*\)|\[[^\]\n]*\])?/g, '$1');
  if (text.length > MAX_ARTICLE_CHARS) text = text.slice(0, MAX_ARTICLE_CHARS);
  return `${text.trim()}\n`;
}

/** A YAML double-quoted scalar (JSON strings are valid YAML). */
const yamlString = (s: string): string => JSON.stringify(s);

export interface GeneratedMeta {
  title: string;
  /** ISO date and time. */
  created: string;
  tags: string[];
  /** T43: the series this is a part of, and which part. */
  series?: { title: string; part: number; of: number };
}

/**
 * The file: frontmatter (`title`, `created`, `tags`, for a series `series`,
 * `part` and `parts`, then `generated: true`), then the body.
 */
export function renderGeneratedArticle(meta: GeneratedMeta, body: string): string {
  const tags = meta.tags.length
    ? `\n${meta.tags.map((t) => `  - ${yamlString(t)}`).join('\n')}`
    : ' []';
  const series = meta.series
    ? `series: ${yamlString(meta.series.title)}\npart: ${meta.series.part}\nparts: ${meta.series.of}\n`
    : '';
  return (
    `---\ntitle: ${yamlString(meta.title)}\ncreated: ${yamlString(meta.created)}\n` +
    `tags:${tags}\n${series}generated: true\n---\n\n${body}`
  );
}

/** One planned part of a series. */
export interface SeriesPart {
  title: string;
  summary: string;
  /** Its file name without `.md` (the wikilink target): `01 Title`. */
  file: string;
}

export interface SeriesPlan {
  title: string;
  parts: SeriesPart[];
}

/** Characters a wikilink target or label cannot hold. */
const linkSafe = (s: string): string => normalizeSpace(s.replace(/[[\]|#^]+/g, ' '));

/** The line under a part linking the previous and next parts (Obsidian wikilinks). */
export function seriesFooter(plan: SeriesPlan, index: number): string {
  const link = (p: SeriesPart) => `[[${p.file}|${linkSafe(p.title)}]]`;
  const prev = plan.parts[index - 1];
  const next = plan.parts[index + 1];
  const nav = [
    prev ? `← Previous: ${link(prev)}` : null,
    next ? `Next: ${link(next)} →` : null,
  ].filter(Boolean);
  return (
    `\n---\n\n*Part ${index + 1} of ${plan.parts.length} of the series ` +
    `“${linkSafe(plan.title)}”.*${nav.length ? `\n\n${nav.join(' · ')}` : ''}\n`
  );
}

// ---------------------------------------------------------------- the writer

export const WRITER_PROMPT = `\
You are the tutor inside Algo, a desktop app for practising data structures and algorithms. \
The user asked you to write for their library. What you write is saved on their computer, in the folder \
they chose, and labelled as AI-written.

Your tools save your work; nobody reads your chat text. Call \`save_article\` once with the whole article \
(and, when asked to plan a series, \`plan_series\` once with the plan). The job ends when it is saved.

- Follow the user's brief: cover what it asks for, in the order it suggests, and leave out what it rules \
out. The brief is the user's own request.
- The body is Markdown: \`##\` and \`###\` headings for sections (no \`#\` title: the app shows the title), \
paragraphs, lists, tables and fenced code blocks (Python unless the topic needs another language).
- Teach: start from the idea, build up with small examples and a worked trace, give the complexity with \
the reason where there is one, and end with common pitfalls and a short summary.
- Pitch it at the level asked and keep near the length asked.
- No images, no raw HTML and no links to images: the app does not show them. Links to well-known \
references are fine but not needed.
- Be accurate. If the topic is not about computing, programming, data structures or algorithms, still \
write an accurate article on it.`;

const level = (req: ArticleRequest) =>
  `Level: ${req.level}\nLength: ${req.length} (about ${LENGTH_WORDS[req.length]} words)`;

export function writerMessage(req: ArticleRequest): string {
  return `Write an article.\n${level(req)}\n\nThe brief:\n${req.brief}\n\nCall save_article with it.`;
}

export function plannerMessage(req: ArticleRequest): string {
  return (
    `Plan a series of ${req.parts} articles that together teach what the brief asks, in order: each part ` +
    'builds on the ones before it and can be read on its own.\n' +
    `Each part: ${level(req)}\n\nThe brief:\n${req.brief}\n\n` +
    `Call plan_series with the series title and exactly ${req.parts} parts (a title and a ` +
    'two- or three-sentence summary of what it covers). Do not write the articles yet.'
  );
}

export function partMessage(req: ArticleRequest, plan: SeriesPlan, index: number): string {
  const part = plan.parts[index]!;
  const outline = plan.parts
    .map((p, i) => `${i + 1}. ${p.title}: ${p.summary}${i === index ? '  <- this part' : ''}`)
    .join('\n');
  return (
    `Write part ${index + 1} of ${plan.parts.length} of the series “${plan.title}”.\n` +
    `Its title: ${part.title}\nWhat it covers: ${part.summary}\n${level(req)}\n\n` +
    `The whole series:\n${outline}\n\nThe brief for the series:\n${req.brief}\n\n` +
    'Cover only this part: assume the earlier parts were read (recall what is needed in a sentence) ' +
    'and leave later parts’ topics to them. The app adds links to the previous and next parts. ' +
    'Call save_article with it.'
  );
}

export const WRITER_REMINDER =
  'The article is not saved yet. Call save_article now with the title, tags and the whole body.';
export const PLANNER_REMINDER =
  'The series is not planned yet. Call plan_series now with the title and the parts.';

/** What `save_article` hands main: the whole file, and its title for the file name. */
export interface ArticleToSave {
  title: string;
  tags: string[];
  markdown: string;
  /** A series part: the file name (without `.md`) the plan gave it. */
  file?: string;
}

/** Where the writer saves: main writes the file and indexes it, resolving to the article id. */
export interface ArticleSink {
  save(article: ArticleToSave): Promise<string>;
}

export interface ArticleWriterDeps {
  backend: () => TutorBackend;
  now: () => string;
  newId: () => string;
  log?: (message: string, error?: unknown) => void;
}

export interface WrittenArticle {
  id: string;
  title: string;
}

/** Progress of a write, for the dialog. */
export type WriteProgress =
  | { kind: 'planning' }
  | { kind: 'planned'; title: string; parts: string[] }
  | { kind: 'writing'; part: number; of: number; title: string | null }
  | { kind: 'saved'; part: number; of: number; id: string; title: string };

interface WriterState {
  calls: number;
  saved: WrittenArticle | null;
}

function saveArticleTool(
  deps: ArticleWriterDeps,
  sink: ArticleSink,
  series: { plan: SeriesPlan; index: number } | null,
): Tool<WriterState> {
  return {
    name: 'save_article',
    title: 'Save article',
    startSummary: 'Saving the article',
    description:
      'Save the finished article to the user’s library. title: the article’s title; tags: up to ' +
      `${MAX_TAGS} short topic tags; body: the whole article in Markdown (no title heading, no images, ` +
      `at most ${MAX_ARTICLE_CHARS} characters). Call once, with the complete article.`,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 120 },
        tags: { type: 'array', items: { type: 'string', maxLength: 40 }, maxItems: 20 },
        body: { type: 'string', minLength: 1, maxLength: MAX_ARTICLE_CHARS + 10_000 },
      },
      required: ['title', 'body'],
      additionalProperties: false,
    },
    mutates: false,
    handler: async (state, args) => {
      if (state.saved) return { ok: false, error: 'the article is saved already; stop now' };
      if (state.calls >= MAX_SAVE_CALLS)
        return { ok: false, error: 'no save_article calls left; stop now' };
      state.calls += 1;
      // A series part keeps the plan's title, so the links between parts hold.
      const part = series?.plan.parts[series.index];
      const title = part?.title ?? normalizeSpace(String(args.title)).slice(0, 120);
      if (!title) throw new TutorError('title is empty', 'invalid_input');
      let body = cleanArticleBody(String(args.body), title);
      if (normalizeSpace(body).length < 200)
        return { ok: false, error: 'the body is too short; write the whole article' };
      if (series) body += seriesFooter(series.plan, series.index);
      const tags = cleanTags(args.tags);
      const markdown = renderGeneratedArticle(
        {
          title,
          created: deps.now(),
          tags,
          ...(series
            ? {
                series: {
                  title: series.plan.title,
                  part: series.index + 1,
                  of: series.plan.parts.length,
                },
              }
            : {}),
        },
        body,
      );
      const id = await sink.save({ title, tags, markdown, ...(part ? { file: part.file } : {}) });
      state.saved = { id, title };
      return { ok: true, title };
    },
    summarize: (o) => `Saved “${String(o.title)}”`,
  };
}

/** `01`…`12`: parts sort in order in any file manager. */
const partPrefix = (n: number) => `${String(n).padStart(2, '0')} `;

/**
 * Checks the planner's arguments: a title and exactly `count` parts with
 * titles and summaries; file names `01 Title`… unique within the series.
 */
export function checkPlan(args: Record<string, unknown>, count: number): SeriesPlan | string {
  const title = normalizeSpace(String(args.title ?? '')).slice(0, 120);
  if (!title) return 'the series needs a title';
  const raw = Array.isArray(args.parts) ? args.parts : [];
  if (raw.length !== count) return `give exactly ${count} parts (got ${raw.length})`;
  const used = new Set<string>();
  const parts: SeriesPart[] = [];
  for (const [i, p] of raw.entries()) {
    if (!isObj(p)) return `part ${i + 1} is not an object`;
    const t = normalizeSpace(String(p.title ?? '')).slice(0, 120);
    const summary = normalizeSpace(String(p.summary ?? '')).slice(0, 600);
    if (!t) return `part ${i + 1} needs a title`;
    if (!summary) return `part ${i + 1} needs a summary`;
    const name = noteFileName(t, (n) => used.has(n.toLowerCase()), partPrefix(i + 1));
    used.add(name.toLowerCase());
    parts.push({ title: t, summary, file: name.slice(0, -3) });
  }
  return { title, parts };
}

function planSeriesTool(count: number): Tool<{ plan: SeriesPlan | null }> {
  return {
    name: 'plan_series',
    title: 'Plan series',
    startSummary: 'Planning the series',
    description:
      `Plan the series before it is written. title: the series’ title; parts: exactly ${count} ` +
      'parts in reading order, each with a title and a short summary of what it covers. Call once.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 120 },
        parts: {
          type: 'array',
          minItems: count,
          maxItems: count,
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', minLength: 1, maxLength: 120 },
              summary: { type: 'string', minLength: 1, maxLength: 600 },
            },
            required: ['title', 'summary'],
            additionalProperties: false,
          },
        },
      },
      required: ['title', 'parts'],
      additionalProperties: false,
    },
    mutates: false,
    handler: (state, args) => {
      if (state.plan)
        return Promise.resolve({ ok: false, error: 'the series is planned; stop now' });
      const plan = checkPlan(args, count);
      if (typeof plan === 'string') return Promise.resolve({ ok: false, error: plan });
      state.plan = plan;
      return Promise.resolve({ ok: true, parts: plan.parts.length });
    },
    summarize: (o) => `Planned ${String(o.parts)} parts`,
  };
}

/** Runs turns (the first, then a reminder) until `done()`; the error if never. */
async function runTurns(
  backend: TutorBackend,
  tools: Turn['tools'],
  newId: () => string,
  first: string,
  reminder: string,
  done: () => boolean,
  givenUp: () => boolean,
  signal: SignalLike,
): Promise<void> {
  const threadId = `article-writer-${newId()}`;
  const backendState: Record<string, JsonValue> = {};
  const history: Turn['history'] = [];
  let text = first;
  for (let n = 1; n <= MAX_WRITER_TURNS; n++) {
    if (signal.aborted) break;
    let reply = '';
    const turn: Turn = {
      threadId,
      systemPrompt: WRITER_PROMPT,
      history: [...history],
      userText: text,
      context: {},
      tools,
      backendState,
    };
    for await (const ev of backend.runTurn(turn, signal)) {
      if (ev.type === 'text_delta') reply += ev.text;
      else if (ev.type === 'tool_end' && done()) break;
      else if (ev.type === 'error') {
        if (ev.kind === 'cancelled' || signal.aborted)
          throw new GenerateError('cancelled', 'Stopped.');
        throw new GenerateError('backend', ev.message || 'The tutor failed.');
      } else if (ev.type === 'done') break;
    }
    if (done() || givenUp()) return;
    history.push({ role: 'user', text }, { role: 'assistant', text: reply });
    text = reminder;
  }
  if (signal.aborted) throw new GenerateError('cancelled', 'Writing was stopped.');
}

/**
 * Writes one article, or a series, at a time with the tutor's backend. A
 * series is planned first (`plan_series`), then each part is written in its
 * own conversation that sees the plan and the brief, not the earlier
 * parts' text.
 */
export class ArticleWriter {
  private running = false;

  constructor(private readonly deps: ArticleWriterDeps) {}

  get busy(): boolean {
    return this.running;
  }

  /**
   * Writes what `raw` asks for. `sink(seriesTitle)` gives where to save:
   * `null` for one article, the series' title for a series (main makes its
   * folder). Resolves to the articles saved, in order.
   */
  async write(
    raw: unknown,
    sink: (series: string | null) => Promise<ArticleSink>,
    signal: SignalLike,
    progress: (p: WriteProgress) => void = () => {},
  ): Promise<WrittenArticle[]> {
    const request = checkArticleRequest(raw);
    if (this.running)
      throw new GenerateError('busy', 'An article is already being written; wait for it.');
    this.running = true;
    try {
      const backend = this.deps.backend();
      let status: { available: boolean; reason: string | null };
      try {
        status = await backend.status();
      } catch {
        status = { available: false, reason: 'The tutor could not report its status.' };
      }
      if (!status.available)
        throw new GenerateError('unavailable', status.reason ?? 'The tutor is not available.');
      if (request.parts === 1) {
        progress({ kind: 'writing', part: 1, of: 1, title: null });
        const a = await this.one(backend, writerMessage(request), await sink(null), null, signal);
        progress({ kind: 'saved', part: 1, of: 1, ...a });
        return [a];
      }
      return await this.series(backend, request, sink, signal, progress);
    } finally {
      this.running = false;
    }
  }

  private async one(
    backend: TutorBackend,
    message: string,
    sink: ArticleSink,
    series: { plan: SeriesPlan; index: number } | null,
    signal: SignalLike,
  ): Promise<WrittenArticle> {
    const state: WriterState = { calls: 0, saved: null };
    const tools = new ToolRegistry(
      state,
      [saveArticleTool(this.deps, sink, series)],
      this.deps.log,
    );
    await runTurns(
      backend,
      tools,
      this.deps.newId,
      message,
      WRITER_REMINDER,
      () => state.saved !== null,
      () => state.calls >= MAX_SAVE_CALLS,
      signal,
    );
    if (state.saved) return state.saved;
    if (signal.aborted) throw new GenerateError('cancelled', 'Writing the article was stopped.');
    throw new GenerateError('not_written', 'The tutor did not write the article. Try again.');
  }

  private async series(
    backend: TutorBackend,
    request: ArticleRequest,
    sink: (series: string | null) => Promise<ArticleSink>,
    signal: SignalLike,
    progress: (p: WriteProgress) => void,
  ): Promise<WrittenArticle[]> {
    progress({ kind: 'planning' });
    const state: { plan: SeriesPlan | null } = { plan: null };
    const tools = new ToolRegistry(state, [planSeriesTool(request.parts)], this.deps.log);
    await runTurns(
      backend,
      tools,
      this.deps.newId,
      plannerMessage(request),
      PLANNER_REMINDER,
      () => state.plan !== null,
      () => false,
      signal,
    );
    const plan = state.plan;
    if (!plan) {
      if (signal.aborted) throw new GenerateError('cancelled', 'Writing the series was stopped.');
      throw new GenerateError('not_written', 'The tutor did not plan the series. Try again.');
    }
    progress({ kind: 'planned', title: plan.title, parts: plan.parts.map((p) => p.title) });
    const into = await sink(plan.title);
    const written: WrittenArticle[] = [];
    for (const [index, part] of plan.parts.entries()) {
      const of = plan.parts.length;
      progress({ kind: 'writing', part: index + 1, of, title: part.title });
      try {
        const a = await this.one(
          backend,
          partMessage(request, plan, index),
          into,
          { plan, index },
          signal,
        );
        written.push(a);
        progress({ kind: 'saved', part: index + 1, of, ...a });
      } catch (e) {
        // The parts already saved stay; the caller says which were written.
        const why =
          e instanceof GenerateError ? e : new GenerateError('backend', 'Writing a part failed.');
        this.deps.log?.('writing a series part failed', e);
        throw new SeriesStopped(why, written);
      }
    }
    return written;
  }
}

/** A series stopped part-way: why, and the parts saved before it. */
export class SeriesStopped extends GenerateError {
  constructor(
    readonly reason: GenerateError,
    readonly written: WrittenArticle[],
  ) {
    super(reason.code, reason.message);
    this.name = 'SeriesStopped';
  }
}
