/**
 * The Pyodide executor end to end, minus Electron: the real harness and the
 * real Pyodide package run in Node worker threads through the same pool and
 * runtime code the execution host uses. The host window itself (CSP, network
 * blocking) is checked by `npm run check:exec-host` (see DECISIONS D-14).
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  loadProblem,
  redactReport,
  stringifyJson,
  type Problem,
  type RunJob,
  type TestCase,
} from '@algorithm-tutor/core';
import { PyodidePool } from '../../exec-host/pool';
import { poolTransport } from '../../exec-host/pool-transport';
import { nodeWorkerFactory } from '../../exec-host/testing/node-factory';
import { PyodideExecutor } from './pyodide-executor';

const FIXTURE = fileURLToPath(
  new URL('../../../../../packages/core/src/problems/fixtures/level-lists', import.meta.url),
);

let pool: PyodidePool;
let executor: PyodideExecutor;
let levelLists: Problem;

beforeAll(async () => {
  pool = new PyodidePool(nodeWorkerFactory, { graceMs: 150, spares: 3 });
  executor = new PyodideExecutor(poolTransport(pool));
  const loaded = await loadProblem(
    { readText: (p) => readFile(p, 'utf8').catch(() => null) },
    FIXTURE,
  );
  if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
  levelLists = loaded.problem;
  await executor.status();
}, 60_000);

afterAll(() => pool.dispose());

function test(
  id: string,
  input: Record<string, unknown>,
  expected: unknown,
  hidden = false,
): TestCase {
  return hidden
    ? { id, visibility: 'hidden', category: 'edge', input, expected }
    : { id, visibility: 'visible', input, expected };
}

/** A job for `def f(n: int) -> int` unless overridden. */
function job(code: string, tests: TestCase[], over: Partial<RunJob> = {}): RunJob {
  return {
    language: 'python',
    code,
    signature: { function: 'f', params: [{ name: 'n', type: 'int' }], returns: 'int' },
    compare: { mode: 'exact' },
    tests,
    timeLimitMs: 1000,
    memoryLimitMb: 512,
    ...over,
  };
}

function problemJob(code: string): RunJob {
  const { meta, tests } = levelLists;
  return job(code, tests, {
    signature: meta.signature,
    compare: meta.compare,
    timeLimitMs: meta.time_limit_ms,
  });
}

