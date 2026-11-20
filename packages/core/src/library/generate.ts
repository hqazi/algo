/**
 * Articles the tutor writes (SPEC §15.1, T25): the request, the writer's
 * prompt and its one tool (`save_article`), the cleaning of what the model
 * wrote, and the file it becomes. Main saves the file in the app's own
 * `articles/generated/<slug>.md`, never in a library folder.
 *
 * A generated article holds no images: image syntax is turned into its alt
 * text before saving, so the model can never cause a download (§15.4).
 */
import { TutorError } from '../teaching/errors';
import type { SignalLike, Turn, TutorBackend } from '../tutor/backend';
import { ToolRegistry, type Tool } from '../tools/registry';
import type { JsonValue } from '../types/json';
import { normalizeSpace } from './anchors';

/** The index's folder id for generated articles (settings folder ids are UUIDs). */
export const GENERATED_FOLDER_ID = 'generated';
export const GENERATED_GROUP_NAME = 'Written by the tutor';

export const ARTICLE_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export const ARTICLE_LENGTHS = ['short', 'medium', 'long'] as const;
export type ArticleLevel = (typeof ARTICLE_LEVELS)[number];
export type ArticleLength = (typeof ARTICLE_LENGTHS)[number];
/** About how many words each length asks for. */
export const LENGTH_WORDS: Record<ArticleLength, number> = { short: 600, medium: 1200, long: 2500 };

export const MAX_TOPIC_CHARS = 300;
export const MAX_ARTICLE_CHARS = 60_000;
export const MAX_TAGS = 8;
/** Turns per article: the first and one reminder to call `save_article`. */
export const MAX_WRITER_TURNS = 2;
/** `save_article` calls per article. */
export const MAX_SAVE_CALLS = 3;

export interface ArticleRequest {
  topic: string;
  level: ArticleLevel;
  length: ArticleLength;
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
  if (!isObj(raw)) throw new GenerateError('invalid', 'Give a topic, a level and a length.');
  const topic = typeof raw.topic === 'string' ? normalizeSpace(raw.topic) : '';
  if (!topic) throw new GenerateError('invalid', 'Give a topic for the article.');
  if (topic.length > MAX_TOPIC_CHARS)
    throw new GenerateError('invalid', `The topic is longer than ${MAX_TOPIC_CHARS} characters.`);
  const level = raw.level ?? 'intermediate';
  const length = raw.length ?? 'medium';
  if (!ARTICLE_LEVELS.includes(level as ArticleLevel))
    throw new GenerateError('invalid', 'Unknown level.');
  if (!ARTICLE_LENGTHS.includes(length as ArticleLength))
    throw new GenerateError('invalid', 'Unknown length.');
  return { topic, level: level as ArticleLevel, length: length as ArticleLength };
}

/** `"Binary Heaps, explained!"` → `binary-heaps-explained`, made unique with `-2`, `-3`… */
export function articleSlug(title: string, taken: (slug: string) => boolean): string {
  const base =
    title
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '') || 'article';
  if (!taken(base)) return base;
  for (let n = 2; n < 10_000; n++) if (!taken(`${base}-${n}`)) return `${base}-${n}`;
  throw new GenerateError('backend', 'No free file name for the article.');
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
}

/** The file: frontmatter (`title`, `created`, `tags`, `generated: true`), then the body. */
export function renderGeneratedArticle(meta: GeneratedMeta, body: string): string {
  const tags = meta.tags.length
    ? `\n${meta.tags.map((t) => `  - ${yamlString(t)}`).join('\n')}`
    : ' []';
  return (
    `---\ntitle: ${yamlString(meta.title)}\ncreated: ${yamlString(meta.created)}\n` +
    `tags:${tags}\ngenerated: true\n---\n\n${body}`
  );
}

// ---------------------------------------------------------------- the writer

