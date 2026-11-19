/**
 * Explanation pages: fill the template from the tutor's content. Ported from
 * `dsa-tutor/dsa_tutor/core/explanations.py` (rendering only; the main
 * process keeps the versions on disk).
 *
 * Content (text fields accept light Markdown: paragraphs, `- ` lists,
 * `1. ` lists, `### ` headings, `code`, **bold**, *italic*, ``` fences):
 *
 *   slug, plain_words, intuition,
 *   brute_force / optimal: { idea, time?, space?, code? } or Markdown,
 *   trace: { intro?, columns, rows, outro? } or Markdown,
 *   complexity: { time?, space?, why? } or Markdown,
 *   solution: source in the attempt's language,
 *   pitfalls: a non-empty list or Markdown.
 *
 * Everything is HTML-escaped before the light Markdown is applied, so the
 * page carries no markup the tutor wrote. It is shown in a sandboxed iframe
 * with no scripts anyway (SPEC §8).
 */
import { TutorError } from '../teaching/errors';
import { EXPLANATION_TEMPLATE } from './explanation-template';

export const EXPLANATION_REQUIRED = [
  'slug',
  'plain_words',
  'intuition',
  'brute_force',
  'optimal',
  'trace',
  'complexity',
  'solution',
  'pitfalls',
] as const;

export interface ExplanationMeta {
  title: string;
  /** The topic's display name. */
  topic: string;
  difficulty: string;
  /** The attempt's language: the solution's highlighting. */
  language: string;
}

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
};
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c]!);
const escapeText = (s: string): string => s.replace(/[&<>]/g, (c) => ESC[c]!);

// ---------------------------------------------------------------- markdown (small subset)

export function inline(text: string): string {
  return text
    .split(/(`[^`]*`)/)
    .map((part) => {
      if (part.length >= 2 && part.startsWith('`') && part.endsWith('`'))
        return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      return escapeText(part)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/g, '<em>$1</em>');
    })
    .join('');
}

function items(lines: string[], marker: RegExp): string[] {
  const out: string[] = [];
  for (const ln of lines) {
    const m = marker.exec(ln);
    if (m) out.push(ln.slice(m[0].length).trim());
    else if (out.length) out[out.length - 1] += ` ${ln.trim()}`;
  }
  return out;
}

function blocks(text: string): string[] {
  const out: string[] = [];
  for (const block of text.trim().split(/\n\s*\n/)) {
    let lines = block
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.trim());
    if (!lines.length) continue;
    if (lines[0]!.startsWith('### ')) {
      out.push(`<h3>${inline(lines[0]!.slice(4))}</h3>`);
      lines = lines.slice(1);
      if (!lines.length) continue;
    }
    const isList = (re: RegExp) =>
      lines.every((ln, i) => re.test(ln) || (i > 0 && ln.startsWith('  ')));
    const ul = /^\s*[-*] /;
    const ol = /^\s*\d+[.)] /;
    if (isList(ul))
      out.push(
        `<ul>${items(lines, ul)
          .map((i) => `<li>${inline(i)}</li>`)
          .join('')}</ul>`,
      );
    else if (isList(ol))
      out.push(
        `<ol>${items(lines, ol)
          .map((i) => `<li>${inline(i)}</li>`)
          .join('')}</ol>`,
      );
    else out.push(`<p>${inline(lines.map((l) => l.trim()).join(' '))}</p>`);
  }
  return out;
}

export function markdown(text: unknown): string {
  if (typeof text !== 'string') throw new TutorError(`expected Markdown text, got ${typeof text}`);
  const out: string[] = [];
  const fence = /^```[ \t]*(\w*)[ \t]*\n([\s\S]*?)^```[ \t]*$/gm;
  const src = `${text.replace(/^\n+|\n+$/g, '')}\n`;
  let last = 0;
  for (const m of src.matchAll(fence)) {
    out.push(...blocks(src.slice(last, m.index)));
    out.push(codeBlock(m[2]!, m[1] || 'python'));
    last = m.index + m[0].length;
  }
  out.push(...blocks(src.slice(last)));
  return out.join('\n');
}

// ---------------------------------------------------------------- code highlighting

const PY_KEYWORDS = new Set(
  (
    'False None True and as assert async await break class continue def del elif else except finally ' +
    'for from global if import in is lambda nonlocal not or pass raise return try while with yield ' +
    'self cls match case'
  ).split(' '),
);
const PY_BUILTINS = new Set(
  (
    'abs all any bin bool bytes callable chr dict dir divmod enumerate filter float format frozenset ' +
    'getattr hasattr hash hex id input int isinstance issubclass iter len list map max min next object ' +
    'oct open ord pow print range repr reversed round set slice sorted str sum super tuple type zip'
  ).split(' '),
);
const PY_TOKEN =
  /(#[^\n]*)|([rbfuRBFU]{0,2}(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'))|(\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|([A-Za-z_]\w*)/g;

/**
 * Python tokens wrapped in spans (`tok-kw`, `tok-str`, `tok-num`, `tok-com`,
 * `tok-fn`, `tok-bi`). A small scanner, not Python's tokenizer as in
 * `dsa-tutor`: good enough for colours, and never drops text.
 */
export function highlightPython(code: string): string {
  const src = code.replace(/\t/g, '    ').trimEnd();
  let out = '';
  let pos = 0;
  let prev = '';
  for (const m of src.matchAll(PY_TOKEN)) {
    out += escapeText(src.slice(pos, m.index));
    const [text, com, str, num, name] = m;
    let cls: string | null = null;
    if (com) cls = 'com';
    else if (str) cls = 'str';
    else if (num) cls = 'num';
    else if (name) {
      if (PY_KEYWORDS.has(name)) cls = 'kw';
      else if (prev === 'def' || prev === 'class') cls = 'fn';
      else if (PY_BUILTINS.has(name)) cls = 'bi';
      prev = name;
    }
    out += cls ? `<span class="tok-${cls}">${escapeText(text)}</span>` : escapeText(text);
    pos = m.index + text.length;
  }
  return out + escapeText(src.slice(pos));
}

export function codeBlock(code: string, lang = 'python'): string {
  const body = ['python', 'py', ''].includes(lang)
    ? highlightPython(code)
    : escapeText(code.replace(/\n+$/, ''));
  return `<pre><code>${body}</code></pre>`;
}

// ---------------------------------------------------------------- sections

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const optStr = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function badges(time: unknown, space: unknown): string {
  const parts: string[] = [];
  if (optStr(time)) parts.push(`<span class="badge">time ${escapeHtml(time as string)}</span>`);
  if (optStr(space)) parts.push(`<span class="badge">space ${escapeHtml(space as string)}</span>`);
  return parts.length ? `<p>${parts.join('')}</p>` : '';
}

function approach(data: unknown, lang: string): string {
  if (typeof data === 'string') return markdown(data);
  if (!isObj(data) || !('idea' in data))
    throw new TutorError("brute_force / optimal need an object with at least 'idea'");
  let out = markdown(data.idea) + badges(data.time, data.space);
  if (optStr(data.code)) out += codeBlock(data.code as string, lang);
  return out;
}

function trace(data: unknown): string {
  if (typeof data === 'string') return markdown(data);
  if (!isObj(data))
    throw new TutorError('trace must be Markdown text or an object with columns and rows');
  let out = optStr(data.intro) ? markdown(data.intro) : '';
  const columns = Array.isArray(data.columns) ? data.columns : [];
  const rows = Array.isArray(data.rows) ? data.rows : [];
  if (columns.length && rows.length) {
    const head = columns.map((c) => `<th>${inline(String(c))}</th>`).join('');
    const body = rows
      .map(
        (row) =>
          `<tr>${(Array.isArray(row) ? row : [row]).map((c) => `<td>${inline(String(c))}</td>`).join('')}</tr>`,
      )
      .join('');
    out += `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }
  if (optStr(data.outro)) out += markdown(data.outro);
  return out;
}

