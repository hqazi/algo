/**
 * A note's YAML frontmatter, read as data (SPEC §15.1).
 *
 * The YAML is parsed with the `core` schema and no custom tags: nothing in a
 * note can create an object other than plain maps, lists, strings, numbers,
 * booleans and null (an unknown tag such as `!!js/function` leaves its value
 * a plain string). Aliases are capped so a small file cannot expand into a
 * huge one. Dates stay strings (`2026-11-20`): the core schema has no
 * timestamp type.
 *
 * Known keys are the Obsidian Web Clipper's defaults (D-39): `title`,
 * `source`, `author`, `published`, `created`, `description`, `tags`. Every
 * other key is kept as-is in `extra`, to show, never to interpret.
 */
import { parseDocument } from 'yaml';
import type { JsonValue } from '../types/json';

/** Frontmatter longer than this is ignored (the note is read without it). */
export const MAX_FRONTMATTER_CHARS = 64 * 1024;
/** Alias expansions allowed in one frontmatter block. */
const MAX_ALIASES = 20;

export const KNOWN_FRONTMATTER_KEYS = [
  'title',
  'source',
  'author',
  'published',
  'created',
  'description',
  'tags',
] as const;

export type Frontmatter = { [key: string]: JsonValue };

export interface ArticleMeta {
  title: string;
  source: string | null;
  author: string[];
  published: string | null;
  created: string | null;
  description: string | null;
  tags: string[];
  /** Every key that is not a known one, as read. */
  extra: Frontmatter;
}

export interface ParsedNote {
  meta: ArticleMeta;
  /** All frontmatter keys, as read (stored as `articles.frontmatter`). */
  frontmatter: Frontmatter;
  /** The Markdown after the frontmatter. */
  body: string;
  /** Why the frontmatter was ignored, if it was. */
  frontmatterError: string | null;
}

const FENCE = /^---[ \t]*$/;
const END = /^(?:---|\.\.\.)[ \t]*$/;

/**
 * Splits `---` frontmatter from the body. Without a closing `---` (or
 * `...`) line there is no frontmatter and the whole text is the body.
 */
export function splitFrontmatter(text: string): { yaml: string | null; body: string } {
  const src = text.startsWith('﻿') ? text.slice(1) : text;
  const firstEnd = src.indexOf('\n');
  const first = (firstEnd === -1 ? src : src.slice(0, firstEnd)).replace(/\r$/, '');
  if (!FENCE.test(first) || firstEnd === -1) return { yaml: null, body: src };
  let pos = firstEnd + 1;
  while (pos <= src.length) {
    const nl = src.indexOf('\n', pos);
    const line = (nl === -1 ? src.slice(pos) : src.slice(pos, nl)).replace(/\r$/, '');
    if (END.test(line)) {
      return { yaml: src.slice(firstEnd + 1, pos), body: nl === -1 ? '' : src.slice(nl + 1) };
    }
    if (nl === -1) break;
    pos = nl + 1;
  }
  return { yaml: null, body: src };
}

/** Plain JSON data from whatever the YAML produced. */
function toJson(v: unknown, depth = 0): JsonValue {
  if (depth > 32) return null;
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (typeof v === 'bigint') return v;
  if (Array.isArray(v)) return v.map((x) => toJson(x, depth + 1));
  if (v instanceof Map) {
    return Object.fromEntries([...v].map(([k, x]) => [String(k), toJson(x, depth + 1)]));
  }
  if (typeof v === 'object') {
    // `fromEntries` defines own properties, so a `__proto__` key stays a key.
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, toJson(x, depth + 1)]),
    );
  }
  return String(v);
}

/** Parses a frontmatter block. Never throws: bad YAML gives `{}` and an error. */
export function parseFrontmatter(yaml: string): { data: Frontmatter; error: string | null } {
  if (yaml.length > MAX_FRONTMATTER_CHARS) {
    return { data: {}, error: `frontmatter is over ${MAX_FRONTMATTER_CHARS} characters` };
  }
  if (!yaml.trim()) return { data: {}, error: null };
  try {
    const doc = parseDocument(yaml, {
      schema: 'core',
      customTags: [],
      merge: false,
      uniqueKeys: false,
      prettyErrors: false,
    });
    if (doc.errors.length) return { data: {}, error: doc.errors[0]!.message.split('\n')[0]! };
    const value = toJson(doc.toJS({ maxAliasCount: MAX_ALIASES }));
    if (value === null) return { data: {}, error: null };
    if (typeof value !== 'object' || Array.isArray(value)) {
      return { data: {}, error: 'frontmatter is not a list of properties' };
    }
    return { data: value as Frontmatter, error: null };
  } catch (e) {
    return { data: {}, error: e instanceof Error ? e.message.split('\n')[0]! : String(e) };
  }
}

function text(v: JsonValue | undefined): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean') return String(v);
  return null;
}

/** `[[Name]]` or `[[Name|Label]]` → `Name` / `Label`; anything else trimmed. */
function unlink(s: string): string {
  const m = /^\[\[([^\]|]*)(?:\|([^\]]*))?\]\]$/.exec(s.trim());
  if (!m) return s.trim();
  return (m[2] ?? m[1] ?? '').trim();
}

function list(v: JsonValue | undefined, split: RegExp): string[] {
  const items = Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
  const out: string[] = [];
  for (const item of items) {
    const s = text(item);
    if (!s) continue;
    for (const part of Array.isArray(v) ? [s] : s.split(split)) {
      const t = part.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

/** The note's file name without folders or `.md`. */
export function titleFromFileName(relPath: string): string {
  const name = relPath.split('/').pop() ?? relPath;
  return name.replace(/\.md$/i, '') || name;
}

/** The known keys, normalised; missing title → file name. */
export function articleMeta(data: Frontmatter, relPath: string): ArticleMeta {
  const extra: Frontmatter = {};
  for (const [k, v] of Object.entries(data)) {
    if (!(KNOWN_FRONTMATTER_KEYS as readonly string[]).includes(k)) extra[k] = v;
  }
  const tags = [
    ...new Set(
      list(data['tags'], /[,\s]+/)
        .map((t) => t.replace(/^#/, ''))
        .filter(Boolean),
    ),
  ];
  return {
    title: text(data['title']) ?? titleFromFileName(relPath),
    source: text(data['source']),
    author: list(data['author'], /,/).map(unlink).filter(Boolean),
    published: text(data['published']),
    created: text(data['created']),
    description: text(data['description']),
    tags,
    extra,
  };
}

/** Reads a note: frontmatter as data, known keys, and the body. */
export function parseNote(content: string, relPath: string): ParsedNote {
  const { yaml, body } = splitFrontmatter(content);
  const { data, error } = yaml === null ? { data: {}, error: null } : parseFrontmatter(yaml);
  return { meta: articleMeta(data, relPath), frontmatter: data, body, frontmatterError: error };
}
