import { describe, expect, it } from 'vitest';
import { parseJson } from '../../packages/core/src/index';
import {
  convertMeta,
  convertStatement,
  convertTests,
  isCanonicalType,
  jsonLiteral,
  neutralType,
  pyLiteral,
  type V1Meta,
  type V1Test,
} from './dsa-tutor';

describe('neutralType', () => {
  it.each([
    ['int', 'int'],
    ['str', 'string'],
    ['bool', 'bool'],
    ['list[int]', 'list<int>'],
    ['list[list[str]]', 'list<list<string>>'],
    ['ListNode | None', 'linked_list<int>'],
    ['TreeNode|None', 'tree<int>'],
  ])('%s → %s', (hint, neutral) => {
    expect(neutralType(hint)).toBe(neutral);
    expect(isCanonicalType(neutral)).toBe(true);
  });

  it.each(['dict[str, int]', 'tuple[int, int]', 'int | None', 'ListNode', 'Any'])(
    'rejects %s',
    (hint) => expect(() => neutralType(hint)).toThrow(/no neutral type/),
  );
});

const meta = (over: Partial<V1Meta> = {}): V1Meta => ({
  schema_version: 1,
  slug: 'middle-node',
  title: 'Middle',
  topic: 'linked-list',
  difficulty: 'easy',
  source: 'curated',
  created_at: '2026-10-31T14:18:42Z',
  expected_complexity: { time: 'O(n)', space: 'O(1)' },
  compare: { mode: 'exact' },
  signatures: {
    python: {
      function: 'middle_node',
      params: [{ name: 'head', type: 'ListNode | None' }],
      returns: 'ListNode | None',
    },
  },
  ...over,
});

describe('convertMeta', () => {
  it('writes the v2 fields in spec order', () => {
    const out = convertMeta(meta(), 2000);
    expect(Object.keys(out)).toEqual([
      'schema_version',
      'slug',
      'title',
      'topic',
      'difficulty',
      'source',
      'content_version',
      'created_at',
      'expected_complexity',
      'compare',
      'time_limit_ms',
      'signature',
      'languages',
    ]);
    expect(out['signature']).toEqual({
      function: 'middle_node',
      params: [{ name: 'head', type: 'linked_list<int>' }],
      returns: 'linked_list<int>',
    });
    expect(out['languages']).toEqual(['python']);
  });

  it('rejects unknown keys and other languages', () => {
    expect(() => convertMeta({ ...meta(), extra: 1 } as V1Meta, 2000)).toThrow(/unexpected/);
    const twoLanguages = meta();
    (twoLanguages.signatures as Record<string, unknown>)['rust'] = {};
    expect(() => convertMeta(twoLanguages, 2000)).toThrow(/only a python signature/);
  });
});

describe('convertTests', () => {
  it('keeps big integers exact and bumps the version', () => {
    const text = convertTests(
      parseJson(
        '{"schema_version":1,"tests":[{"id":"a","visibility":"visible","input":{"n":999999999999999999},"expected":true}]}',
      ) as never,
    );
    expect(text).toBe(
      '{"schema_version":2,"tests":[{"id":"a","visibility":"visible","input":{"n":999999999999999999},"expected":true}]}\n',
    );
  });
});

describe('literals', () => {
  const value = [1, null, true, 'a"b', [2n ** 62n], { k: false }];
  it('pyLiteral prints like dsa-tutor', () => {
    expect(pyLiteral(value)).toBe('[1, None, True, "a\\"b", [4611686018427387904], {"k": False}]');
  });
  it('jsonLiteral prints the same layout with JSON literals', () => {
    expect(jsonLiteral(value)).toBe(
      '[1, null, true, "a\\"b", [4611686018427387904], {"k": false}]',
    );
  });
});

