import { describe, expect, it } from 'vitest';
import { gradeRun } from '../exec/grade';
import type { RunJob } from '../exec/types';
import { crossCheckProblem, languageSupports, languagesWithHarness } from '../problems/validate';
import { metaSchema, testsFileSchema } from '../problems/schema';
import { starterCode } from '../teaching/workspace';
import { parseJson } from '../types/json';
import type { Signature } from '../types/signature';
import {
  camelCase,
  compiledHarnessLimit,
  encodeHarnessInput,
  newNonce,
  parseHarnessStream,
  RECORD_MARK,
} from './common';
import { goName, goProject, goStub } from './go';
import { rustName, rustProject, rustStub } from './rust';

const sig = (fn: string, params: [string, string][], returns: string): Signature => ({
  function: fn,
  params: params.map(([name, type]) => ({ name, type })),
  returns,
});

/** Together these use every neutral type, nested and at the top level. */
const GOLDEN: Record<string, Signature> = {
  tree: sig('levels', [['root', 'tree<int>']], 'list<list<int>>'),
  'linked-list': sig(
    'reverse_list',
    [
      ['head', 'linked_list<int>'],
      ['k', 'int'],
    ],
    'linked_list<int>',
  ),
  scalars: sig(
    'pick',
    [
      ['count', 'int'],
      ['ratio', 'float'],
      ['flag', 'bool'],
      ['name', 'string'],
      ['letter', 'char'],
    ],
    'tuple<int,float,bool,string,char>',
  ),
  maps: sig(
    'index_words',
    [
      ['by_word', 'map<string,list<int>>'],
      ['weights', 'map<int,float>'],
    ],
    'map<int,optional<string>>',
  ),
  nested: sig(
    'walk_forest',
    [
      ['forest', 'list<tree<char>>'],
      ['path', 'optional<linked_list<string>>'],
    ],
    'optional<list<tuple<int,int>>>',
  ),
  tuples: sig(
    'pairs',
    [
      ['a', 'tuple<int,int>'],
      ['b', 'list<tuple<string,int>>'],
    ],
    'tuple<int,int>',
  ),
  keywords: sig(
    'type',
    [
      ['match', 'int'],
      ['range', 'list<int>'],
      ['self', 'string'],
    ],
    'bool',
  ),
};

describe('golden files', () => {
  for (const [name, s] of Object.entries(GOLDEN)) {
    it(`rust ${name}`, async () => {
      await expect(rustStub(s, { header: ['Title', '', 'Instructions.'] })).toMatchFileSnapshot(
        `golden/rust/${name}/${rustProject(s).solutionPath}`,
      );
      for (const f of rustProject(s).files) {
        await expect(f.content).toMatchFileSnapshot(`golden/rust/${name}/${f.path}`);
      }
    });
    it(`go ${name}`, async () => {
      await expect(goStub(s, { header: ['Title', '', 'Instructions.'] })).toMatchFileSnapshot(
        `golden/go/${name}/${goProject(s).solutionPath}`,
      );
      for (const f of goProject(s).files) {
        await expect(f.content).toMatchFileSnapshot(`golden/go/${name}/${f.path}`);
      }
    });
  }
});

describe('names', () => {
  it('Rust keeps snake_case and escapes keywords', () => {
    expect(rustName('level_lists')).toBe('level_lists');
    expect(rustName('type')).toBe('r#type');
    expect(rustName('match')).toBe('r#match');
    expect(rustName('self')).toBe('self_');
    expect(rustName('crate')).toBe('crate_');
  });

  it('Go uses lowerCamelCase and avoids keywords and predeclared names', () => {
    expect(camelCase('level_lists')).toBe('levelLists');
    expect(goName('level_lists')).toBe('levelLists');
    expect(goName('sorted_ids_2')).toBe('sortedIds2');
    expect(goName('type')).toBe('type_');
    expect(goName('len')).toBe('len_');
    expect(goName('main')).toBe('main_');
    expect(goName('string')).toBe('string_');
  });
});

