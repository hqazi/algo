import { describe, expect, it } from 'vitest';
import { loadProblem, type ProblemFileReader } from './loader';
import { stringifyJson } from '../types/json';
import metaText from './fixtures/level-lists/meta.json?raw';
import testsText from './fixtures/level-lists/tests.json?raw';
import statement from './fixtures/level-lists/problem.md?raw';
import reference from './fixtures/level-lists/reference.py?raw';

const DIR = 'content/problems/trees/level-lists';

/** An in-memory problem folder: the hand-converted dsa-tutor `level-lists`, with optional edits. */
function folder(files: Record<string, string | null> = {}, dir = DIR): ProblemFileReader {
  const all: Record<string, string | null> = {
    'meta.json': metaText,
    'tests.json': testsText,
    'problem.md': statement,
    'reference.py': reference,
    ...files,
  };
  return {
    readText: (path) => {
      const name = path.slice(dir.length + 1);
      return Promise.resolve(path.startsWith(`${dir}/`) ? (all[name] ?? null) : null);
    },
  };
}

const meta = (): Record<string, unknown> => JSON.parse(metaText) as Record<string, unknown>;
const tests = (): { schema_version: number; tests: Record<string, unknown>[] } =>
  JSON.parse(testsText) as { schema_version: number; tests: Record<string, unknown>[] };

async function errorsFor(files: Record<string, string | null>): Promise<string[]> {
  const result = await loadProblem(folder(files), DIR);
  if (result.ok) throw new Error('expected the problem to be invalid');
  return result.errors;
}

