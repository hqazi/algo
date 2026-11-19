/**
 * `problem.md` for a new problem (SPEC §5.1, DECISIONS D-19): language
 * neutral, examples generated from the visible tests with JSON literals, and
 * notes on how trees, linked lists and compare modes work. Same layout as
 * the curated problems converted in T04.
 */
import type { CompareSpec } from '../compare';
import type { TestCase } from '../problems/schema';
import { parseType, someType, type NeutralType } from '../types/neutral';
import { stringifyJson } from '../types/json';
import type { Signature } from '../types/signature';

/** A value as the examples print it: JSON, with `, ` between items. */
export function jsonLiteral(v: unknown): string {
  if (v === null || typeof v === 'boolean' || typeof v === 'string' || typeof v === 'bigint')
    return stringifyJson(v);
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
  if (Array.isArray(v)) return `[${v.map(jsonLiteral).join(', ')}]`;
  if (typeof v === 'object')
    return `{${Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${JSON.stringify(k)}: ${jsonLiteral(x)}`)
      .join(', ')}}`;
  return 'null';
}

/** Language-neutral notes on how inputs arrive and how results are compared. */
export function neutralNotes(sig: Signature, compare: CompareSpec): string[] {
  const all = [...sig.params.map((p) => p.type), sig.returns].map(parseType);
  const has = (kind: NeutralType['kind']): boolean =>
    all.some((t) => someType(t, (x) => x.kind === kind));
  const returns = parseType(sig.returns);
  const returned = (kind: NeutralType['kind']): boolean =>
    someType(returns, (x) => x.kind === kind);
  const notes: string[] = [];
  if (has('tree'))
    notes.push(
      `Trees are ${returned('tree') ? 'passed in and returned' : 'passed in'} as nodes; ` +
        'the examples write a tree as a list in level order, with `null` for a missing child.',
    );
  if (has('linked_list'))
    notes.push(
      `Linked lists are ${returned('linked_list') ? 'passed in and returned' : 'passed in'} as nodes; ` +
        'the examples write a linked list as the list of its values from the head ' +
        '(`[]` for an empty one).',
    );
  if (compare.mode === 'unordered' || compare.mode === 'unordered_deep')
    notes.push('The order of the returned items does not matter.');
  if (compare.mode === 'float')
    notes.push(`Answers within ${compare.tolerance ?? 1e-6} (relative) are accepted.`);
  return notes;
}

export interface StatementParts {
  title: string;
  topicName: string;
  difficulty: string;
  statement: string;
  constraints: readonly string[];
  notes?: string | undefined;
  signature: Signature;
  compare: CompareSpec;
  tests: readonly TestCase[];
}

export function renderStatement(p: StatementParts): string {
  const level = p.difficulty.charAt(0).toUpperCase() + p.difficulty.slice(1);
  const out = [
    `# ${p.title.trim()}`,
    '',
    `**Topic:** ${p.topicName} · **Difficulty:** ${level}`,
    '',
    p.statement.trim(),
    '',
    '## Examples',
    '',
  ];
  let n = 0;
  for (const t of p.tests) {
    if (t.visibility !== 'visible') continue;
    n += 1;
    const args =
      p.signature.params.map((q) => `${q.name} = ${jsonLiteral(t.input[q.name])}`).join(', ') ||
      '(none)';
    out.push(
      `**Example ${n}**`,
      '',
      '```text',
      `Input:  ${args}`,
      `Output: ${jsonLiteral(t.expected)}`,
      '```',
      '',
    );
    if (t.explanation?.trim()) out.push(t.explanation.trim(), '');
  }
  if (p.constraints.length)
    out.push('## Constraints', '', ...p.constraints.map((c) => `- ${c}`), '');
  const notes = [p.notes?.trim() ?? '', ...neutralNotes(p.signature, p.compare)].filter(Boolean);
  if (notes.length) {
    out.push('## Notes', '');
    for (const note of notes) out.push(note, '');
  }
  return `${out.join('\n').trimEnd()}\n`;
}
