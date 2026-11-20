/**
 * Sanitised Markdown (ported from `dsa-tutor/web/src/lib/markdown.ts`). Two
 * layers: marked with raw HTML dropped, then DOMPurify with a small allowlist,
 * so anything that still slips through (javascript: links, event handlers) is
 * removed. The main process blocks the navigation or new window a link would
 * open (D-17); opening links in the system browser is not built yet.
 */
import { Marked } from 'marked';
import DOMPurify from 'dompurify';

const marked = new Marked({
  gfm: true,
  breaks: false,
  async: false,
  renderer: {
    html() {
      return '';
    },
  },
});

export const ALLOWED_TAGS = [
  'p',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'em',
  'del',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'a',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'span',
];
export const ALLOWED_ATTR = ['href', 'title', 'class', 'align', 'start'];

let hooked = false;
function hook() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') ?? '';
      if (!/^(https?:|mailto:|#)/i.test(href)) node.removeAttribute('href');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
      node.setAttribute('target', '_blank');
    }
  });
}

export function sanitize(html: string): string {
  hook();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: [...ALLOWED_ATTR, 'rel', 'target'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
}

export function renderMarkdown(md: string): string {
  return sanitize(marked.parse(md) as string);
}

/**
 * Adapt a skill-format problem.md for the app: drop the CLI-only 'Your
 * solution' section, and the '**Topic:** … · **Difficulty:** …' line that the
 * app shows as tags instead.
 */
export function statementForApp(md: string): string {
  return (
    md
      .replace(/\n## Your solution\b[\s\S]*?(?=\n## |\s*$)/, '\n')
      .replace(/^\*\*Topic:\*\*[^\n]*\*\*Difficulty:\*\*[^\n]*\n/m, '')
      .trimEnd() + '\n'
  );
}

export function hasExamplesSection(md: string): boolean {
  return /^##\s+Examples?\b/im.test(md);
}
