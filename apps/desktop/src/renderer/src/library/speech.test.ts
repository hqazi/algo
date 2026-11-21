// @vitest-environment jsdom
/** Read aloud (T37): which blocks of an article body are read, and how they are chunked. */
import { describe, expect, it } from 'vitest';
import { blockAt, chunkText, speechBlocks } from './speech';

function body(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

describe('speechBlocks', () => {
  it('reads headings, paragraphs, list items, quotes and cells, in order', () => {
    const b = body(
      '<h1>Title</h1><p>One <em>two</em> <code>x</code>.</p>' +
        '<ul><li>First</li><li><p>Second</p></li></ul>' +
        '<blockquote class="callout"><p class="callout-title">Note</p><p>Quoted</p></blockquote>' +
        '<table><tr><th>K</th><td>V</td></tr></table>',
    );
    expect(speechBlocks(b).map((x) => x.chunks.join(' '))).toEqual([
      'Title',
      'One two x.',
      'First',
      'Second',
      'Note',
      'Quoted',
      'K',
      'V',
    ]);
  });

  it('reads a list item without its sub-list, then the sub-list items', () => {
    const b = body('<ul><li>Parent<ul><li>Child</li></ul></li></ul>');
    expect(speechBlocks(b).map((x) => x.chunks[0])).toEqual(['Parent', 'Child']);
  });

  it('skips code blocks, image placeholders and buttons', () => {
    const b = body(
      '<pre><code>print(1)</code></pre>' +
        '<p>Text <span class="img-placeholder"><span class="img-alt">Pic</span></span>after</p>' +
        '<p><button>Retry</button></p>',
    );
    expect(speechBlocks(b).map((x) => x.chunks[0])).toEqual(['Text after']);
  });

  it('turns line breaks and runs of space into single spaces', () => {
    const b = body('<p>a<br>b\n\n   c</p>');
    expect(speechBlocks(b)[0]?.chunks).toEqual(['a b c']);
  });
});

describe('chunkText', () => {
  it('keeps short text whole', () => {
    expect(chunkText('One. Two.')).toEqual(['One. Two.']);
  });

  it('splits at sentence ends under the limit', () => {
    expect(chunkText('Aaaa aaaa. Bbbb bbbb. Cccc.', 12)).toEqual([
      'Aaaa aaaa.',
      'Bbbb bbbb.',
      'Cccc.',
    ]);
  });

  it('splits a sentence over the limit at spaces', () => {
    const parts = chunkText('word '.repeat(30).trim(), 20);
    expect(parts.every((p) => p.length <= 20)).toBe(true);
    expect(parts.join(' ')).toBe('word '.repeat(30).trim());
  });
});

describe('blockAt', () => {
  it('finds the innermost block holding a node', () => {
    const b = body('<ul><li>Parent<ul><li>Child <b>here</b></li></ul></li></ul><p>After</p>');
    const blocks = speechBlocks(b);
    const here = b.querySelector('b')?.firstChild ?? null;
    expect(blockAt(blocks, here)).toBe(1);
  });

  it('takes the next block for a node between blocks', () => {
    const b = body('<p>One</p><hr><p>Two</p>');
    const blocks = speechBlocks(b);
    expect(blockAt(blocks, b.querySelector('hr'))).toBe(1);
    expect(blockAt(blocks, null)).toBe(-1);
  });
});