const tests: V1Test[] = [
  {
    id: 'example-1',
    visibility: 'visible',
    category: 'example',
    input: { head: [1, 2, 3] },
    expected: [2, 3],
    explanation: 'The middle holds 2.',
  },
  { id: 'example-2', visibility: 'visible', input: { head: [] }, expected: [] },
  { id: 'hidden-1', visibility: 'hidden', category: 'single', input: { head: [1] }, expected: [1] },
];

const v1md = `# Middle

**Topic:** Linked lists · **Difficulty:** Easy

Return the middle node. Return \`None\` for an empty list.

## Examples

**Example 1**

\`\`\`text
Input:  head = [1, 2, 3]
Output: [2, 3]
\`\`\`

The middle holds 2.

**Example 2**

\`\`\`text
Input:  head = []
Output: []
\`\`\`

## Constraints

- 0 <= length <= 10^5

## Signature

\`\`\`python
class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

def middle_node(head: ListNode | None) -> ListNode | None:
\`\`\`

\`ListNode\` values are given to you already built; in the examples they are written as lists (trees in level order, \`None\` for a missing child).

## Your solution

Write it in \`workspace/middle-node/solution.py\`, then run the tests:

\`\`\`bash
python scripts/run_tests.py middle-node
\`\`\`
`;

describe('convertStatement', () => {
  it('drops the Python parts and adds neutral notes', () => {
    const out = convertStatement(v1md, meta(), tests);
    expect(out).toContain('For an empty list, return an empty list (no node).');
    expect(out).toContain('The middle holds 2.');
    expect(out).toMatch(
      /## Constraints\n\n- 0 <= length <= 10\^5\n\n## Notes\n\nLinked lists are passed in and returned/,
    );
    expect(out).not.toMatch(/None|python|Signature|Your solution|scripts\//);
    expect(out.endsWith('(`[]` for an empty one).\n')).toBe(true);
  });

  it('writes examples with JSON literals', () => {
    const m = meta({
      slug: 'flags',
      signatures: {
        python: { function: 'f', params: [{ name: 'x', type: 'list[bool]' }], returns: 'bool' },
      },
    });
    const t: V1Test[] = [
      { id: 'a', visibility: 'visible', input: { x: [true] }, expected: false },
      { id: 'b', visibility: 'visible', input: { x: [] }, expected: true },
    ];
    const md = v1md
      .replace('Return `None` for an empty list.', '')
      .replace(/## Examples[\s\S]*?## Constraints/, () =>
        [
          '## Examples',
          '',
          '**Example 1**',
          '',
          '```text',
          'Input:  x = [True]',
          'Output: False',
          '```',
          '',
          '**Example 2**',
          '',
          '```text',
          'Input:  x = []',
          'Output: True',
          '```',
          '',
          '## Constraints',
        ].join('\n'),
      )
      .replace(/## Signature[\s\S]*$/, () =>
        [
          '## Signature',
          '',
          '```python',
          'def f(x: list[bool]) -> bool:',
          '```',
          '',
          '## Your solution',
          '',
          'Write it in `workspace/flags/solution.py`, then run the tests:',
          '',
          '```bash',
          'python scripts/run_tests.py flags',
          '```',
          '',
        ].join('\n'),
      );
    const out = convertStatement(md, m, t);
    expect(out).toContain('Input:  x = [true]\nOutput: false');
    expect(out).not.toContain('## Notes');
  });

  it('refuses examples that are not the visible tests', () => {
    const edited = v1md.replace('Output: [2, 3]', 'Output: [2, 3, 4]');
    expect(() => convertStatement(edited, meta(), tests)).toThrow(/not the visible tests/);
  });

  it('refuses a hand-edited tail', () => {
    const edited = v1md.replace('then run the tests:', 'then run the tests (fast):');
    expect(() => convertStatement(edited, meta(), tests)).toThrow(/edited by hand/);
  });

  it('refuses a prose edit that no longer matches', () => {
    const edited = v1md.replace('Return `None` for an empty list.', 'Empty lists give None.');
    expect(() => convertStatement(edited, meta(), tests)).toThrow(/matched 0 times/);
  });
});
