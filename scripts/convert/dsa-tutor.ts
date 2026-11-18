/**
 * Convert one `dsa-tutor` curated problem (format v1) to format v2
 * (SPEC §5.1). Pure functions; `scripts/convert-dsa-tutor.ts` does the I/O.
 *
 * - `meta.json`: `signatures.python` → neutral `signature`, plus
 *   `schema_version` 2, `content_version` 1, `time_limit_ms`, `languages`.
 * - `tests.json`: only `schema_version` changes.
 * - `problem.md`: the Python-only parts become language-neutral. Examples are
 *   regenerated from the visible tests with JSON literals (`null`, `true`),
 *   the Python signature block and the script instructions are dropped (the
 *   app shows a stub in the chosen language), and a few phrases are reworded.
 *   Every part that is regenerated is first checked against what
 *   `dsa-tutor`'s own renderer would have written, so hand edits are never
 *   silently lost.
 */
import {
  formatType,
  parseType,
  stringifyJson,
  type JsonValue,
  type NeutralType,
  type Signature,
} from '../../packages/core/src/index';

// ------------------------------------------------------------------ types

/** A v1 Python type hint → a neutral type string. Throws when there is no clean mapping. */
export function neutralType(hint: string): string {
  const t = hint.replace(/\s+/g, '');
  const scalar: Record<string, string> = {
    int: 'int',
    float: 'float',
    bool: 'bool',
    str: 'string',
    'ListNode|None': 'linked_list<int>',
    'TreeNode|None': 'tree<int>',
  };
  const direct = scalar[t];
  if (direct) return direct;
  const list = /^list\[(.+)\]$/.exec(t);
  if (list) return `list<${neutralType(list[1]!)}>`;
  throw new Error(`no neutral type for the Python hint "${hint}"`);
}

interface V1Signature {
  function: string;
  params: { name: string; type: string }[];
  returns: string;
}

export interface V1Meta {
  schema_version: 1;
  slug: string;
  title: string;
  topic: string;
  difficulty: string;
  source: string;
  created_at?: string;
  expected_complexity: { time: string; space: string };
  compare?: { mode: string; tolerance?: number };
  signatures: { python: V1Signature };
}

const V1_META_KEYS = new Set([
  'schema_version',
  'slug',
  'title',
  'topic',
  'difficulty',
  'source',
  'created_at',
  'expected_complexity',
  'compare',
  'signatures',
]);

export function convertSignature(py: V1Signature): Signature {
  return {
    function: py.function,
    params: py.params.map((p) => ({ name: p.name, type: neutralType(p.type) })),
    returns: neutralType(py.returns),
  };
}

/** The v2 `meta.json` object, keys in the order of SPEC §5.1. */
export function convertMeta(v1: V1Meta, timeLimitMs: number): Record<string, unknown> {
  if (v1.schema_version !== 1) throw new Error(`${v1.slug}: expected schema_version 1`);
  const extra = Object.keys(v1).filter((k) => !V1_META_KEYS.has(k));
  if (extra.length) throw new Error(`${v1.slug}: unexpected meta.json keys: ${extra.join(', ')}`);
  const languages = Object.keys(v1.signatures);
  if (languages.join() !== 'python')
    throw new Error(`${v1.slug}: expected only a python signature, got ${languages.join(', ')}`);
  const out: Record<string, unknown> = {
    schema_version: 2,
    slug: v1.slug,
    title: v1.title,
    topic: v1.topic,
    difficulty: v1.difficulty,
    source: v1.source,
    content_version: 1,
  };
  if (v1.created_at) out['created_at'] = v1.created_at;
  out['expected_complexity'] = v1.expected_complexity;
  out['compare'] = v1.compare ?? { mode: 'exact' };
  out['time_limit_ms'] = timeLimitMs;
  out['signature'] = convertSignature(v1.signatures.python);
  out['languages'] = ['python'];
  return out;
}

export interface V1Test {
  id: string;
  visibility: 'visible' | 'hidden';
  category?: string;
  input: Record<string, JsonValue>;
  expected: JsonValue;
  explanation?: string;
}

export interface V1TestsFile {
  schema_version: 1;
  tests: V1Test[];
}

/** The v2 `tests.json` text: the same tests, compact like the source, `schema_version` 2. */
export function convertTests(v1: V1TestsFile): string {
  if (v1.schema_version !== 1) throw new Error('tests.json: expected schema_version 1');
  return `${stringifyJson({ schema_version: 2, tests: v1.tests })}\n`;
}

