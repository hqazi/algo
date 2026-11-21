import { describe, expect, it } from 'vitest';
import { entryNameProblem, isWithin, noteFileName, parentPath, pathParts } from './files';

describe('library entry names (T42)', () => {
  it('accepts ordinary names', () => {
    for (const n of ['Compilers', 'Part 1 — Lexing', 'notes.md', 'Ünïcode', 'a b'])
      expect(entryNameProblem(n)).toBeNull();
  });

  it('refuses names that escape, hide or break on some system', () => {
    for (const n of [
      '',
      '.',
      '..',
      '.obsidian',
      'a/b',
      'a\\b',
      ' lead',
      'trail ',
      'dot.',
      'q?',
      'x:y',
      'CON',
      'nul.txt',
      'a\u0000b',
      '[[x]]',
      'x'.repeat(121),
    ])
      expect(entryNameProblem(n), n).not.toBeNull();
  });

  it('splits paths and refuses traversal', () => {
    expect(pathParts('')).toEqual([]);
    expect(pathParts('a/b c/d.md')).toEqual(['a', 'b c', 'd.md']);
    for (const p of ['/a', 'a/', 'a//b', '../a', 'a/../b', 'a/./b', '.git/x', 'C:/x'])
      expect(pathParts(p), p).toBeNull();
    expect(pathParts(Array(33).fill('a').join('/'))).toBeNull();
  });

  it('knows parents and containment', () => {
    expect(parentPath('a/b/c.md')).toBe('a/b');
    expect(parentPath('c.md')).toBe('');
    expect(isWithin('a/b', 'a')).toBe(true);
    expect(isWithin('a', 'a')).toBe(true);
    expect(isWithin('ab', 'a')).toBe(false);
    expect(isWithin('x', '')).toBe(true);
  });
});

describe('noteFileName (T43)', () => {
  const none = () => false;
  it('keeps the title readable and safe', () => {
    expect(noteFileName('Binary heaps: why?', none)).toBe('Binary heaps why.md');
    expect(noteFileName('  ..hidden. ', none)).toBe('hidden.md');
    expect(noteFileName('a/b\\c', none)).toBe('a b c.md');
    expect(noteFileName('???', none)).toBe('Article.md');
    expect(noteFileName('CON', none)).toBe('CON note.md');
    expect(noteFileName('Lexing', none, '01 ')).toBe('01 Lexing.md');
    expect(entryNameProblem(noteFileName('x'.repeat(500), none))).toBeNull();
  });

  it('is unique', () => {
    const taken = new Set(['Heaps.md', 'Heaps 2.md']);
    expect(noteFileName('Heaps', (n) => taken.has(n))).toBe('Heaps 3.md');
  });
});