export const WRITER_PROMPT = `\
You are the tutor inside Algo, a desktop app for practising data structures and algorithms. \
The user asked you to write an article for their library. It is saved on their computer, shown under \
"Written by the tutor" and labelled as AI-written.

Your only tool is \`save_article\`. Write the whole article and call \`save_article\` once with its title, \
a few tags and the body. Nobody reads your chat text; the job ends when the article is saved.

- The body is Markdown: \`##\` and \`###\` headings for sections (no \`#\` title: the app shows the title), \
paragraphs, lists, tables and fenced code blocks (Python unless the topic needs another language).
- Teach: start from the idea, build up with small examples and a worked trace, give the complexity with \
the reason, and end with common pitfalls and a short summary.
- Pitch it at the level asked and keep near the length asked.
- No images, no raw HTML and no links to images: the app does not show them. Links to well-known \
references are fine but not needed.
- Be accurate. If the topic is not about computing, programming, data structures or algorithms, still \
write a short, accurate article on it.`;

export function writerMessage(req: ArticleRequest): string {
  return (
    `Write an article.\nTopic: ${req.topic}\nLevel: ${req.level}\n` +
    `Length: ${req.length} (about ${LENGTH_WORDS[req.length]} words)\n` +
    'Call save_article with it.'
  );
}

export const WRITER_REMINDER =
  'The article is not saved yet. Call save_article now with the title, tags and the whole body.';

/** What `save_article` hands main: the slug is free, the markdown is the whole file. */
export interface ArticleToSave {
  slug: string;
  title: string;
  tags: string[];
  markdown: string;
}

export interface ArticleWriterDeps {
  backend: () => TutorBackend;
  /** Writes the file (atomically) and indexes it; resolves to the article's id. */
  save: (article: ArticleToSave) => Promise<string>;
  /** True if `articles/generated/<slug>.md` exists. */
  taken: (slug: string) => boolean;
  now: () => string;
  newId: () => string;
  log?: (message: string, error?: unknown) => void;
}

export interface WrittenArticle {
  id: string;
  title: string;
  slug: string;
}

interface WriterState {
  calls: number;
  saved: WrittenArticle | null;
}

function saveArticleTool(deps: ArticleWriterDeps): Tool<WriterState> {
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
      const title = normalizeSpace(String(args.title)).slice(0, 120);
      if (!title) throw new TutorError('title is empty', 'invalid_input');
      const body = cleanArticleBody(String(args.body), title);
      if (normalizeSpace(body).length < 200)
        return { ok: false, error: 'the body is too short; write the whole article' };
      const tags = cleanTags(args.tags);
      const slug = articleSlug(title, deps.taken);
      const markdown = renderGeneratedArticle({ title, created: deps.now(), tags }, body);
      const id = await deps.save({ slug, title, tags, markdown });
      state.saved = { id, title, slug };
      return { ok: true, slug, title };
    },
    summarize: (o) => `Saved “${String(o.title)}”`,
  };
}

/** Writes one article at a time with the tutor's backend. */
export class ArticleWriter {
  private running = false;

  constructor(private readonly deps: ArticleWriterDeps) {}

  get busy(): boolean {
    return this.running;
  }

  async write(raw: unknown, signal: SignalLike): Promise<WrittenArticle> {
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
      return await this.run(backend, request, signal);
    } finally {
      this.running = false;
    }
  }

  private async run(
    backend: TutorBackend,
    request: ArticleRequest,
    signal: SignalLike,
  ): Promise<WrittenArticle> {
    const state: WriterState = { calls: 0, saved: null };
    const tools = new ToolRegistry(state, [saveArticleTool(this.deps)], this.deps.log);
    const threadId = `article-writer-${this.deps.newId()}`;
    const backendState: Record<string, JsonValue> = {};
    const history: Turn['history'] = [];
    let text = writerMessage(request);
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
        else if (ev.type === 'tool_end' && state.saved) break;
        else if (ev.type === 'error') {
          if (ev.kind === 'cancelled' || signal.aborted)
            throw new GenerateError('cancelled', 'Stopped.');
          throw new GenerateError('backend', ev.message || 'The tutor failed.');
        } else if (ev.type === 'done') break;
      }
      if (state.saved) return state.saved;
      if (state.calls >= MAX_SAVE_CALLS) break;
      history.push({ role: 'user', text }, { role: 'assistant', text: reply });
      text = WRITER_REMINDER;
    }
    if (signal.aborted) throw new GenerateError('cancelled', 'Writing the article was stopped.');
    throw new GenerateError('not_written', 'The tutor did not write the article. Try again.');
  }
}