describe('loadProblem: level-lists (hand-converted from dsa-tutor)', () => {
  it('loads and validates', async () => {
    const result = await loadProblem(folder(), DIR, { topics: new Set(['trees', 'graphs']) });
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const { problem } = result;
    expect(problem.meta.slug).toBe('level-lists');
    expect(problem.meta.signature).toEqual({
      function: 'levels',
      params: [{ name: 'root', type: 'tree<int>' }],
      returns: 'list<list<int>>',
    });
    expect(problem.tests).toHaveLength(7);
    expect(problem.tests.filter((t) => t.visibility === 'hidden')).toHaveLength(5);
    expect(problem.statement).toMatch(/^# Level by Level/);
    expect(problem.reference).toMatch(/def levels\(root\)/);
    expect(problem.bruteForce).toBeUndefined();
    expect(problem.dir).toBe(DIR);
  });

  it('accepts a trailing slash and reads brute_force.py', async () => {
    const result = await loadProblem(
      folder({ 'brute_force.py': 'def levels(root): ...\n' }),
      `${DIR}/`,
    );
    expect(result.ok && result.problem.bruteForce).toMatch(/def levels/);
  });
});

describe('loadProblem: errors', () => {
  const withMeta = (edit: (m: Record<string, unknown>) => void): Record<string, string> => {
    const m = meta();
    edit(m);
    return { 'meta.json': JSON.stringify(m) };
  };
  const withTests = (edit: (t: ReturnType<typeof tests>) => void): Record<string, string> => {
    const t = tests();
    edit(t);
    return { 'tests.json': stringifyJson(t) };
  };

  it.each([
    [
      'missing files',
      { 'meta.json': null, 'reference.py': null },
      /meta\.json: missing[\s\S]*reference\.py: missing/,
    ],
    ['empty statement', { 'problem.md': '  \n' }, /problem\.md: empty/],
    ['invalid JSON', { 'tests.json': '{"tests": [' }, /tests\.json: not valid JSON/],
    ['v1 files', { 'meta.json': '{"schema_version": 1}' }, /schema_version 1 is an older format/],
    [
      'newer files',
      { 'tests.json': '{"schema_version": 3}' },
      /schema_version 3 is newer than this app supports/,
    ],
  ])('%s', async (_name, files, message) => {
    expect((await errorsFor(files)).join('\n')).toMatch(message);
  });

  it.each([
    [
      'unknown key',
      (m: Record<string, unknown>) => (m.signatures = {}),
      /Unrecognized key: "signatures"/,
    ],
    [
      'bad slug',
      (m: Record<string, unknown>) => (m.slug = 'Level_Lists'),
      /slug: must be lowercase/,
    ],
    [
      'folder mismatch',
      (m: Record<string, unknown>) => (m.slug = 'other'),
      /does not match the folder name "level-lists"/,
    ],
    [
      'bad type',
      (m: Record<string, unknown>) =>
        (m.signature = {
          function: 'levels',
          params: [{ name: 'root', type: 'TreeNode | None' }],
          returns: 'list<list<int>>',
        }),
      /signature\.params\[0\]\.type: unknown type "TreeNode"/,
    ],
    [
      'camelCase name',
      (m: Record<string, unknown>) =>
        (m.signature = { function: 'levelLists', params: [], returns: 'int' }),
      /signature\.function: must be snake_case/,
    ],
    [
      'keyword name',
      (m: Record<string, unknown>) =>
        (m.signature = {
          function: 'levels',
          params: [{ name: 'lambda', type: 'int' }],
          returns: 'int',
        }),
      /is a reserved word/,
    ],
    [
      'duplicate param',
      (m: Record<string, unknown>) =>
        (m.signature = {
          function: 'f',
          params: [
            { name: 'a', type: 'int' },
            { name: 'a', type: 'int' },
          ],
          returns: 'int',
        }),
      /duplicate parameter "a"/,
    ],
    [
      'bad compare mode',
      (m: Record<string, unknown>) => (m.compare = { mode: 'fuzzy' }),
      /compare/,
    ],
    [
      'tolerance outside float mode',
      (m: Record<string, unknown>) => (m.compare = { mode: 'exact', tolerance: 0.1 }),
      /Unrecognized key: "tolerance"/,
    ],
    [
      'float mode on ints',
      (m: Record<string, unknown>) => (m.compare = { mode: 'float' }),
      /mode float needs a float in the return type/,
    ],
    ['no languages', (m: Record<string, unknown>) => (m.languages = []), /languages/],
    [
      'language whose harness cannot run the signature',
      (m: Record<string, unknown>) => {
        m.languages = ['python', 'rust'];
        m.signature = {
          function: 'levels',
          params: [
            { name: 'root', type: 'tree<int>' },
            { name: 'other', type: 'tree<string>' },
          ],
          returns: 'list<list<int>>',
        };
      },
      /rust cannot run this signature/,
    ],
    ['missing time limit', (m: Record<string, unknown>) => delete m.time_limit_ms, /time_limit_ms/],
    [
      'imported without origin',
      (m: Record<string, unknown>) => (m.source = 'imported'),
      /an imported problem needs an origin/,
    ],
    [
      'origin of the wrong kind',
      (m: Record<string, unknown>) => (
        (m.source = 'pasted'),
        (m.origin = {
          kind: 'open-set',
          name: 'x',
          url: 'https://x.org',
          license: 'MIT',
          attribution: 'y',
        })
      ),
      /belongs to source "imported", not "pasted"/,
    ],
    [
      'open-set origin missing fields',
      (m: Record<string, unknown>) => (
        (m.source = 'imported'),
        (m.origin = { kind: 'open-set', name: 'x' })
      ),
      /origin\.url/,
    ],
    [
      'unknown topic',
      (m: Record<string, unknown>) => (m.topic = 'not-a-topic'),
      /unknown topic "not-a-topic"/,
    ],
  ])('meta: %s', async (_name, edit, message) => {
    const result = await loadProblem(folder(withMeta(edit)), DIR, { topics: new Set(['trees']) });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join('\n')).toMatch(message);
  });

  it('accepts a valid pasted and imported origin', async () => {
    for (const edit of [
      (m: Record<string, unknown>) => ((m.source = 'pasted'), (m.origin = { kind: 'paste' })),
      (m: Record<string, unknown>) => (
        (m.source = 'imported'),
        (m.origin = {
          kind: 'open-set',
          name: 'Exercism',
          url: 'https://github.com/exercism/problem-specifications',
          license: 'MIT',
          attribution: 'Exercism contributors',
        })
      ),
    ]) {
      const result = await loadProblem(folder(withMeta(edit)), DIR);
      expect(result.ok ? [] : result.errors).toEqual([]);
    }
  });

  it.each([
    [
      'too few visible',
      (t: ReturnType<typeof tests>) => (t.tests = t.tests.filter((x) => x.id !== 'example-2')),
      /at least 2 visible tests/,
    ],
    [
      'too few hidden',
      (t: ReturnType<typeof tests>) => (t.tests = t.tests.slice(0, 4)),
      /at least 3 hidden tests/,
    ],
    [
      'duplicate id',
      (t: ReturnType<typeof tests>) => (t.tests[1]!.id = 'example-1'),
      /duplicate test id "example-1"/,
    ],
    [
      'hidden without category',
      (t: ReturnType<typeof tests>) => (t.tests[2]!.category = ' '),
      /tests\[2\]\.category: hidden tests need a category/,
    ],
    [
      'missing expected',
      (t: ReturnType<typeof tests>) => delete t.tests[0]!.expected,
      /tests\[0\]\.expected: /,
    ],
    [
      'wrong input key',
      (t: ReturnType<typeof tests>) => (t.tests[0]!.input = { tree: [1] }),
      /input must have exactly the parameters root: missing root; unexpected tree/,
    ],
    [
      'input of the wrong type',
      (t: ReturnType<typeof tests>) => (t.tests[3]!.input = { root: [1, 'x'] }),
      /tests\[3\] \(hidden-2\): input\.root\[1\]: expected int/,
    ],
    [
      'malformed tree input',
      (t: ReturnType<typeof tests>) => (t.tests[0]!.input = { root: [1, null, null, 4] }),
      /input\.root: tree has values from position 3/,
    ],
    [
      'expected of the wrong type',
      (t: ReturnType<typeof tests>) => (t.tests[0]!.expected = [3, [9, 20]]),
      /expected\[0\]: expected list, got number 3/,
    ],
    [
      'visibility typo',
      (t: ReturnType<typeof tests>) => (t.tests[0]!.visibility = 'shown'),
      /tests\[0\]\.visibility/,
    ],
  ])('tests: %s', async (_name, edit, message) => {
    expect((await errorsFor(withTests(edit))).join('\n')).toMatch(message);
  });

  it('accepts expected: null where the return type allows it', async () => {
    const m = meta();
    m.signature = {
      function: 'levels',
      params: [{ name: 'root', type: 'tree<int>' }],
      returns: 'optional<int>',
    };
    const t = tests();
    t.tests.forEach((x, i) => (x.expected = i % 2 ? null : 1));
    const result = await loadProblem(
      folder({ 'meta.json': JSON.stringify(m), 'tests.json': JSON.stringify(t) }),
      DIR,
    );
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it('validates 64-bit integers exactly', async () => {
    const m = meta();
    m.signature = {
      function: 'levels',
      params: [{ name: 'root', type: 'tree<int>' }],
      returns: 'int',
    };
    const big = tests();
    big.tests.forEach((x) => (x.expected = 0));
    const text = JSON.stringify(big).replace('"expected":0', '"expected":4660046610375530309');
    const result = await loadProblem(
      folder({ 'meta.json': JSON.stringify(m), 'tests.json': text }),
      DIR,
    );
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.problem.tests[0]!.expected).toBe(4660046610375530309n);

    const tooBig = text.replace('4660046610375530309', '9223372036854775808');
    expect(
      (await errorsFor({ 'meta.json': JSON.stringify(m), 'tests.json': tooBig })).join(),
    ).toMatch(/outside the 64-bit range/);
  });
});