function complexity(data: unknown): string {
  if (typeof data === 'string') return markdown(data);
  if (!isObj(data)) throw new TutorError('complexity must be Markdown text or {time, space, why}');
  return badges(data.time, data.space) + (optStr(data.why) ? markdown(data.why) : '');
}

function pitfalls(data: unknown): string {
  if (typeof data === 'string') return markdown(data);
  if (!Array.isArray(data) || !data.length)
    throw new TutorError('pitfalls must be a non-empty list');
  return `<ul class="pitfalls">${data.map((p) => `<li>${inline(String(p))}</li>`).join('')}</ul>`;
}

/** The page's HTML. Throws `TutorError` for malformed content (the tool reports it to the model). */
export function renderExplanationPage(
  content: Record<string, unknown>,
  meta: ExplanationMeta,
  generatedOn: string,
): string {
  const missing = EXPLANATION_REQUIRED.filter((k) => !(k in content));
  if (missing.length) throw new TutorError(`content is missing: ${missing.join(', ')}`);
  if (typeof content.solution !== 'string') throw new TutorError('solution must be source text');
  const lang = meta.language;
  const difficulty = meta.difficulty.charAt(0).toUpperCase() + meta.difficulty.slice(1);
  const values: Record<string, string> = {
    title: escapeHtml(meta.title),
    meta: `<span>${escapeHtml(meta.topic)}</span><span>${escapeHtml(difficulty)}</span>`,
    slug: escapeHtml(String(content.slug)),
    generated: escapeHtml(generatedOn),
    plain_words: markdown(content.plain_words),
    intuition: markdown(content.intuition),
    brute_force: approach(content.brute_force, lang),
    optimal: approach(content.optimal, lang),
    trace: trace(content.trace),
    complexity: complexity(content.complexity),
    solution: codeBlock(content.solution, lang),
    pitfalls: pitfalls(content.pitfalls),
  };
  return EXPLANATION_TEMPLATE.replace(/\{\{(\w+)\}\}/g, (m, k: string) => values[k] ?? m);
}