describe('PyodideExecutor', { timeout: 60_000 }, () => {
  it('reports its versions', async () => {
    const s = await executor.status();
    expect(s.available).toBe(true);
    expect(s.versions?.['pyodide']).toBe('314.0.7');
    expect(s.versions?.['python']).toMatch(/^3\.14\./);
  });

  it('passes a correct solution (trees in, nested lists out)', async () => {
    const report = await executor.run(problemJob(levelLists.reference));
    expect(report.ok).toBe(true);
    expect(report.error).toBeUndefined();
    expect(report.results.map((r) => r.status)).toEqual(levelLists.tests.map(() => 'pass'));
    const first = report.results[0]!;
    expect(first.actual).toEqual(levelLists.tests[0]!.expected);
    expect(first.timeMs).toBeGreaterThanOrEqual(0);
  });

  it('fails a wrong solution and shows the visible actual value', async () => {
    const report = await executor.run(
      problemJob('def levels(root):\n    return [[root.val]] if root else []\n'),
    );
    expect(report.ok).toBe(true);
    expect(report.results.some((r) => r.status === 'fail')).toBe(true);
    const visibleFail = report.results.find(
      (r) => r.visibility === 'visible' && r.status === 'fail',
    )!;
    expect(visibleFail.actual).toBeDefined();
    expect(visibleFail.expected).toBeDefined();
  });

  it('reports a runtime error with type, message and solution line', async () => {
    const code = 'def f(n):\n    xs = [1]\n    return xs[n]\n';
    const report = await executor.run(
      job(code, [test('ok', { n: 0 }, 1), test('bad', { n: 5 }, 0)]),
    );
    expect(report.ok).toBe(true);
    expect(report.results[0]!.status).toBe('pass');
    const bad = report.results[1]!;
    expect(bad.status).toBe('error');
    expect(bad.errorType).toBe('IndexError');
    expect(bad.message).toMatch(/IndexError: list index out of range/);
    expect(bad.line).toBe(3);
  });

  it('reports a syntax error as a compile error on every test', async () => {
    const report = await executor.run(
      job('def f(n)\n    return n\n', [test('a', { n: 1 }, 1), test('b', { n: 2 }, 2)]),
    );
    expect(report.ok).toBe(false);
    expect(report.error?.kind).toBe('compile');
    expect(report.error?.message).toMatch(/^SyntaxError \(line 1\)/);
    expect(report.results.map((r) => r.status)).toEqual(['error', 'error']);
  });

  it('reports a missing function as a compile error', async () => {
    const report = await executor.run(job('def g(n):\n    return n\n', [test('a', { n: 1 }, 1)]));
    expect(report.error?.kind).toBe('compile');
    expect(report.error?.message).toMatch(/does not define a function named 'f'/);
  });

  it('kills an infinite loop, runs the remaining tests, and the next job works', async () => {
    const code = 'def f(n):\n    while n > 0:\n        pass\n    return n\n';
    const report = await executor.run(
      job(code, [test('loops', { n: 1 }, 0), test('fine', { n: 0 }, 0)], { timeLimitMs: 300 }),
    );
    expect(report.ok).toBe(true);
    expect(report.results.map((r) => r.status)).toEqual(['timeout', 'pass']);
    expect(report.results[0]!.message).toMatch(/longer than 300 ms/);

    const next = await executor.run(job('def f(n):\n    return n + 1\n', [test('a', { n: 1 }, 2)]));
    expect(next.results[0]!.status).toBe('pass');
  });

  it('times out a solution that loops while loading', async () => {
    const report = await executor.run(
      job('while True:\n    pass\n', [test('a', { n: 1 }, 1)], { timeLimitMs: 300 }),
    );
    expect(report.ok).toBe(false);
    expect(report.error?.kind).toBe('compile');
    expect(report.error?.message).toMatch(/TimeoutError/);
  });

  it('truncates large output, keeping the end', async () => {
    const code = 'def f(n):\n    for i in range(100000):\n        print("line", i)\n    return n\n';
    const report = await executor.run(job(code, [test('a', { n: 1 }, 1)]));
    const r = report.results[0]!;
    expect(r.status).toBe('pass');
    expect(r.stdout!.length).toBeLessThan(2100);
    expect(r.stdout).toMatch(/^\[… \d+ earlier characters not shown\]\n/);
    expect(r.stdout).toMatch(/line 99999\n$/);
  });

  it('captures stdout per test', async () => {
    const code = 'def f(n):\n    print("got", n)\n    return n\n';
    const report = await executor.run(job(code, [test('a', { n: 1 }, 1), test('b', { n: 2 }, 2)]));
    expect(report.results.map((r) => r.stdout)).toEqual(['got 1\n', 'got 2\n']);
  });

  it('keeps 64-bit integers exact both ways', async () => {
    const big = 999999999999999999n;
    const report = await executor.run(
      job('def f(n):\n    return n + 1\n', [test('big', { n: big }, 1000000000000000000n)]),
    );
    expect(report.results[0]!.status).toBe('pass');
    expect(report.results[0]!.actual).toBe(1000000000000000000n);
  });

  it('converts linked lists, tuples, maps and optionals', async () => {
    const code = [
      'def f(head, pair, counts, maybe):',
      '    vals = []',
      '    while head:',
      '        vals.append(head.val)',
      '        head = head.next',
      '    assert isinstance(pair, tuple) and isinstance(pair[1], float)',
      '    assert all(isinstance(k, int) for k in counts)',
      '    out = None',
      '    for v in vals:',
      '        out = ListNode(v * 2, out)',
      '    return (out, maybe is None, {k: v for k, v in counts.items()})',
    ].join('\n');
    const report = await executor.run(
      job(
        code,
        [
          test('a', { head: [1, 2, 3], pair: ['x', 2], counts: { '3': 1 }, maybe: null }, [
            [6, 4, 2],
            true,
            { '3': 1 },
          ]),
        ],
        {
          signature: {
            function: 'f',
            params: [
              { name: 'head', type: 'linked_list<int>' },
              { name: 'pair', type: 'tuple<string,float>' },
              { name: 'counts', type: 'map<int,int>' },
              { name: 'maybe', type: 'optional<int>' },
            ],
            returns: 'tuple<linked_list<int>,bool,map<int,int>>',
          },
        },
      ),
    );
    expect(report.results[0]).toMatchObject({ status: 'pass' });
  });

  it('survives long linked lists (freeing them used to exhaust the stack)', async () => {
    const values = Array.from({ length: 20_000 }, (_, i) => i);
    const code = [
      'def f(head):',
      '    prev = None',
      '    while head:',
      '        head.next, prev, head = prev, head, head.next',
      '    return prev',
    ].join('\n');
    const report = await executor.run(
      job(
        code,
        [test('long', { head: values }, [...values].reverse()), test('short', { head: [1] }, [1])],
        {
          signature: {
            function: 'f',
            params: [{ name: 'head', type: 'linked_list<int>' }],
            returns: 'linked_list<int>',
          },
        },
      ),
    );
    expect(report.results.map((r) => r.status)).toEqual(['pass', 'pass']);
  });

  it('reports runaway recursion as a RecursionError and keeps going', async () => {
    const code = 'def f(n):\n    return 0 if n == 0 else 1 + max(f(n - 1), 0)\n';
    // Python's own limit (100 000 frames) or, in Chromium's smaller worker
    // stack, a JavaScript stack overflow: both end as a RecursionError.
    const report = await executor.run(
      job(code, [test('deep', { n: 10 ** 6 }, 0), test('shallow', { n: 3 }, 3)], {
        timeLimitMs: 10_000,
      }),
    );
    expect(report.results[0]).toMatchObject({ status: 'error', errorType: 'RecursionError' });
    expect(report.results[1]).toMatchObject({ status: 'pass' });
  });

  it('cancels a running job', async () => {
    const controller = new AbortController();
    const running = executor.run(
      job(
        'def f(n):\n    while True:\n        pass\n',
        [test('a', { n: 1 }, 1), test('b', { n: 1 }, 1)],
        {
          timeLimitMs: 20_000,
        },
      ),
      controller.signal,
    );
    setTimeout(() => controller.abort(), 300);
    const report = await running;
    expect(report.ok).toBe(false);
    expect(report.error?.kind).toBe('cancelled');
    expect(report.durationMs).toBeLessThan(5000);
  });

  it('starts every job from a clean interpreter', async () => {
    const leave =
      'import builtins\ndef f(n):\n    builtins.LEFT = 1\n    open("/tmp/left.txt", "w").write("x")\n    return 1\n';
    await executor.run(job(leave, [test('a', { n: 1 }, 1)]));
    const look =
      'import builtins, os\ndef f(n):\n    return int(hasattr(builtins, "LEFT")) + int(os.path.exists("/tmp/left.txt"))\n';
    const report = await executor.run(job(look, [test('a', { n: 1 }, 0)]));
    expect(report.results[0]).toMatchObject({ status: 'pass' });
  });
});

