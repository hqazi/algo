/**
 * Anchors: where a chat about an article sits in it (SPEC §15.5). Pure.
 *
 * An anchor is the heading path of the passage plus a text quote with up to
 * 32 characters of context on each side (the W3C text-quote selector idea),
 * all whitespace-normalised. It is made and resolved against an
 * `AnchorDoc`: a text with its headings at offsets into it. The renderer
 * builds one from the reader's DOM (selection, margin markers); main builds
 * one from the Markdown (`markdownDoc`) to find the section a turn sends.
 *
 * Resolution: the exact quote (one match), then prefix/suffix (and the
 * heading) to pick between repeats, then the heading alone; otherwise the
 * thread is detached.
 */

export const ANCHOR_CONTEXT = 32;
export const MAX_QUOTE = 1000;
export const MAX_SECTION = 8000;

export interface Anchor {
  /** `quote`: a selection; `heading`: a heading's margin button. */
  kind: 'quote' | 'heading';
  /** Heading titles from the top down to the passage's heading; `[]` before the first heading. */
  heading: string[];
  /** The selected text, whitespace-normalised (`''` for a heading anchor). */
  quote: string;
  prefix: string;
  suffix: string;
}

export interface DocHeading {
  level: number;
  /** Whitespace-normalised. */
  title: string;
  /** Offset of the heading in `text`. */
  start: number;
}

export interface AnchorDoc {
  text: string;
  /** In document order. */
  headings: DocHeading[];
}

export type AnchorState = 'quote' | 'heading' | 'detached';

export interface Resolved {
  state: AnchorState;
  /** Offsets into the doc's `text` (the quote, or the heading); `-1` when detached. */
  start: number;
  end: number;
  /** Index into `headings` of the passage's heading, if any. */
  heading: number | null;
}

export const normalizeSpace = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** `text` with whitespace runs collapsed to one space, and each kept char's offset in `text`. */
function normalized(text: string): { text: string; map: number[] } {
  let out = '';
  const map: number[] = [];
  let space = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      if (!space && out.length > 0) {
        out += ' ';
        map.push(i);
      }
      space = true;
    } else {
      out += ch;
      map.push(i);
      space = false;
    }
  }
  map.push(text.length);
  return { text: out, map };
}

