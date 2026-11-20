/**
 * The tutor's system prompt (SPEC §7.2) and the per-turn user message.
 * Ported from `dsa-tutor/dsa_tutor/prompt.py`.
 *
 * `buildSystemPrompt` assembles, in a fixed order so prompt caching works:
 * the app preamble, the rules, the start-of-conversation step, the intent
 * table and the teaching style (from `rules.ts`), the tool list, then every
 * `content/references/*.md` guide. Nothing per-turn goes in it: the problem,
 * the user's code and the last test report travel with the user message
 * (`renderUserMessage`). The text depends only on the tools and the
 * references, so it is built once.
 */
import { stringifyJson, type JsonValue } from '../types/json';
import { renderArticleContext } from '../tools/article-prompt';
import type { TurnContext } from './backend';
import { intents, PREAMBLE, RULES, START, STYLE } from './rules';

export const REFERENCE_ORDER = [
  'questionnaire',
  'hint_ladder',
  'review_rubric',
  'problem_spec',
  'topics',
] as const;
export const MAX_CODE_CHARS = 60_000;
export const MAX_REPORT_CASES = 12;
export const MAX_VALUE_CHARS = 400;

/** Script names and paths from `dsa-tutor` must never reach the prompt. */
const LEFTOVER = /scripts\/|\b(?:state|run_tests|new_problem|render_explanation)\.py\b/;

export interface PromptTool {
  name: string;
  description: string;
}

/** `- \`name\`: first sentence of the description`, one line per tool. */
export function toolList(tools: readonly PromptTool[]): string {
  return tools
    .map((t) => {
      const first = t.description.trim().split(/(?<=\.)\s/, 1)[0] ?? '';
      return `- \`${t.name}\`: ${first}`;
    })
    .join('\n');
}

/** Small rewrites the reference guides need inside the prompt. */
function rewriteGuide(text: string): string {
  return text
    .replace(/`(\w+)\.md`/g, 'the $1 guide')
    .replace(/\b(\w+)\.md\b/g, 'the $1 guide')
    .replace(/^# /, '## ');
}

/**
 * The full system prompt. `references` maps a guide's name (`hint_ladder`)
 * to its Markdown. `problem_spec` is left out unless `create_problem` is
 * offered; the intent table follows the tools too.
 */
export function buildSystemPrompt(
  tools: readonly PromptTool[],
  references: Readonly<Record<string, string>>,
): string {
  const names = new Set(tools.map((t) => t.name));
  const canCreate = names.has('create_problem');
  const canExplain = names.has('render_explanation');
  const parts = [
    PREAMBLE,
    `# Rules\n\n${RULES}`,
    `# Start of every conversation\n\n${START}`,
    `# What the user wants → what to do\n\n${intents(canCreate, canExplain)}`,
    `# Teaching style\n\n${STYLE}`,
    `# Tools\n\n${toolList(tools)}`,
  ];
  const known = Object.keys(references).sort();
  const ordered = [
    ...REFERENCE_ORDER.filter((n) => known.includes(n)),
    ...known.filter((n) => !(REFERENCE_ORDER as readonly string[]).includes(n)),
  ].filter((n) => canCreate || n !== 'problem_spec');
  for (const name of ordered) {
    parts.push(`# Guide: ${name}\n\n${rewriteGuide(references[name]!.trim())}`);
  }
  const prompt = `${parts.join('\n\n')}\n`;
  const leftover = LEFTOVER.exec(prompt);
  if (leftover) {
    const start = Math.max(0, leftover.index - 60);
    throw new Error(
      `system prompt still names a script near: ${JSON.stringify(prompt.slice(start, leftover.index + 30))}`,
    );
  }
  return prompt;
}

// ---------------------------------------------------------------- per turn

/** Stops user text from closing the block it sits in. */
function escapeTag(text: string, tag: string): string {
  return text.split(`</${tag}`).join(`&lt;/${tag}`);
}

function short(value: unknown): string {
  const text = typeof value === 'string' ? value : stringifyJson(value);
  return text.length <= MAX_VALUE_CHARS ? text : `${text.slice(0, MAX_VALUE_CHARS - 3)}...`;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The parts of a (redacted) report worth sending: counts and the failing
 * cases. Hidden cases keep only id, category and status, whatever the report
 * held: a second guard behind `redactReport`.
 */
export function compactReport(report: JsonValue): Record<string, JsonValue> {
  if (!isObj(report)) return {};
  const out: Record<string, JsonValue> = {};
  for (const k of ['passed', 'total', 'all_passed'] as const)
    if (k in report) out[k] = report[k] as JsonValue;
  if (isObj(report.run_error)) {
    out.run_error = {
      kind: String(report.run_error.kind ?? ''),
      message: short(report.run_error.message ?? ''),
    };
  }
  const failing: Record<string, JsonValue>[] = [];
  const cases = Array.isArray(report.cases) ? report.cases : [];
  for (const c of cases) {
    if (!isObj(c) || c.status === 'pass') continue;
    const item: Record<string, JsonValue> = {
      id: String(c.id ?? ''),
      visibility: c.visibility === 'visible' ? 'visible' : 'hidden',
      category: String(c.category ?? ''),
      status: String(c.status ?? ''),
    };
    if (c.visibility === 'visible') {
      for (const key of ['input', 'expected', 'actual', 'stdout', 'message', 'errorType', 'line']) {
        const v = c[key];
        if (v !== undefined && v !== null && v !== '') item[key] = short(v);
      }
    }
    failing.push(item);
  }
  out.failing = failing.slice(0, MAX_REPORT_CASES);
  if (failing.length > MAX_REPORT_CASES) out.more_failing = failing.length - MAX_REPORT_CASES;
  return out;
}

export function renderContext(context: TurnContext): string {
  const lines = ['<context>'];
  if (context.article) {
    lines.push(...renderArticleContext(context.article), '</context>');
    return lines.join('\n');
  }
  if (context.slug) {
    const title = context.title ? ` — ${context.title}` : '';
    lines.push(`Open problem: ${context.slug}${title}`);
    if (context.language) lines.push(`Language: ${context.language}`);
  } else {
    lines.push('No problem is open.');
  }
  if (typeof context.code === 'string') {
    let code = context.code;
    if (code.length > MAX_CODE_CHARS) code = `${code.slice(0, MAX_CODE_CHARS)}\n# ... (truncated)`;
    lines.push('<user_code>', escapeTag(code.trimEnd(), 'user_code'), '</user_code>');
  }
  if (context.lastReport !== undefined && context.lastReport !== null) {
    const text = stringifyJson(compactReport(context.lastReport));
    lines.push('<last_test_report>', escapeTag(text, 'last_test_report'), '</last_test_report>');
  }
  lines.push('</context>');
  return lines.join('\n');
}

/** The user turn as the model sees it: the context block, then what they typed. */
export function renderUserMessage(text: string, context: TurnContext): string {
  return `${renderContext(context)}\n\n${text}`;
}