describe('Pyodide lock-down', { timeout: 60_000 }, () => {
  async function attempt(body: string): Promise<{ status: string; message?: string | undefined }> {
    const code = `def f(n):\n${body
      .split('\n')
      .map((l) => `    ${l}`)
      .join('\n')}\n    return 0\n`;
    const report = await executor.run(job(code, [test('a', { n: 1 }, 0)]));
    const r = report.results[0]!;
    return { status: r.status, message: r.message ?? report.error?.message };
  }

  it('has no js.fetch', async () => {
    expect(await attempt('import js\njs.fetch("https://example.com")')).toMatchObject({
      status: 'error',
      message: expect.stringMatching(/^AttributeError/),
    });
  });

  it('cannot reach JavaScript through pyodide.code.run_js', async () => {
    expect(await attempt('from pyodide.code import run_js\nrun_js("fetch")')).toMatchObject({
      status: 'error',
      message: expect.stringMatching(/^ImportError: pyodide.code is not available/),
    });
  });

  it('cannot read /etc/passwd', async () => {
    expect(await attempt('open("/etc/passwd").read()')).toMatchObject({
      status: 'error',
      message: expect.stringMatching(/^FileNotFoundError/),
    });
  });

  it.each(['micropip', 'pyodide.http', 'pyodide_js', 'pyodide.webloop'])(
    'cannot import %s',
    async (name) => {
      expect(await attempt(`import ${name}`)).toMatchObject({
        status: 'error',
        message: expect.stringMatching(/^(ImportError|ModuleNotFoundError)/),
      });
    },
  );

  it('cannot read stdin', async () => {
    expect(await attempt('input()')).toMatchObject({
      status: 'error',
      message: expect.stringMatching(/^EOFError/),
    });
  });
});

describe('redaction', { timeout: 60_000 }, () => {
  it('leaves no hidden input, expected or actual value in the report', async () => {
    const marker = { input: 'SECRET-INPUT-7f3a', expected: 'SECRET-EXPECTED-91c2' };
    // The hidden actual value, stdout and error message all contain the input marker.
    const code =
      'def f(s):\n    print("printed", s)\n    if s.endswith("x"):\n        raise ValueError("bad " + s)\n    return s + "-actual"\n';
    const tests: TestCase[] = [
      test('shown', { s: 'visible' }, 'nope'),
      test('hidden-fail', { s: marker.input }, marker.expected, true),
      test('hidden-error', { s: `${marker.input}x` }, marker.expected, true),
    ];
    const signature = { function: 'f', params: [{ name: 's', type: 'string' }], returns: 'string' };
    const report = await executor.run(job(code, tests, { signature }));
    expect(report.results.map((r) => r.status)).toEqual(['fail', 'fail', 'error']);
    // Unredacted, the hidden data is there (the main process needs it)...
    expect(stringifyJson(report)).toContain(marker.input);
    // ...and redacted, none of it is.
    const text = stringifyJson(redactReport(report));
    for (const secret of [marker.input, marker.expected]) {
      expect(text).not.toContain(secret);
    }
    expect(redactReport(report).results[1]).toEqual({
      id: 'hidden-fail',
      visibility: 'hidden',
      category: 'edge',
      status: 'fail',
      timeMs: report.results[1]!.timeMs,
    });
    expect(redactReport(report).results[0]).toMatchObject({
      input: { s: 'visible' },
      actual: 'visible-actual',
    });
  });
});
