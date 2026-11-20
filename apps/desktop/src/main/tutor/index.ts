/**
 * The tutor in the main process (SPEC §7, T10): picks the backend from the
 * settings, builds the tool registry over the practice service (same guard,
 * same teaching state as the buttons), the system prompt from
 * `content/references/`, the per-turn context, and the explanation pages.
 *
 * Backend choice (`tutor.backend`): `auto` is Anthropic when a key is set,
 * else none; `claude-code` is the user's installed Claude Code, run with the
 * same key through a loopback relay (T11, DECISIONS D-25), so `auto` never
 * needs it; `none` turns the tutor off.
 * `ALGOTUTOR_FAKE_TUTOR=<script.json>` (development and tests only, SPEC §12)
 * replaces all of it with the scripted fake backend.
 *
 * The API key comes from `apiKey()`: the environment's `ANTHROPIC_API_KEY`,
 * else the one stored in the keychain (`main/secrets/`, T09). It stays in
 * this process.
 */
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  articleTurnContext,
  buildArticleRegistry,
  buildArticleSystemPrompt,
  parseAnchor,
  buildSystemPrompt,
  buildTutorRegistry,
  ChatRefusal,
  ChatService,
  FakeBackend,
  HOME_THREAD,
  parseFakeScript,
  renderExplanationPage,
  UnavailableBackend,
  type ArticleThread,
  type ArticleToolContext,
  type JsonSchema,
  type ArticleTurn,
  type BackendStatus,
  type OpenArticle,
  type Settings,
  type Sleep,
  type ToolOutput,
  type ToolRegistry,
  type TurnContext,
  type TutorBackend,
  type TutorToolContext,
} from '@algo/core';
import { McpGateway } from '../mcp/gateway';
import { McpServer } from '../mcp/server';
import type { Practice } from '../practice/service';
import { AnthropicBackend } from './anthropic/backend';
import { ApiProxy } from './claude-code/api-proxy';
import { ClaudeCodeBackend } from './claude-code/backend';
import { detectClaudeCode, type ClaudeCodeInfo } from './claude-code/detect';
import { ExplanationStore } from './explanations';

export { AnthropicBackend, DEFAULT_MODEL } from './anthropic/backend';
export { ExplanationStore } from './explanations';
export { MIN_VERSION as CLAUDE_CODE_MIN_VERSION, type ClaudeCodeInfo } from './claude-code/detect';

export const FAKE_TUTOR_ENV = 'ALGOTUTOR_FAKE_TUTOR';

export interface TutorStatus extends BackendStatus {
  /** The backend in use, or `none`. */
  backend: 'anthropic' | 'claude-code' | 'fake' | 'none';
}

export interface TutorDeps {
  practice: Practice;
  settings: () => Settings;
  /** The Anthropic API key, or `null`. */
  apiKey: () => string | null;
  contentDir: string;
  explanationsDir: string;
  /** Claude Code's home while it runs as the tutor (`<data>/agent-home`). */
  agentHome: string;
  appVersion: string;
  /** Tests: replaces Claude Code detection. */
  detectClaudeCode?: (configured: string | null) => Promise<ClaudeCodeInfo>;
  env?: Record<string, string | undefined>;
  now: () => string;
  log?: (message: string, error?: unknown) => void;
  /** T12: validate, self-check and save a problem; without it `create_problem` is not offered. */
  createProblem?: TutorToolContext['createProblem'];
  /**
   * T24: reads a library article for a chat turn (title, source, body; body
   * `null` when the file is missing). Without it article threads cannot send.
   */
  readArticle?: (articleId: string) => Promise<OpenArticle>;
}

export interface AppTutor {
  chat: ChatService;
  tools: ToolRegistry<TutorToolContext>;
  explanations: ExplanationStore;
  systemPrompt: string;
  /** The system prompt of article threads (SPEC §15.5). */
  articlePrompt: string;
  /** `content/references/*.md` by name. */
  references: Record<string, string>;
  /** The Anthropic backend, also when another is chosen (Settings' connection test). */
  anthropic: AnthropicBackend;
  claudeCode: ClaudeCodeBackend;
  /** Where Claude Code is and whether it can be used (cached; `recheck` looks again). */
  claudeCodeInfo(recheck?: boolean): Promise<ClaudeCodeInfo>;
  backend(): TutorBackend;
  status(): Promise<TutorStatus>;
  /** Stops the MCP server and the relay (at quit). */
  close(): Promise<void>;
}

