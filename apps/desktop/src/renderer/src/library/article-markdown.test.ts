// @vitest-environment jsdom
/**
 * The article sanitiser (T22, SPEC §15.2): raw HTML dropped, scripts and
 * handlers gone, `img` only with app asset URLs, links only https/http/
 * mailto (and in-app library links); wikilinks, image embeds and callouts.
 */
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../lib/markdown';
import { renderArticle, sanitizeArticle, type ArticleRefs } from './article-markdown';

const ASSET = 'tutor-app://app/library-asset/abcdefghijklmnop0123';
const REFS: ArticleRefs = {
  images: {
    'photo.png': { kind: 'asset', url: ASSET },
    'pics/a b.png': { kind: 'asset', url: ASSET },
    'https://cdn.example.com/x.png': { kind: 'blocked', reason: 'remote', host: 'cdn.example.com' },
    'file:///etc/x.png': { kind: 'blocked', reason: 'scheme', host: null },
    // A broken main could never do this, but the second layer still holds.
    'evil.png': { kind: 'asset', url: 'https://evil.example/x.png' },
  },
  links: { 'Other note': 'id-2', Missing: null },
};

const dom = (html: string): HTMLElement => {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d;
};

describe('sanitising an article', () => {
  it('drops raw HTML, scripts and event handlers', () => {
    const html = renderArticle(
      [
        '<script>alert(1)</script>',
        '<img src=x onerror="alert(1)">',
        '<div onclick="x()">clipped <b>bold</b></div>',
        '<iframe src="https://evil.example"></iframe>',
        'text <span style="color:red">inline</span> after',
      ].join('\n\n'),
      REFS,
    );
    const d = dom(html);
    expect(
      d.querySelector('script, iframe, img, div, b, [onerror], [onclick], [style]'),
    ).toBeNull();
    expect(html).not.toMatch(/alert|onerror|onclick/);
    expect(d.textContent).toContain('text');
    expect(d.textContent).toContain('after');
  });

  it('keeps https, http and mailto links; removes javascript: and others', () => {
    const d = dom(
      renderArticle(
        '[a](https://example.com) [b](http://example.com) [c](mailto:a@example.com) ' +
          '[d](javascript:alert(1)) [e](file:///etc/passwd) [f](data:text/html,x) ' +
          `[g](${ASSET}) [h](tutor-app://app/renderer/index.html)`,
        REFS,
      ),
    );
    const hrefs = [...d.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      'https://example.com',
      'http://example.com',
      'mailto:a@example.com',
      null,
      null,
      null,
      null,
      null,
    ]);
    for (const a of d.querySelectorAll('a')) expect(a.getAttribute('target')).toBeNull();
  });

  it('shows images only with asset URLs; others are placeholders with alt and host', () => {
    const d = dom(
      renderArticle(
        '![local](photo.png) ![[photo.png|300]] ![sp](<pics/a b.png>) ' +
          '![remote](https://cdn.example.com/x.png) ![file](file:///etc/x.png) ' +
          '![evil](evil.png) ![data](data:image/png;base64,AAAA) ![none](nowhere.png)',
        REFS,
      ),
    );
    const imgs = [...d.querySelectorAll('img')];
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual([ASSET, ASSET, ASSET]);
    expect(imgs[1]!.getAttribute('width')).toBe('300');
    const ph = [...d.querySelectorAll('.img-placeholder')].map((p) => p.textContent);
    expect(ph).toEqual([
      'remote · cdn.example.com (linked image, not downloaded)',
      'file (not loaded: unsupported link)',
      'evil (image not found)',
      'data (image not found)',
      'none (image not found)',
    ]);
  });

  it('the second layer removes an img that is not an asset URL', () => {
    const d = dom(
      sanitizeArticle(
        `<p><img src="https://evil.example/a.png" alt="r"><img src="file:///etc/a.png" alt="f">` +
          `<img src="${ASSET}" alt="ok" onerror="alert(1)" width="x"></p>`,
      ),
    );
    expect([...d.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual([ASSET]);
    expect(d.querySelector('img')!.getAttribute('onerror')).toBeNull();
    expect(d.querySelector('img')!.getAttribute('width')).toBeNull();
    expect(d.querySelectorAll('.img-placeholder')).toHaveLength(2);
  });

  it('chat Markdown still renders no images', () => {
    expect(renderMarkdown(`![x](${ASSET})`)).not.toContain('<img');
  });
});

describe('Obsidian syntax', () => {
  it('renders wikilinks to library notes, and others as plain text', () => {
    const d = dom(
      renderArticle(
        '[[Other note]] [[Other note|label]] [[Other note#Part]] [[Missing]] ![[Other note]]',
        REFS,
      ),
    );
    const links = [...d.querySelectorAll('a.wikilink')];
    expect(links.map((a) => [a.getAttribute('href'), a.textContent])).toEqual([
      ['#/library/id-2', 'Other note'],
      ['#/library/id-2', 'label'],
      ['#/library/id-2', 'Other note › Part'],
      ['#/library/id-2', 'Other note'],
    ]);
    expect(d.querySelector('.wikilink.embed')!.tagName).toBe('A');
    expect(d.querySelector('.unresolved')!.textContent).toBe('Missing');
    expect(d.querySelector('.unresolved')!.tagName).toBe('SPAN');
  });

  it('renders callouts as styled blockquotes', () => {
    const d = dom(
      renderArticle(
        '> [!warning] Mind the gap\n> Body **text**.\n\n> [!note]\n> Plain.\n\n> quote',
        REFS,
      ),
    );
    const [w, n, q] = [...d.querySelectorAll('blockquote')];
    expect(w!.className).toBe('callout callout-warning');
    expect(w!.querySelector('.callout-title')!.textContent).toBe('Mind the gap');
    expect(w!.textContent).toContain('Body text.');
    expect(w!.textContent).not.toContain('[!warning]');
    expect(n!.querySelector('.callout-title')!.textContent).toBe('Note');
    expect(n!.textContent).toContain('Plain.');
    expect(q!.className).toBe('');
  });

  it('leaves wikilinks in code as written', () => {
    const d = dom(renderArticle('`[[Other note]]`\n\n```\n![[photo.png]]\n```', REFS));
    expect(d.querySelector('a, img')).toBeNull();
    expect(d.textContent).toContain('[[Other note]]');
  });
});
