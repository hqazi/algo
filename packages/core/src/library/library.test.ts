import { describe, expect, it } from 'vitest';
// Made by hand in the shape of the Web Clipper's default template (D-39).
import clipped from './fixtures/clipped-default.md?raw';
import {
  articleMeta,
  buildTree,
  isNoteFile,
  isSkippedName,
  parseFrontmatter,
  parseNote,
  planScan,
  splitFrontmatter,
  type IndexedArticle,
} from '.';

describe('frontmatter', () => {
  it('reads the clipper default template', () => {
    const n = parseNote(clipped, 'Clippings/Binary search, step by step.md');
    expect(n.frontmatterError).toBeNull();
    expect(n.meta).toEqual({
      title: 'Binary search, step by step',
      source: 'https://example.com/articles/binary-search',
      author: ['Ada Example', 'Sam Sample'],
      published: '2026-10-02',
      created: '2026-11-20',
      description:
        "A hand-made sample in the shape of a note saved by the Obsidian Web Clipper's default template.",
      tags: ['clippings'],
      extra: {},
    });
    expect(n.frontmatter['author']).toEqual(['[[Ada Example]]', '[[Sam Sample]]']);
    expect(n.body.startsWith('Binary search halves')).toBe(true);
    expect(n.body).toContain('![A sorted array');
  });

  it('falls back to the file name and keeps unknown keys', () => {
    const n = parseNote('---\nrating: 4\nnested: {a: [1, 2]}\n---\nBody', 'a/b/My note.md');
    expect(n.meta.title).toBe('My note');
    expect(n.meta.extra).toEqual({ rating: 4, nested: { a: [1, 2] } });
    expect(parseNote('No frontmatter', 'x.MD').meta.title).toBe('x');
  });

  it('accepts tags as a string, strips #, and dedupes', () => {
    expect(articleMeta({ tags: '#a, b  #a' }, 'n.md').tags).toEqual(['a', 'b']);
    expect(articleMeta({ tags: ['x', '#y', 'x'] }, 'n.md').tags).toEqual(['x', 'y']);
    expect(articleMeta({ author: '[[A|Ann]], B' }, 'n.md').author).toEqual(['Ann', 'B']);
  });

  it('parses as data only: no custom tags, no timestamps, capped aliases', () => {
    const tagged = parseFrontmatter('f: !!js/function "function () { return 1 }"\nd: 2026-01-02');
    expect(typeof tagged.data['f']).toBe('string');
    expect(tagged.data['d']).toBe('2026-01-02');
    const bomb =
      'a: &a [x, x, x, x, x, x, x, x, x]\nb: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a]\n' +
      'c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b]\nd: [*c, *c, *c, *c, *c, *c, *c, *c, *c]\n';
    const r = parseFrontmatter(bomb);
    expect(r.data).toEqual({});
    expect(r.error).toMatch(/alias/i);
    const proto = parseFrontmatter('__proto__: {polluted: true}');
    expect(Object.getPrototypeOf(proto.data)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('reports bad YAML and non-map frontmatter without throwing', () => {
    expect(parseNote('---\na: [1\n---\nbody', 'n.md')).toMatchObject({
      frontmatter: {},
      body: 'body',
      meta: { title: 'n' },
    });
    expect(parseNote('---\na: [1\n---\nbody', 'n.md').frontmatterError).toBeTruthy();
    expect(parseFrontmatter('- 1\n- 2').error).toMatch(/not a list of properties/);
  });

  it('splits only a closed --- block at the start', () => {
    expect(splitFrontmatter('---\na: 1\n---\nx')).toEqual({ yaml: 'a: 1\n', body: 'x' });
    expect(splitFrontmatter('﻿---\r\na: 1\r\n...\r\nx')).toEqual({
      yaml: 'a: 1\r\n',
      body: 'x',
    });
    expect(splitFrontmatter('---\na: 1\nno end')).toEqual({
      yaml: null,
      body: '---\na: 1\nno end',
    });
    expect(splitFrontmatter('text\n---\na: 1\n---\n').yaml).toBeNull();
    expect(splitFrontmatter('---\n---')).toEqual({ yaml: '', body: '' });
  });
});

describe('scan rules', () => {
  it('skips dot-entries and keeps only .md files', () => {
    expect(['.obsidian', '.trash', '.git'].every(isSkippedName)).toBe(true);
    expect(isSkippedName('Clippings')).toBe(false);
    expect(isNoteFile('a.md')).toBe(true);
    expect(isNoteFile('A.MD')).toBe(true);
    expect(isNoteFile('a.png')).toBe(false);
    expect(isNoteFile('.hidden.md')).toBe(false);
  });
});

describe('planScan', () => {
  const row = (id: string, relPath: string, hash: string, extra: Partial<IndexedArticle> = {}) => ({
    id,
    relPath,
    contentHash: hash,
    sourceUrl: null,
    missingSince: null,
    ...extra,
  });
  const note = (relPath: string, hash: string, sourceUrl: string | null = null) => ({
    relPath,
    contentHash: hash,
    sourceUrl,
  });

  it('inserts new notes and updates ones at the same path', () => {
    const p = planScan([row('1', 'a.md', 'h1')], [note('a.md', 'h1b'), note('b.md', 'h2')]);
    expect(p.update).toEqual([{ id: '1', note: note('a.md', 'h1b'), moved: false }]);
    expect(p.insert).toEqual([note('b.md', 'h2')]);
    expect(p.missing).toEqual([]);
  });

  it('moves by hash, then by source, keeping the id', () => {
    const p = planScan(
      [row('1', 'a.md', 'h1'), row('2', 'b.md', 'h2', { sourceUrl: 'https://s' })],
      [note('x/a.md', 'h1'), note('y/b.md', 'edited', 'https://s')],
    );
    expect(p.update).toEqual([
      { id: '1', note: note('x/a.md', 'h1'), moved: true },
      { id: '2', note: note('y/b.md', 'edited', 'https://s'), moved: true },
    ]);
    expect(p.insert).toEqual([]);
  });

  it('marks a gone file missing once, and revives it when it returns', () => {
    const gone = planScan([row('1', 'a.md', 'h1')], []);
    expect(gone.missing).toEqual(['1']);
    expect(planScan([row('1', 'a.md', 'h1', { missingSince: 't' })], []).missing).toEqual([]);
    const back = planScan([row('1', 'a.md', 'h1', { missingSince: 't' })], [note('a.md', 'h1')]);
    expect(back.update).toEqual([{ id: '1', note: note('a.md', 'h1'), moved: false }]);
  });

  it('uses each old article once when copies share a hash', () => {
    const p = planScan([row('1', 'a.md', 'h')], [note('b.md', 'h'), note('c.md', 'h')]);
    expect(p.update).toEqual([{ id: '1', note: note('b.md', 'h'), moved: true }]);
    expect(p.insert).toEqual([note('c.md', 'h')]);
  });

  it('prefers the same file name among copies', () => {
    const p = planScan([row('1', 'a.md', 'h'), row('2', 'b.md', 'h')], [note('x/b.md', 'h')]);
    expect(p.update).toEqual([{ id: '2', note: note('x/b.md', 'h'), moved: true }]);
    expect(p.missing).toEqual(['1']);
  });
});

describe('buildTree', () => {
  it('nests folders, folders first, articles by title', () => {
    const t = buildTree([
      { id: '1', relPath: 'b.md', title: 'Zeta', tags: [], missing: false },
      { id: '2', relPath: 'Clippings/x.md', title: 'beta', tags: ['t'], missing: false },
      { id: '3', relPath: 'Clippings/y.md', title: 'Alpha', tags: [], missing: true },
      { id: '4', relPath: 'a.md', title: 'eta', tags: [], missing: false },
    ]);
    expect(t.articles.map((a) => a.title)).toEqual(['eta', 'Zeta']);
    expect(t.folders.map((f) => f.name)).toEqual(['Clippings']);
    expect(t.folders[0]!.articles.map((a) => [a.title, a.missing])).toEqual([
      ['Alpha', true],
      ['beta', false],
    ]);
  });
});