const sleep: Sleep = async (ms, signal) => {
  try {
    await delay(ms, undefined, { signal: signal as AbortSignal });
  } catch {
    // aborted: resolve, the backend checks the signal
  }
};

/** The guides in `content/references/`, by name. */
export async function readReferences(contentDir: string): Promise<Record<string, string>> {
  const dir = join(contentDir, 'references');
  const out: Record<string, string> = {};
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.md')).sort())
    out[name.slice(0, -3)] = await readFile(join(dir, name), 'utf8');
  return out;
}

async function fakeFromEnv(path: string): Promise<TutorBackend> {
  try {
    return new FakeBackend(parseFakeScript(JSON.parse(await readFile(path, 'utf8'))), { sleep });
  } catch (e) {
    return new UnavailableBackend(
      'fake',
      `${FAKE_TUTOR_ENV} could not be read (${e instanceof Error ? e.message : String(e)})`,
    );
  }
}

export async function openTutor(deps: TutorDeps): Promise<AppTutor> {
  const { practice } = deps;
  const log = deps.log ?? ((m: string, e?: unknown) => console.error(m, e ?? ''));
  const explanations = new ExplanationStore(deps.explanationsDir);
  const teaching = practice.teaching;

  const renderExplanation = async (content: Record<string, unknown>): Promise<ToolOutput> => {
    const slug = String(content.slug);
    const problem = teaching.summary(slug);
    const topic = practice.topics().find((t) => t.id === problem.topic)?.name ?? problem.topic;
    const html = renderExplanationPage(
      content,
      {
        title: problem.title,
        topic,
        difficulty: problem.difficulty,
        language: teaching.languageFor(slug),
      },
      deps.now().slice(0, 10),
    );
    const version = await explanations.save(slug, html);
    return { ok: true, slug, version };
  };

  const ctx: TutorToolContext = { ...practice.toolContext, renderExplanation };
  if (deps.createProblem) ctx.createProblem = deps.createProblem;
  const tools = buildTutorRegistry(ctx, (m, e) => log(m, e));
  const references = await readReferences(deps.contentDir);
  const systemPrompt = buildSystemPrompt(tools.anthropicTools(), references);

  const anthropic = new AnthropicBackend({
    apiKey: deps.apiKey,
    model: () => deps.settings().tutor.model,
    effort: () => deps.settings().tutor.effort,
    log: (m) => console.warn(m),
  });
  // Claude Code (T11): detection is cached (status is read before every
  // turn); a new configured path or a recheck looks again.
  const env = deps.env ?? process.env;
  let detected: { configured: string | null; info: Promise<ClaudeCodeInfo> } | null = null;
  const claudeCodeInfo = (recheck = false): Promise<ClaudeCodeInfo> => {
    const configured = deps.settings().tutor.claudeCodePath;
    if (recheck || !detected || detected.configured !== configured) {
      const info = deps.detectClaudeCode
        ? deps.detectClaudeCode(configured)
        : detectClaudeCode({ configured, env, home: homedir() });
      detected = { configured, info };
    }
    return detected.info;
  };
  const gateway = new McpGateway();
  const mcp = new McpServer({ gateway, version: deps.appVersion, log: (m) => log(m) });
  const relay = new ApiProxy({
    apiKey: deps.apiKey,
    upstream: () => env.ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com',
    log: (m) => log(m),
  });
  let servers: Promise<void> | null = null;
  const claudeCode = new ClaudeCodeBackend({
    info: () => claudeCodeInfo(),
    gateway,
    relay,
    ready: () =>
      (servers ??= Promise.all([mcp.start(), relay.start()]).then(
        () => undefined,
        (e: unknown) => {
          servers = null;
          throw e;
        },
      )),
    apiKey: deps.apiKey,
    model: () => deps.settings().tutor.model,
    effort: () => deps.settings().tutor.effort,
    home: deps.agentHome,
    env,
    log: (m) => log(m),
  });

  const fakePath = deps.env?.[FAKE_TUTOR_ENV]?.trim();
  const fake = fakePath ? await fakeFromEnv(fakePath) : null;

  const backend = (): TutorBackend => {
    if (fake) return fake;
    const choice = deps.settings().tutor.backend;
    if (choice === 'none')
      return new UnavailableBackend('anthropic', 'The tutor is turned off in Settings.');
    if (choice === 'claude-code') return claudeCode;
    if (choice === 'auto' && !deps.apiKey())
      return new UnavailableBackend(
        'anthropic',
        'No tutor is set up. Add an Anthropic API key in Settings to use the tutor.',
        anthropic.model(),
      );
    return anthropic;
  };

  const context = async (thread: string, code: string | undefined): Promise<TurnContext> => {
    if (thread === HOME_THREAD) return {};
    const summary = teaching.summary(thread);
    const language = teaching.languageFor(thread);
    const out: TurnContext = { slug: thread, title: summary.title, language };
    const saved = code ?? (await ctx.workspace.read(thread, language));
    if (saved !== null && saved !== undefined) out.code = saved;
    const report = ctx.storage.read((db) => {
      const open = db.getOpenAttempt(thread);
      return open ? (db.listTestRuns(open.id).at(-1)?.report ?? null) : null;
    });
    if (report !== null) out.lastReport = report;
    return out;
  };

  // Article mode (T24): three tools bound to the open article, its own prompt.
  // T25: plus `create_problem` from a passage, through the tutor's own tool
  // (same guard, same factory: self-check in Pyodide before anything is saved).
  const getProfile = () => teaching.getProfile();
  const problemTool = tools.get('create_problem');
  const specSchema = (problemTool?.inputSchema.properties as Record<string, JsonSchema> | undefined)
    ?.spec;
  const problemCtx: Pick<ArticleToolContext, 'createProblem' | 'problemSpecSchema'> =
    problemTool && specSchema
      ? {
          problemSpecSchema: specSchema,
          createProblem: async (args) => (await tools.call('create_problem', args)).output,
        }
      : {};
  const articlePrompt = buildArticleSystemPrompt(
    buildArticleRegistry({ body: null, getProfile, ...problemCtx }).anthropicTools(),
    references,
  );
  const readArticle = deps.readArticle;
  const article = readArticle
    ? async (t: ArticleThread): Promise<ArticleTurn> => {
        const anchor = parseAnchor(t.anchor) ?? {
          kind: 'heading' as const,
          heading: [],
          quote: '',
          prefix: '',
          suffix: '',
        };
        let open: OpenArticle;
        try {
          open = await readArticle(t.articleId);
        } catch (e) {
          log('reading an article for a chat failed', e);
          throw new ChatRefusal('not_found', 'That article is no longer in the library.');
        }
        return {
          context: { article: articleTurnContext(open, anchor) },
          tools: buildArticleRegistry({ body: open.body, getProfile, ...problemCtx }, (m, e) =>
            log(m, e),
          ),
          systemPrompt: articlePrompt,
        };
      }
    : undefined;

  const chat = new ChatService({
    ...(article ? { article } : {}),
    storage: ctx.storage,
    backend,
    tools,
    systemPrompt,
    context,
    now: deps.now,
    log: (m, e) => log(m, e),
  });

  return {
    chat,
    tools,
    explanations,
    systemPrompt,
    articlePrompt,
    references,
    anthropic,
    claudeCode,
    claudeCodeInfo,
    backend,
    async close() {
      await Promise.all([mcp.stop(), relay.stop()]);
    },
    async status() {
      const b = backend();
      let s: BackendStatus;
      try {
        s = await b.status();
      } catch (e) {
        log('tutor status failed', e);
        s = { available: false, reason: 'The tutor could not report its status.', model: null };
      }
      const off = !s.available && b instanceof UnavailableBackend && !fake;
      return { ...s, backend: off ? 'none' : b.id };
    },
  };
}
