/**
 * Read aloud (T37, SPEC §15.6): what to read from a rendered article body.
 * Blocks are headings, paragraphs, list items, quote lines, table cells and
 * definition terms; each block's text excludes the blocks nested inside it
 * (a list item's sub-list is read as its own blocks) and the parts not worth
 * reading: code blocks, image placeholders, buttons. Long blocks are split at
 * sentence ends into chunks, one utterance each: short utterances keep
 * Chromium's engines from stopping part way and let a speed change apply at
 * once.
 */

export const BLOCKS = 'h1, h2, h3, h4, h5, h6, p, li, td, th, dt, dd, figcaption';
const SKIP = 'pre, .img-placeholder, button, script, style, [aria-hidden="true"]';

/** Chunks longer than this are split at sentence ends (or, failing that, spaces). */
export const MAX_CHUNK = 240;

export interface SpeechBlock {
  el: HTMLElement;
  /** Spoken in order; never empty. */
  chunks: string[];
}

/** The text a block says: its own text nodes, not those of nested blocks or skipped parts. */
function ownText(el: HTMLElement): string {
  const parts: string[] = [];
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) parts.push(child.textContent ?? '');
      else if (child instanceof HTMLElement) {
        if (child.matches(SKIP) || child.matches(BLOCKS)) {
          parts.push(' ');
          continue;
        }
        if (child.tagName === 'BR') parts.push(' ');
        else walk(child);
      }
    }
  };
  walk(el);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/** Splits `text` into pieces of at most `max` characters, at sentence ends where it can. */
export function chunkText(text: string, max = MAX_CHUNK): string[] {
  const sentences = text.match(/[^.!?…]+(?:[.!?…]+["')\]”’]*\s*|$)/g) ?? [text];
  const out: string[] = [];
  let cur = '';
  const push = (s: string): void => {
    const t = s.trim();
    if (t) out.push(t);
  };
  for (const s of sentences) {
    if (cur && (cur + s).length > max) {
      push(cur);
      cur = '';
    }
    if (s.length <= max) {
      cur += s;
      continue;
    }
    // One sentence over the limit: split at spaces.
    let rest = s;
    while (rest.length > max) {
      let cut = rest.lastIndexOf(' ', max);
      if (cut <= 0) cut = max;
      push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    cur = rest;
  }
  push(cur);
  return out;
}

/** The blocks of `body` to read, in document order; blocks with nothing to say are left out. */
export function speechBlocks(body: HTMLElement): SpeechBlock[] {
  const out: SpeechBlock[] = [];
  for (const el of Array.from(body.querySelectorAll<HTMLElement>(BLOCKS))) {
    if (el.closest(SKIP)) continue;
    const text = ownText(el);
    if (!text) continue;
    out.push({ el, chunks: chunkText(text) });
  }
  return out;
}

/** The index of the block holding `node` (or the first block after it), or -1. */
export function blockAt(blocks: SpeechBlock[], node: Node | null): number {
  if (!node) return -1;
  const inside = blocks.findIndex((b) => b.el.contains(node));
  if (inside >= 0) {
    // The innermost block holding it (a paragraph inside a list item).
    let best = inside;
    for (let i = inside + 1; i < blocks.length; i++) {
      if (blocks[i]?.el.contains(node)) best = i;
    }
    return best;
  }
  return blocks.findIndex(
    (b) => !!(node.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING),
  );
}
