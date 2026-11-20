/** T20: every Settings → Code execution install link points at a real heading of the guide. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GUIDE_URL, INSTALL_HELP } from './code-execution';

const guide = readFileSync(
  fileURLToPath(new URL('../../../../../../docs/guide/code-execution.md', import.meta.url)),
  'utf8',
);

/** GitHub's heading anchor: lower case, punctuation dropped, spaces to hyphens. */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

function anchors(md: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of md.split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const m = !fenced && /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push(slug(m[1]!));
  }
  return out;
}

describe('install guide links', () => {
  const found = anchors(guide);

  it('slugs headings the way GitHub does', () => {
    expect(slug('Optional: a container sandbox')).toBe('optional-a-container-sandbox');
    expect(slug('Installing Rust and Go')).toBe('installing-rust-and-go');
  });

  it.each(Object.entries(INSTALL_HELP))('%s link resolves to a guide heading', (_topic, url) => {
    expect(url.startsWith(GUIDE_URL)).toBe(true);
    expect(found).toContain(url.slice(GUIDE_URL.length));
  });

  it('in-page links to those sections resolve too', () => {
    for (const [, id] of guide.matchAll(/\]\(#([^)]+)\)/g)) expect(found).toContain(id);
  });
});
