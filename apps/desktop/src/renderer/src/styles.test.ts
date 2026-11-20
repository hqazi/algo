// WCAG 2.x contrast of the design tokens in styles.css (T28, docs/design.md:
// 4.5:1 for text, 3:1 for large text and UI parts), in both themes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(import.meta.dirname, 'styles.css'), 'utf8');

/** The hex colour tokens declared directly in a block. */
function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) out[m[1]!] = m[2]!;
  return out;
}

function blockAfter(marker: string): string {
  const at = css.indexOf(marker);
  if (at < 0) throw new Error(`missing ${marker}`);
  const open = css.indexOf('{', at + marker.length - 1);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`unclosed ${marker}`);
}

const light = tokens(blockAfter(':root {'));
const darkOnly = tokens(blockAfter('@media (prefers-color-scheme: dark) {'));
const dark = { ...light, ...darkOnly };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** [foreground, background, minimum ratio] */
const PAIRS: [string, string, number][] = [
  // Body and secondary text on every surface.
  ...['--bg', '--surface', '--surface-2', '--surface-3'].flatMap(
    (bg): [string, string, number][] => [
      ['--text', bg, 4.5],
      ['--muted', bg, 4.5],
    ],
  ),
  // Placeholders and disabled text: a hint, not content (disabled controls are
  // exempt from WCAG 1.4.3); kept readable at 3:1.
  ['--faint', '--surface', 3],
  ['--faint', '--bg', 3],
  // Text on filled accent (primary buttons), at rest and on hover.
  ['--accent-text', '--accent', 4.5],
  ['--accent-text', '--accent-hover', 4.5],
  // Accent as text (links) and on tinted selections.
  ['--accent-fg', '--surface', 4.5],
  ['--accent-fg', '--bg', 4.5],
  ['--accent-fg', '--surface-2', 4.5],
  ['--accent-fg', '--accent-subtle', 4.5],
  ['--text', '--accent-subtle', 4.5],
  // Focus ring and filled accent against the page: UI parts, 3:1.
  ['--focus', '--surface', 3],
  ['--focus', '--bg', 3],
  // Statuses on surfaces and on their own tinted backgrounds.
  ...['--pass', '--fail', '--warn'].flatMap((c): [string, string, number][] => [
    [c, '--surface', 4.5],
    [c, '--surface-2', 4.5],
    [c, `${c}-bg`, 4.5],
  ]),
  // Difficulty text on surfaces and on neutral pills.
  ...['--easy', '--medium', '--hard'].flatMap((c): [string, string, number][] => [
    [c, '--surface', 4.5],
    [c, '--surface-2', 4.5],
  ]),
];

describe.each([
  ['light', light],
  ['dark', dark],
] as const)('%s theme contrast', (_name, theme) => {
  it.each(PAIRS)('%s on %s ≥ %s:1', (fg, bg, min) => {
    const a = theme[fg];
    const b = theme[bg];
    expect(a, `${fg} is a hex token`).toMatch(/^#/);
    expect(b, `${bg} is a hex token`).toMatch(/^#/);
    expect(contrast(a!, b!)).toBeGreaterThanOrEqual(min);
  });
});

describe('tokens', () => {
  it('keep the names existing CSS uses and add the design.md set', () => {
    for (const name of [
      '--bg',
      '--surface',
      '--surface-2',
      '--surface-3',
      '--border',
      '--border-strong',
      '--text',
      '--muted',
      '--faint',
      '--accent',
      '--accent-hover',
      '--accent-subtle',
      '--accent-text',
      '--accent-2',
      '--danger',
      '--code-bg',
      '--pass',
      '--fail',
      '--warn',
      '--pass-bg',
      '--fail-bg',
      '--warn-bg',
      '--easy',
      '--medium',
      '--hard',
      '--font',
      '--mono',
      '--radius-sm',
      '--radius',
      '--radius-lg',
      '--shadow-sm',
      '--shadow',
      '--shadow-lg',
      '--duration',
    ]) {
      expect(blockAfter(':root {'), name).toContain(`${name}:`);
    }
  });

  it('give dark mode its own colours for every light colour token', () => {
    for (const name of Object.keys(light)) expect(darkOnly, name).toHaveProperty(name);
  });

  it('respect prefers-reduced-motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*transition-duration/);
  });

  it('computes WCAG ratios', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });
});
