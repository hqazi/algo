/**
 * Links in the README and the docs: every relative link points at a file
 * that exists, and every `#anchor` (in the same page or another Markdown
 * page) at a real heading, slugged the way GitHub does it.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

const PAGES = [
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CHANGELOG.md',
  ...readdirSync(join(ROOT, 'docs'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => `docs/${f}`),
  ...readdirSync(join(ROOT, 'docs/guide'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => `docs/guide/${f}`),
].filter((p) => existsSync(join(ROOT, p)));

/** GitHub's heading anchor: lower case, punctuation dropped, spaces to hyphens. */
export function slug(heading: string): string {
  return heading
    .replace(/`/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** Anchors of a Markdown page: its headings (with GitHub's -1, -2 for repeats) and `id`s. */
function anchors(md: string): Set<string> {
  const out = new Set<string>();
  const seen = new Map<string, number>();
  let fenced = false;
  for (const line of md.split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      const base = slug(m[1]!);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      out.add(n ? `${base}-${n}` : base);
    }
    for (const [, id] of line.matchAll(/\bid="([^"]+)"/g)) out.add(id!);
  }
  return out;
}

/** Relative links of a page, outside code: Markdown `](...)` and HTML `href` / `src`. */
function links(md: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of md.split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const text = line.replace(/`[^`]*`/g, '');
    for (const [, url] of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) out.push(url!);
    for (const [, url] of text.matchAll(/\b(?:href|src|srcset)="([^"]+)"/g)) out.push(url!);
  }
  return out.filter((u) => !/^[a-z][a-z+.-]*:/i.test(u));
}

describe('docs links', () => {
  it('finds the pages', () => {
    expect(PAGES).toContain('README.md');
    expect(PAGES).toContain('docs/guide/installation.md');
  });

  it('slugs headings the way GitHub does', () => {
    expect(slug('Optional: a container sandbox')).toBe('optional-a-container-sandbox');
    expect(slug('Privacy: what the tutor sees')).toBe('privacy-what-the-tutor-sees');
    expect(slug('Export, import and reset')).toBe('export-import-and-reset');
    expect(slug('`npm run e2e`')).toBe('npm-run-e2e');
  });

  it.each(PAGES)('%s: relative links and anchors resolve', (page) => {
    const md = readFileSync(join(ROOT, page), 'utf8');
    const broken: string[] = [];
    for (const url of links(md)) {
      const [path = '', anchor] = url.split('#');
      const target = path
        ? resolve(ROOT, dirname(page), decodeURIComponent(path))
        : join(ROOT, page);
      if (!existsSync(target)) {
        broken.push(`${url} (no ${relative(ROOT, target)})`);
        continue;
      }
      if (anchor && target.endsWith('.md') && !anchors(readFileSync(target, 'utf8')).has(anchor))
        broken.push(`${url} (no heading #${anchor})`);
    }
    expect(broken).toEqual([]);
  });
});