// --------------------------------------------------------------- literals

/** `dsa-tutor`'s `py_literal`: how v1 examples printed values. */
export function pyLiteral(v: unknown): string {
  if (v === null) return 'None';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new Error(`float literal ${v}: not handled`);
    return String(v);
  }
  if (Array.isArray(v)) return `[${v.map(pyLiteral).join(', ')}]`;
  if (typeof v === 'object')
    return `{${Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${JSON.stringify(k)}: ${pyLiteral(x)}`)
      .join(', ')}}`;
  throw new Error(`cannot print ${typeof v}`);
}

/** The same layout with JSON literals: the neutral form every language's examples use. */
export function jsonLiteral(v: unknown): string {
  if (v === null || typeof v === 'boolean' || typeof v === 'string' || typeof v === 'bigint')
    return stringifyJson(v);
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new Error(`float literal ${v}: not handled`);
    return String(v);
  }
  if (Array.isArray(v)) return `[${v.map(jsonLiteral).join(', ')}]`;
  if (typeof v === 'object')
    return `{${Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${JSON.stringify(k)}: ${jsonLiteral(x)}`)
      .join(', ')}}`;
  throw new Error(`cannot print ${typeof v}`);
}

// -------------------------------------------------------------- problem.md

const NODE_CLASSES: Record<'ListNode' | 'TreeNode', string> = {
  ListNode:
    'class ListNode:\n' +
    '    def __init__(self, val=0, next=None):\n' +
    '        self.val = val\n' +
    '        self.next = next\n',
  TreeNode:
    'class TreeNode:\n' +
    '    def __init__(self, val=0, left=None, right=None):\n' +
    '        self.val = val\n' +
    '        self.left = left\n' +
    '        self.right = right\n',
};

function examples(
  params: readonly { name: string }[],
  tests: readonly V1Test[],
  literal: (v: unknown) => string,
): string[] {
  const out: string[] = [];
  let n = 0;
  for (const t of tests) {
    if (t.visibility !== 'visible') continue;
    n += 1;
    const args = params.map((p) => `${p.name} = ${literal(t.input[p.name])}`).join(', ');
    out.push(
      `**Example ${n}**`,
      '',
      '```text',
      `Input:  ${args}`,
      `Output: ${literal(t.expected)}`,
      '```',
      '',
    );
    if (t.explanation) out.push(t.explanation.trim(), '');
  }
  return out;
}

/** What `dsa-tutor`'s renderer wrote after the constraints (and notes). */
function v1Tail(meta: V1Meta): string {
  const sig = meta.signatures.python;
  const hints = [...sig.params.map((p) => p.type), sig.returns].join(' ');
  const classes = (['ListNode', 'TreeNode'] as const).filter((c) => hints.includes(c));
  const params = sig.params.map((p) => `${p.name}: ${p.type}`).join(', ');
  const out = ['## Signature', '', '```python', ...classes.map((c) => NODE_CLASSES[c])];
  out.push(`def ${sig.function}(${params}) -> ${sig.returns}:`, '```', '');
  if (classes.length)
    out.push(
      `\`${classes.join('` and `')}\` values are given to you already built; ` +
        'in the examples they are written as lists (trees in level order, `None` for a missing child).',
      '',
    );
  const mode = meta.compare?.mode;
  if (mode === 'unordered' || mode === 'unordered_deep')
    out.push('The order of the returned items does not matter.', '');
  if (mode === 'float')
    out.push(`Answers within ${meta.compare?.tolerance ?? 1e-6} (relative) are accepted.`, '');
  out.push(
    '## Your solution',
    '',
    `Write it in \`workspace/${meta.slug}/solution.py\`, then run the tests:`,
    '',
    '```bash',
    `python scripts/run_tests.py ${meta.slug}`,
    '```',
    '',
  );
  return out.join('\n');
}

/** Language-neutral notes on how inputs arrive and how results are compared. */
function neutralNotes(sig: Signature, compare: { mode: string; tolerance?: number }): string[] {
  const all = [...sig.params.map((p) => p.type), sig.returns].map(parseType);
  const has = (kind: NeutralType['kind']): boolean => all.some((t) => t.kind === kind);
  const returns = parseType(sig.returns).kind;
  const notes: string[] = [];
  if (has('tree'))
    notes.push(
      `Trees are ${returns === 'tree' ? 'passed in and returned' : 'passed in'} as nodes; ` +
        'the examples write a tree as a list in level order, with `null` for a missing child.',
    );
  if (has('linked_list'))
    notes.push(
      `Linked lists are ${returns === 'linked_list' ? 'passed in and returned' : 'passed in'} as nodes; ` +
        'the examples write a linked list as the list of its values from the head ' +
        '(`[]` for an empty one).',
    );
  if (compare.mode === 'unordered' || compare.mode === 'unordered_deep')
    notes.push('The order of the returned items does not matter.');
  if (compare.mode === 'float')
    notes.push(`Answers within ${compare.tolerance ?? 1e-6} (relative) are accepted.`);
  return notes;
}

/**
 * Exact wording changes, by slug, for prose that only made sense in Python.
 * Each must match exactly once, so a change in the source is noticed.
 */
export const PROSE_EDITS: Record<string, [from: string, to: string][]> = {
  'course-plan': [['Return `True` if', 'Return true if']],
  'has-route': [['Return `True` if', 'Return true if']],
  'change-booth': [['Return `True` if', 'Return true if']],
  'reach-the-end': [['Return `True` if', 'Return true if']],
  'can-attend-all': [['Return `True` if', 'Return true if']],
  'balanced-brackets': [['Return `True` if', 'Return true if']],
  'valid-search-tree': [['Return `True` if', 'Return true if']],
  'mirror-phrase': [['Return `True` if', 'Return true if']],
  'middle-node': [
    ['Return `None` for an empty list.', 'For an empty list, return an empty list (no node).'],
  ],
  'power-mod': [
    ['`b^(e // 2)`', '`b^(e / 2)` (rounded down)'],
    [
      "Do not use Python's three-argument\n`pow`.",
      "Do not use a built-in modular power\n(such as Python's three-argument `pow`).",
    ],
  ],
};

function applyEdits(slug: string, text: string): string {
  let out = text;
  for (const [from, to] of PROSE_EDITS[slug] ?? []) {
    const count = out.split(from).length - 1;
    if (count !== 1)
      throw new Error(`${slug}: prose edit "${from}" matched ${count} times, expected 1`);
    out = out.replace(from, to);
  }
  return out;
}

/** The v2 `problem.md`. Throws if the v1 file differs from what its renderer wrote. */
export function convertStatement(v1md: string, meta: V1Meta, tests: readonly V1Test[]): string {
  const md = v1md.replace(/\r\n/g, '\n');
  const at = (heading: string): number => {
    const i = md.indexOf(`\n${heading}\n`);
    if (i < 0 || md.indexOf(`\n${heading}\n`, i + 1) >= 0)
      throw new Error(`${meta.slug}: problem.md needs exactly one "${heading}"`);
    return i + 1;
  };
  const exAt = at('## Examples');
  const conAt = at('## Constraints');
  const sigAt = at('## Signature');
  if (!(exAt < conAt && conAt < sigAt))
    throw new Error(`${meta.slug}: problem.md sections out of order`);

  const head = md.slice(0, exAt);
  const oldExamples = md.slice(exAt, conAt);
  const middle = md.slice(conAt, sigAt); // constraints, and notes if any
  const tail = md.slice(sigAt);

  const params = meta.signatures.python.params;
  const section = (literal: (v: unknown) => string): string =>
    `${['## Examples', '', ...examples(params, tests, literal)].join('\n')}\n`;
  const expectedExamples = section(pyLiteral);
  if (oldExamples !== expectedExamples)
    throw new Error(`${meta.slug}: the examples in problem.md are not the visible tests`);
  if (tail !== v1Tail(meta))
    throw new Error(`${meta.slug}: problem.md after "## Signature" was edited by hand`);

  const sig = convertSignature(meta.signatures.python);
  const notes = neutralNotes(sig, meta.compare ?? { mode: 'exact' });
  // A "## Notes" section is optional in v1; add ours to it, or start one.
  let rest = middle.replace(/\n+$/, '\n');
  if (notes.length) {
    rest += rest.includes('\n## Notes\n') ? '\n' : '\n## Notes\n\n';
    rest += notes.map((n) => `${n}\n`).join('\n');
  }
  const out = head + section(jsonLiteral) + rest;
  return applyEdits(meta.slug, out);
}

/** Format check used by tests: every neutral type round-trips. */
export function isCanonicalType(text: string): boolean {
  return formatType(parseType(text)) === text;
}
