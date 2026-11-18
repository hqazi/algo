import { describe, expect, it } from 'vitest';
import type { TestCase } from '../problems/schema';
import { gradeRun } from './grade';
import { clipTail, STDOUT_LIMIT, toHarnessRequest, type HarnessCaseResult } from './harness';
import { redactReport } from './redact';
import type { RunJob } from './types';

const tests: TestCase[] = [
  { id: 'v1', visibility: 'visible', input: { n: 1 }, expected: [1, 2] },
  { id: 'h1', visibility: 'hidden', category: 'big', input: { n: 2 }, expected: [3] },
];

const job: RunJob = {
  language: 'python',
  code: 'def f(n): ...',
  signature: { function: 'f', params: [{ name: 'n', type: 'int' }], returns: 'list<int>' },
  compare: { mode: 'unordered' },
  tests,
  timeLimitMs: 100,
  memoryLimitMb: 256,
};

const ok = (actualJson: string, timeMs = 1, stdout = ''): HarnessCaseResult => ({
  status: 'ok',
  actualJson,
  timeMs,
  stdout,
});

describe('toHarnessRequest', () => {
  it('sends inputs as exact JSON and never the expected values', () => {
    const big = {
      ...job,
      tests: [{ ...tests[0]!, input: { n: 2n ** 62n }, expected: 'EXPECTED' }],
    };
    const req = toHarnessRequest(big);
    expect(req.inputs).toEqual(['{"n":4611686018427387904}']);
    expect(req.params).toEqual([{ name: 'n', type: { kind: 'int' } }]);
    expect(req.returns).toEqual({ kind: 'list', of: { kind: 'int' } });
    expect(JSON.stringify(req)).not.toContain('EXPECTED');
  });
});

describe('gradeRun', () => {
  it('compares with the problem compare mode', () => {
    const r = gradeRun(job, { kind: 'ran', cases: [ok('[2, 1]'), ok('[4]')] }, 5);
    expect(r).toMatchObject({ ok: true, durationMs: 5 });
    expect(r.results.map((x) => x.status)).toEqual(['pass', 'fail']);
    expect(r.results[0]).toMatchObject({
      id: 'v1',
      input: { n: 1 },
      expected: [1, 2],
      actual: [2, 1],
    });
    expect(r.results[1]).toMatchObject({ id: 'h1', category: 'big' });
  });

  it('keeps big integers exact when comparing', () => {
    const j = {
      ...job,
      compare: { mode: 'exact' as const },
      tests: [{ ...tests[0]!, expected: [4660046610375530309n] }],
    };
    expect(
      gradeRun(j, { kind: 'ran', cases: [ok('[4660046610375530309]')] }, 0).results[0]!.status,
    ).toBe('pass');
    expect(
      gradeRun(j, { kind: 'ran', cases: [ok('[4660046610375530308]')] }, 0).results[0]!.status,
    ).toBe('fail');
  });

  it('turns a run over the limit into a timeout', () => {
    const r = gradeRun(job, { kind: 'ran', cases: [ok('[1, 2]', 150), { status: 'timeout' }] }, 0);
    expect(r.results.map((x) => x.status)).toEqual(['timeout', 'timeout']);
    expect(r.results[0]!.message).toBe('took 150 ms; the limit is 100 ms');
    expect(r.results[1]!.message).toBe('took longer than 100 ms');
  });

  it('reports errors with type, line and clipped stdout', () => {
    const stdout = 'x'.repeat(STDOUT_LIMIT + 10);
    const r = gradeRun(
      job,
      {
        kind: 'ran',
        cases: [
          {
            status: 'error',
            errorType: 'KeyError',
            message: "'a'",
            line: 4,
            stdout,
            stdoutDropped: 5,
          },
          ok('[3]'),
        ],
      },
      0,
    );
    expect(r.results[0]).toMatchObject({
      status: 'error',
      errorType: 'KeyError',
      message: "KeyError: 'a'",
      line: 4,
    });
    expect(r.results[0]!.stdout).toBe(
      `[… 15 earlier characters not shown]\n${'x'.repeat(STDOUT_LIMIT)}`,
    );
  });

  it('marks unreached tests as errors', () => {
    const r = gradeRun(job, { kind: 'ran', cases: [ok('[1, 2]')] }, 0);
    expect(r.results[1]).toMatchObject({ status: 'error', message: 'not run' });
  });

  it('reports a solution that does not load as a compile error', () => {
    const r = gradeRun(
      job,
      { kind: 'load-error', errorType: 'SyntaxError', message: 'invalid syntax', line: 2 },
      0,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toEqual({ kind: 'compile', message: 'SyntaxError (line 2): invalid syntax' });
    expect(r.results.map((x) => x.status)).toEqual(['error', 'error']);
    expect(r.results[0]!.message).toBe(
      'the solution did not load: SyntaxError (line 2): invalid syntax',
    );
    expect(r.results[1]!.message).toBeUndefined();
  });

  it('reports executor failures and cancellation, keeping results that ran', () => {
    const r = gradeRun(
      job,
      {
        kind: 'failed',
        error: { kind: 'cancelled', message: 'stop' },
        cases: [ok('[1, 2]'), { status: 'skipped' }],
      },
      0,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toEqual({ kind: 'cancelled', message: 'stop' });
    expect(r.results.map((x) => x.status)).toEqual(['pass', 'error']);
    expect(r.results[1]!.message).toBe('not run: cancelled');
  });

  it('treats a value that is not JSON as a harness error', () => {
    const r = gradeRun(job, { kind: 'ran', cases: [ok('[1,'), ok('[3]')] }, 0);
    expect(r.results[0]).toMatchObject({ status: 'error', errorType: 'HarnessError' });
  });
});

describe('redactReport', () => {
  it('keeps only id, visibility, category, status and time for hidden tests', () => {
    const report = gradeRun(
      job,
      {
        kind: 'ran',
        cases: [
          ok('[1, 2]', 1, 'shown'),
          {
            status: 'error',
            errorType: 'ValueError',
            message: 'n=2',
            line: 3,
            timeMs: 2,
            stdout: 'secret',
          },
        ],
      },
      9,
    );
    const red = redactReport(report);
    expect(red.results[1]).toEqual({
      id: 'h1',
      visibility: 'hidden',
      category: 'big',
      status: 'error',
      timeMs: 2,
    });
    expect(red.results[0]).toEqual(report.results[0]);
    expect(JSON.stringify(red)).not.toMatch(/secret|n=2|ValueError/);
    expect(red.durationMs).toBe(9);
    // The original is left alone.
    expect(report.results[1]!.stdout).toBe('secret');
  });
});

describe('clipTail', () => {
  it('leaves short text alone and keeps the end of long text', () => {
    expect(clipTail('abc', 5)).toBe('abc');
    expect(clipTail('abcdefg', 5)).toBe('[… 2 earlier characters not shown]\ncdefg');
    expect(clipTail('abc', 5, 7)).toBe('[… 7 earlier characters not shown]\nabc');
  });
});
