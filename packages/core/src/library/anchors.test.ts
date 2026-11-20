import { describe, expect, it } from 'vitest';
import {
  anchorFromHeading,
  anchorFromRange,
  markdownDoc,
  MAX_SECTION,
  outline,
  parseAnchor,
  resolveAnchor,
  sectionText,
  type AnchorDoc,
} from './anchors';

const ARTICLE = `Lead paragraph before any heading.

# Heaps

A heap keeps the smallest item on top. Push and pop take O(log n).

## Binary heaps

Stored in an array. The smallest item on top is at index 0.

\`\`\`
# not a heading
\`\`\`

## Uses

Priority queues. The smallest item on top is what Dijkstra needs.

# Tries

A trie stores strings by prefix.
`;

function rangeOf(doc: AnchorDoc, text: string, nth = 0): [number, number] {
  let at = -1;
  for (let i = 0; i <= nth; i++) at = doc.text.indexOf(text, at + 1);
  if (at < 0) throw new Error(`no ${text}`);
  return [at, at + text.length];
}

describe('markdownDoc', () => {
  it('finds ATX headings outside code, with levels and plain titles', () => {
    const doc = markdownDoc('# A *b* [c](d)\n```\n# no\n```\n### [[x|Y]] ##\n');
    expect(doc.headings.map((h) => [h.level, h.title])).toEqual([
      [1, 'A b c'],
      [3, 'Y'],
    ]);
    expect(outline(doc)).toBe('- A b c\n    - Y');
  });
});

describe('anchors', () => {
  const doc = markdownDoc(ARTICLE);

  it('record the heading path, the quote and 32 characters each side', () => {
    const [s, e] = rangeOf(doc, 'Stored in an array.');
    const a = anchorFromRange(doc, s, e);
    expect(a).toMatchObject({ kind: 'quote', heading: ['Heaps', 'Binary heaps'] });
    expect(a.quote).toBe('Stored in an array.');
    expect(a.prefix.length).toBeLessThanOrEqual(32);
    expect(a.suffix).toBe(' The smallest item on top is at ');
  });

  it('survive edits around the passage', () => {
    const [s, e] = rangeOf(doc, 'Push and pop take O(log n).');
    const a = anchorFromRange(doc, s, e);
    const edited = markdownDoc(
      ARTICLE.replace('Lead paragraph', 'A new, much longer lead paragraph\n\nwith more text')
        .replace('A heap keeps', 'Intro added. A heap keeps')
        .replace('# Tries', '# Tries and more'),
    );
    const r = resolveAnchor(edited, a);
    expect(r.state).toBe('quote');
    expect(edited.text.slice(r.start, r.end)).toBe('Push and pop take O(log n).');
    expect(edited.headings[r.heading!]!.title).toBe('Heaps');
  });

  it('pick the right one of repeated quotes', () => {
    for (const nth of [0, 1, 2]) {
      const [s, e] = rangeOf(doc, 'smallest item on top', nth);
      const a = anchorFromRange(doc, s, e);
      const moved = markdownDoc(`Preface.\n\n${ARTICLE}`);
      const r = resolveAnchor(moved, a);
      expect(r.state).toBe('quote');
      expect(r.start).toBe(rangeOf(moved, 'smallest item on top', nth)[0]);
    }
  });

  it('match across different whitespace (DOM text against Markdown)', () => {
    const [s, e] = rangeOf(doc, 'Push and pop take O(log n).');
    const a = anchorFromRange(doc, s, e);
    const rewrapped = markdownDoc(ARTICLE.replace('Push and pop take', 'Push and\n   pop take'));
    expect(resolveAnchor(rewrapped, a).state).toBe('quote');
  });

  it('fall back to the heading when the quote is gone', () => {
    const [s, e] = rangeOf(doc, 'Stored in an array.');
    const a = anchorFromRange(doc, s, e);
    const edited = markdownDoc(ARTICLE.replace('Stored in an array.', 'Kept in a vector.'));
    const r = resolveAnchor(edited, a);
    expect(r.state).toBe('heading');
    expect(edited.headings[r.heading!]!.title).toBe('Binary heaps');
  });

  it('detach cleanly when the quote and the heading are gone', () => {
    const [s, e] = rangeOf(doc, 'Stored in an array.');
    const a = anchorFromRange(doc, s, e);
    const r = resolveAnchor(markdownDoc('# Something else\n\nNo heaps here.\n'), a);
    expect(r).toEqual({ state: 'detached', start: -1, end: -1, heading: null });
  });

  it('of a heading resolve to it, also after it moved', () => {
    const a = anchorFromHeading(doc, 2);
    expect(a).toEqual({
      kind: 'heading',
      heading: ['Heaps', 'Uses'],
      quote: '',
      prefix: '',
      suffix: '',
    });
    const moved = markdownDoc(`# New first\n\nText.\n\n${ARTICLE}`);
    const r = resolveAnchor(moved, a);
    expect(r.state).toBe('heading');
    expect(moved.headings[r.heading!]!.title).toBe('Uses');
  });

  it('parse stored JSON as data only', () => {
    const a = anchorFromHeading(doc, 0);
    expect(parseAnchor(JSON.parse(JSON.stringify(a)))).toEqual(a);
    expect(parseAnchor({ ...a, kind: 'x' })).toBeNull();
    expect(parseAnchor({ ...a, heading: [1] })).toBeNull();
    expect(parseAnchor({ ...a, quote: 'x'.repeat(5000) })).toBeNull();
    expect(parseAnchor(null)).toBeNull();
  });
});

describe('sections', () => {
  const doc = markdownDoc(ARTICLE);

  it('run to the next heading of the same or a higher level', () => {
    const s = sectionText(doc, 0);
    expect(s.heading).toEqual(['Heaps']);
    expect(s.text).toContain('Priority queues.');
    expect(s.text).not.toContain('A trie');
    expect(sectionText(doc, 1).text).not.toContain('Priority queues.');
    expect(sectionText(doc, null).text).toBe('Lead paragraph before any heading.');
  });

  it('are capped, keeping a window around the passage', () => {
    const long = `# Big\n\n${'filler text. '.repeat(2000)}NEEDLE here.${' more text.'.repeat(2000)}\n# Next\n`;
    const d = markdownDoc(long);
    const at = long.indexOf('NEEDLE');
    const s = sectionText(d, 0, at);
    expect(s.truncated).toBe(true);
    expect(s.text.length).toBe(MAX_SECTION);
    expect(s.text).toContain('NEEDLE here.');
  });
});