/** Offset in normalised text of the first kept char at or after `offset`. */
function toNorm(map: number[], offset: number): number {
  let lo = 0;
  let hi = map.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (map[mid]! < offset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of the heading the offset sits under, or `null`. */
export function headingAt(doc: AnchorDoc, offset: number): number | null {
  let found: number | null = null;
  for (const [i, h] of doc.headings.entries()) {
    if (h.start <= offset) found = i;
    else break;
  }
  return found;
}

/** The titles from the top-level heading down to heading `index`. */
export function headingPath(doc: AnchorDoc, index: number | null): string[] {
  if (index === null) return [];
  const path: DocHeading[] = [];
  for (const h of doc.headings.slice(0, index + 1)) {
    while (path.length && path[path.length - 1]!.level >= h.level) path.pop();
    path.push(h);
  }
  return path.map((h) => h.title);
}

const sameTitle = (a: string, b: string): boolean =>
  normalizeSpace(a).toLowerCase() === normalizeSpace(b).toLowerCase();

/** The heading a path names: full path first, then the last title alone. `null` if none. */
export function findHeading(doc: AnchorDoc, path: readonly string[]): number | null {
  if (!path.length) return null;
  const last = path[path.length - 1]!;
  let loose: number | null = null;
  for (const [i, h] of doc.headings.entries()) {
    if (!sameTitle(h.title, last)) continue;
    const p = headingPath(doc, i);
    if (p.length === path.length && p.every((t, j) => sameTitle(t, path[j]!))) return i;
    loose ??= i;
  }
  return loose;
}

/** An anchor for the text between `start` and `end` (offsets into `doc.text`). */
export function anchorFromRange(doc: AnchorDoc, start: number, end: number): Anchor {
  const n = normalized(doc.text);
  const a = toNorm(n.map, start);
  let b = toNorm(n.map, end);
  while (b > a && n.text[b - 1] === ' ') b--;
  const quote = n.text.slice(a, Math.min(b, a + MAX_QUOTE)).trim();
  const qEnd = a + quote.length;
  return {
    kind: 'quote',
    heading: headingPath(doc, headingAt(doc, start)),
    quote,
    prefix: n.text.slice(Math.max(0, a - ANCHOR_CONTEXT), a),
    suffix: n.text.slice(qEnd, qEnd + ANCHOR_CONTEXT),
  };
}

/** An anchor for heading `index` (its margin button). */
export function anchorFromHeading(doc: AnchorDoc, index: number): Anchor {
  return { kind: 'heading', heading: headingPath(doc, index), quote: '', prefix: '', suffix: '' };
}

function commonSuffix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** Where an anchor is in a document now. */
export function resolveAnchor(doc: AnchorDoc, anchor: Anchor): Resolved {
  const heading = (): Resolved => {
    const h = findHeading(doc, anchor.heading);
    if (h === null) return { state: 'detached', start: -1, end: -1, heading: null };
    const at = doc.headings[h]!.start;
    return { state: 'heading', start: at, end: at, heading: h };
  };
  const quote = normalizeSpace(anchor.quote);
  if (anchor.kind === 'heading' || !quote) return heading();

  const n = normalized(doc.text);
  const hits: number[] = [];
  for (let i = n.text.indexOf(quote); i >= 0; i = n.text.indexOf(quote, i + 1)) hits.push(i);
  if (!hits.length) return heading();

  let best = hits[0]!;
  if (hits.length > 1) {
    const prefix = normalizeSpace(anchor.prefix);
    const suffix = normalizeSpace(anchor.suffix);
    let bestScore = -1;
    for (const h of hits) {
      const before = n.text.slice(Math.max(0, h - ANCHOR_CONTEXT - 1), h).trimEnd();
      const after = n.text
        .slice(h + quote.length, h + quote.length + ANCHOR_CONTEXT + 1)
        .trimStart();
      let score = commonSuffix(before, prefix) + commonPrefix(after, suffix);
      const path = headingPath(doc, headingAt(doc, n.map[h]!));
      if (
        path.length === anchor.heading.length &&
        path.every((t, j) => sameTitle(t, anchor.heading[j]!))
      )
        score += ANCHOR_CONTEXT / 2;
      if (score > bestScore) {
        bestScore = score;
        best = h;
      }
    }
  }
  const start = n.map[best]!;
  const end = n.map[best + quote.length - 1]! + 1;
  return { state: 'quote', start, end, heading: headingAt(doc, start) };
}

// ---------------------------------------------------------------- Markdown

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;

/** Heading text without the common inline Markdown. */
export function plainHeading(md: string): string {
  return normalizeSpace(
    md
      .replace(/!?\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_m, a: string, b?: string) => b ?? a)
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`~]+/g, ''),
  );
}

/** The Markdown body as an `AnchorDoc`: ATX headings outside fenced code. */
export function markdownDoc(body: string): AnchorDoc {
  const headings: DocHeading[] = [];
  let fence: string | null = null;
  let offset = 0;
  for (const line of body.split('\n')) {
    const f = FENCE.exec(line);
    if (fence) {
      if (f && f[1]![0] === fence[0] && f[1]!.length >= fence.length) fence = null;
    } else if (f) {
      fence = f[1]!;
    } else {
      const m = ATX.exec(line);
      const title = m ? plainHeading(m[2] ?? '') : '';
      if (m && title) headings.push({ level: m[1]!.length, title, start: offset });
    }
    offset += line.length + 1;
  }
  return { text: body, headings };
}

/** The headings as an indented list (the outline a turn sends). */
export function outline(doc: AnchorDoc, max = 200): string {
  const lines = doc.headings
    .slice(0, max)
    .map((h) => `${'  '.repeat(Math.max(0, h.level - 1))}- ${h.title}`);
  if (doc.headings.length > max) lines.push(`- … (${doc.headings.length - max} more headings)`);
  return lines.join('\n');
}

/** Offsets of heading `index`'s section (to the next heading of the same or a higher level); `null`: the lead. */
export function sectionRange(doc: AnchorDoc, index: number | null): { start: number; end: number } {
  if (index === null) return { start: 0, end: doc.headings[0]?.start ?? doc.text.length };
  const h = doc.headings[index]!;
  const next = doc.headings.slice(index + 1).find((x) => x.level <= h.level);
  return { start: h.start, end: next?.start ?? doc.text.length };
}

export interface Section {
  heading: string[];
  text: string;
  truncated: boolean;
}

/**
 * The section around `focus` (an offset, or the section's start), capped at
 * `max` characters: a long section is cut to a window around the focus.
 */
export function sectionText(
  doc: AnchorDoc,
  index: number | null,
  focus?: number,
  max = MAX_SECTION,
): Section {
  const { start, end } = sectionRange(doc, index);
  const heading = headingPath(doc, index);
  const full = doc.text.slice(start, end).trim();
  if (full.length <= max) return { heading, text: full, truncated: false };
  const at = focus !== undefined && focus >= start && focus < end ? focus - start : 0;
  const from = Math.max(0, Math.min(at - Math.floor(max / 3), end - start - max));
  return { heading, text: doc.text.slice(start + from, start + from + max), truncated: true };
}

/** A stored anchor (JSON) checked as data; `null` if it is not one. */
export function parseAnchor(v: unknown): Anchor | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const str = (x: unknown, max: number): string | null =>
    typeof x === 'string' && x.length <= max ? x : null;
  const kind = o.kind === 'quote' || o.kind === 'heading' ? o.kind : null;
  const quote = str(o.quote, MAX_QUOTE);
  const prefix = str(o.prefix, ANCHOR_CONTEXT * 4);
  const suffix = str(o.suffix, ANCHOR_CONTEXT * 4);
  const heading =
    Array.isArray(o.heading) &&
    o.heading.length <= 6 &&
    o.heading.every((t) => typeof t === 'string' && t.length <= 500)
      ? (o.heading as string[])
      : null;
  if (!kind || quote === null || prefix === null || suffix === null || !heading) return null;
  return { kind, heading: [...heading], quote, prefix, suffix };
}
