// @vitest-environment jsdom
// Ported from dsa-tutor/web/tests/markdown.test.tsx.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Markdown } from '../components/Markdown';
import { hasExamplesSection, renderMarkdown, statementForApp } from './markdown';

afterEach(cleanup);

declare global {
  var pwned: number | undefined;
}

const HOSTILE = `# Title

Some **bold** text and \`code\`.

<script>window.pwned = 1</script>

<img src='x' onerror='window.pwned = 2'>

Inline <img src=x onerror='window.pwned=3'> html and <b onclick='window.pwned=4'>bold</b>.

[click](javascript:window.pwned=5) and ![pic](javascript:window.pwned=6)

<iframe src='https://example.com'></iframe>

\`\`\`python
print("<script>still text</script>")
\`\`\`
`;

describe('sanitised Markdown', () => {
  it('renders a hostile statement inert', async () => {
    globalThis.pwned = undefined;
    const { container } = render(<Markdown source={HOSTILE} />);
    await new Promise((r) => setTimeout(r, 20)); // give any onerror a chance to fire
    expect(globalThis.pwned).toBeUndefined();
    expect(container.querySelector('script, iframe, img, object, embed, style')).toBeNull();
    for (const el of container.querySelectorAll('*')) {
      for (const attr of el.getAttributeNames()) expect(attr.startsWith('on')).toBe(false);
    }
    for (const a of container.querySelectorAll('a')) {
      expect(a.getAttribute('href') ?? '').not.toMatch(/javascript:/i);
    }
    expect(container.querySelector('h1')?.textContent).toBe('Title');
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    // Code blocks keep their text, escaped.
    expect(container.querySelector('pre code')?.textContent).toContain(
      '<script>still text</script>',
    );
  });

  it('keeps safe links with rel and target', () => {
    const html = renderMarkdown('[docs](https://example.org/x)');
    const div = document.createElement('div');
    div.innerHTML = html;
    const a = div.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://example.org/x');
    expect(a.getAttribute('rel')).toContain('noopener');
  });

  it('drops the CLI-only solution section', () => {
    const md =
      '# T\n\n**Topic:** Hashing · **Difficulty:** Easy\n\nBody\n\n## Examples\n\nx\n\n## Signature\n\nsig\n\n## Your solution\n\nWrite it in `workspace/t/solution.py`\n';
    const out = statementForApp(md);
    expect(out).toContain('## Signature');
    expect(out).not.toContain('Your solution');
    expect(out).not.toContain('**Topic:**');
    expect(out).toContain('Body');
    expect(hasExamplesSection(out)).toBe(true);
    expect(hasExamplesSection('# T\n\nno examples')).toBe(false);
  });
});