describe('support', () => {
  it('needs one element type per node kind', () => {
    expect(compiledHarnessLimit(GOLDEN.tree!)).toBeNull();
    const mixed = sig(
      'f',
      [
        ['a', 'tree<int>'],
        ['b', 'list<tree<string>>'],
      ],
      'int',
    );
    expect(compiledHarnessLimit(mixed)).toMatch(/tree element types differ/);
    expect(languageSupports('rust', mixed)).toBe(false);
    expect(languageSupports('go', mixed)).toBe(false);
    expect(languageSupports('python', mixed)).toBe(true);
    expect(() => rustProject(mixed)).toThrow(/cannot run/);
    expect(() => goProject(mixed)).toThrow(/cannot run/);
  });

  it('every golden signature is supported by both', () => {
    for (const s of Object.values(GOLDEN)) {
      expect(languageSupports('rust', s)).toBe(true);
      expect(languageSupports('go', s)).toBe(true);
    }
  });

  it('the app offers Python, Rust and Go (T16 runs the compiled ones locally)', () => {
    expect(languagesWithHarness()).toEqual(['python', 'rust', 'go']);
  });

  it('starter code uses the stubs', () => {
    const meta = metaSchema.parse({
      schema_version: 2,
      slug: 'level-lists',
      title: 'Level by Level',
      topic: 'trees',
      difficulty: 'medium',
      source: 'curated',
      content_version: 1,
      expected_complexity: { time: 'O(n)', space: 'O(n)' },
      compare: { mode: 'exact' },
      time_limit_ms: 2000,
      signature: GOLDEN.tree,
      languages: ['python', 'rust', 'go'],
    });
    expect(starterCode(meta, 'rust', 'Trees')).toMatch(
      /^\/\/ Level by Level \(Trees, medium\)\n[\s\S]*pub fn levels\(root: Option<Rc<RefCell<TreeNode>>>\) -> Vec<Vec<i64>> \{\n {4}todo!\(\)/,
    );
    expect(starterCode(meta, 'go', 'Trees')).toMatch(
      /^\/\/ Level by Level[\s\S]*package main\n\nfunc levels\(root \*TreeNode\) \[\]\[\]int \{/,
    );
  });
});

describe('protocol', () => {
  const N = 'abc123';
  const rec = (body: string): string => `${RECORD_MARK}${N} ${body}\n`;

  it('encodes a header line then one input per line', () => {
    expect(encodeHarnessInput(N, ['{"a":1}', '{"a":2}'])).toBe(
      '{"nonce":"abc123"}\n{"a":1}\n{"a":2}\n',
    );
    expect(newNonce()).toMatch(/^[0-9a-f]{32}$/);
    expect(newNonce()).not.toBe(newNonce());
  });

  it('splits records and the stdout printed before each', () => {
    const out = parseHarnessStream(
      `hello\n${rec('{"status":"ok","actual":[1,9223372036854775807],"time_ms":0.5}')}` +
        `no newline${rec('{"status":"error","error_type":"panic","message":"boom","line":4,"time_ms":1}')}`,
      N,
      2,
      { kind: 'exited', code: 0 },
    );
    expect(out).toEqual({
      kind: 'ran',
      cases: [
        { status: 'ok', actualJson: '[1,9223372036854775807]', timeMs: 0.5, stdout: 'hello\n' },
        {
          status: 'error',
          errorType: 'panic',
          message: 'boom',
          line: 4,
          timeMs: 1,
          stdout: 'no newline',
        },
      ],
    });
  });

  it('ignores records with another nonce (printed by the solution)', () => {
    const fake = `${RECORD_MARK}other {"status":"ok","actual":1,"time_ms":0}\n`;
    const out = parseHarnessStream(
      `${fake}${rec('{"status":"ok","actual":2,"time_ms":0}')}`,
      N,
      1,
      { kind: 'exited', code: 0 },
    );
    expect(out).toMatchObject({ kind: 'ran', cases: [{ actualJson: '2', stdout: fake }] });
  });

  it('marks the running test as timed out and skips the rest', () => {
    const out = parseHarnessStream(`${rec('{"status":"ok","actual":1,"time_ms":0}')}tick`, N, 3, {
      kind: 'timeout',
    });
    expect(out).toMatchObject({
      kind: 'ran',
      cases: [{ status: 'ok' }, { status: 'timeout', stdout: 'tick' }, { status: 'skipped' }],
    });
  });

  it('reports a crash with the reason from stderr', () => {
    const rust = parseHarnessStream('', N, 1, {
      kind: 'exited',
      code: 134,
      stderr: "\nthread 'main' has overflowed its stack\nfatal runtime error: stack overflow",
    });
    expect(rust).toMatchObject({
      cases: [
        { status: 'error', errorType: 'crash', message: 'stack overflow (recursion too deep?)' },
      ],
    });
    const other = parseHarnessStream('', N, 1, { kind: 'exited', code: 1, stderr: 'oops' });
    expect(other).toMatchObject({
      cases: [{ errorType: 'crash', message: 'the program exited with code 1: oops' }],
    });
  });

  it('fails the run on a fatal or unreadable record', () => {
    expect(
      parseHarnessStream(rec('{"status":"fatal","message":"bad input"}'), N, 1, {
        kind: 'exited',
        code: 2,
      }),
    ).toMatchObject({ kind: 'failed', error: { kind: 'harness', message: /bad input/ } });
    expect(parseHarnessStream(rec('{nope'), N, 1, { kind: 'exited', code: 0 })).toMatchObject({
      kind: 'failed',
      error: { message: /unreadable/ },
    });
  });

  it('grades through gradeRun like any harness', () => {
    const job: RunJob = {
      language: 'rust',
      code: '',
      signature: GOLDEN.tree!,
      compare: { mode: 'exact' },
      tests: [
        { id: 'a', visibility: 'visible', input: { root: [1, 2] }, expected: [[1], [2]] },
        { id: 'b', visibility: 'hidden', category: 'x', input: { root: [] }, expected: [] },
      ],
      timeLimitMs: 1000,
      memoryLimitMb: 256,
    };
    const out = parseHarnessStream(
      rec('{"status":"ok","actual":[[1],[2]],"time_ms":1}') +
        rec('{"status":"ok","actual":[[0]],"time_ms":1}'),
      N,
      2,
      { kind: 'exited', code: 0 },
    );
    const report = gradeRun(job, out, 5);
    expect(report.results.map((r) => r.status)).toEqual(['pass', 'fail']);
  });
});

describe('check fixtures', () => {
  const files = import.meta.glob<string>('./fixtures/*/*.json', {
    query: '?raw',
    import: 'default',
    eager: true,
  });

  it('validate, and list Rust and Go', () => {
    const slugs = ['group-lengths', 'best-team', 'basket-average'];
    for (const slug of slugs) {
      const meta = metaSchema.parse(parseJson(files[`./fixtures/${slug}/meta.json`]!));
      const tests = testsFileSchema.parse(parseJson(files[`./fixtures/${slug}/tests.json`]!)).tests;
      expect(crossCheckProblem(meta, tests)).toEqual([]);
      expect(meta.languages).toEqual(['python', 'rust', 'go']);
    }
  });
});
