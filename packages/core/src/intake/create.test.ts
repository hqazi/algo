/**
 * `createProblem`: spec checks, expected values from the brute force, the
 * self-check, the files written, and that model-written code runs only in
 * the Pyodide executor. Ported from `dsa-tutor/tests/test_tools.py`
 * (`create_problem`) and `test_intake.py`.
 */
import { describe, expect, it } from 'vitest';
import type { ExecutorId } from '../exec/types';
import { loadProblem } from '../problems/loader';
import { TOPICS } from '../teaching/test-support';
import { parseJson } from '../types/json';
import { createProblem, specProblems, type CreateDeps } from './create';
import { BAD_REFERENCE, copyOf, FunctionExecutor, GOOD, MemoryWriter } from './testing';

function setup(over: Partial<CreateDeps> = {}) {
  const writer = new MemoryWriter();
  const executor = new FunctionExecutor();
  const created: string[] = [];
  const deps: CreateDeps = {
    topics: () => TOPICS,
    taken: (slug) => slug === 'compress-runs' || writer.written.has(slug),
    executors: (id) => (id === 'pyodide' ? executor : null),
    writer,
    now: () => '2026-11-19T09:00:00Z',
    created: (slug) => {
      created.push(slug);
      return Promise.resolve();
    },
    ...over,
  };
  return { deps, writer, executor, created };
}

const reader = (files: Record<string, string>) => ({
  readText: (p: string) => Promise.resolve(files[p.slice(p.lastIndexOf('/') + 1)] ?? null),
});

describe('createProblem', () => {
  it('fills expected values from the brute force, self-checks and writes a loadable problem', async () => {
    const { deps, writer, executor, created } = setup();
    const out = await createProblem(deps, copyOf(GOOD));
    expect(out).toEqual({
      ok: true,
      slug: 'count-even-readings',
      title: 'Even Readings',
      tests: { visible: 2, hidden: 3 },
      self_check: 'passed',
    });
    expect(created).toEqual(['count-even-readings']);
    const { kind, files } = writer.written.get('count-even-readings')!;
    expect(kind).toBe('generated');
    expect(Object.keys(files).sort()).toEqual(
      ['brute_force.py', 'meta.json', 'problem.md', 'reference.py', 'tests.json'].sort(),
    );
    const loaded = await loadProblem(reader(files), 'x/count-even-readings', {
      topics: new Set(TOPICS.map((t) => t.id)),
    });
    expect(loaded.ok).toBe(true);
    const meta = parseJson(files['meta.json']!) as Record<string, unknown>;
    expect(meta).toMatchObject({
      source: 'generated',
      content_version: 1,
      time_limit_ms: 2000,
      languages: ['python', 'rust', 'go'],
      created_at: '2026-11-19T09:00:00Z',
    });
    expect(meta.origin).toBeUndefined();
    const tests = (parseJson(files['tests.json']!) as { tests: Record<string, unknown>[] }).tests;
    expect(tests.map((t) => [t.id, t.expected, t.category])).toEqual([
      ['example-1', 2, 'example'],
      ['example-2', 0, 'example'],
      ['hidden-1', 0, 'empty input'],
      ['hidden-2', 3, 'negative numbers'],
      ['hidden-3', 2, 'all even'],
    ]);
    // The brute force ran first, then the reference; both in Pyodide.
    expect(executor.jobs.map((j) => j.timeLimitMs)).toEqual([10_000, 2000]);
    const md = files['problem.md']!;
    expect(md).toContain('# Even Readings\n\n**Topic:** Arrays & strings · **Difficulty:** Easy');
    expect(md).toContain('Input:  readings = [1, 2, 3, 4]\nOutput: 2');
    expect(md).toContain('## Constraints\n\n- 0 <= len(readings) <= 10^4');
    expect(md).not.toContain('24680'); // hidden inputs stay out of the statement
  });

  it('reports a failing self-check per test and writes nothing', async () => {
    const { deps, writer } = setup();
    const spec = copyOf(GOOD);
    spec.reference_solution = BAD_REFERENCE;
    const out = await createProblem(deps, spec);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/^self-check failed/);
    const failures = out.failures as Record<string, unknown>[];
    expect(failures.map((f) => [f.id, f.status])).toEqual([
      ['example-1', 'wrong_answer'],
      ['example-2', 'wrong_answer'],
      ['hidden-2', 'wrong_answer'],
      ['hidden-3', 'wrong_answer'],
    ]);
    expect(failures[0]).toMatchObject({
      expected: 2,
      actual: 4,
      input: { readings: [1, 2, 3, 4] },
    });
    expect(writer.written.size).toBe(0);
  });

  it('checks the spec before running anything', async () => {
    const { deps, executor } = setup();
    const spec = copyOf(GOOD);
    spec.topic = 'cooking';
    spec.signature = { function: 'Count', params: [], returns: 'number' };
    spec.extra = 1;
    let out = await createProblem(deps, spec);
    expect(out).toMatchObject({ ok: false, error: 'invalid spec' });
    expect((out.problems as string[]).join('\n')).toContain('unknown field "extra"');
    delete spec.extra;
    out = await createProblem(deps, spec);
    const problems = (out.problems as string[]).join('\n');
    expect(problems).toContain('unknown topic "cooking"');
    expect(problems).toContain('signature.function');
    expect(executor.jobs).toEqual([]);

    const tests = copyOf(GOOD);
    (tests.tests as Record<string, unknown>[]).splice(2, 3);
    (tests.tests as Record<string, unknown>[])[0]!.input = { readings: ['x'] };
    expect(specProblems(tests, new Set(TOPICS.map((t) => t.id))).join('\n')).toMatch(
      /expected int, got string[\s\S]*need at least 3 hidden tests/,
    );

    const noBrute = copyOf(GOOD);
    delete noBrute.brute_force;
    out = await createProblem(deps, noBrute);
    expect((out.problems as string[])[0]).toContain('no expected value and no brute_force');
  });

  it('refuses a slug that exists and drops app-only keys', async () => {
    const { deps, writer } = setup();
    expect(await createProblem(deps, { ...copyOf(GOOD), slug: 'compress-runs' })).toMatchObject({
      ok: false,
      error: 'slug "compress-runs" already exists; choose another slug',
    });
    const out = await createProblem(deps, {
      ...copyOf(GOOD),
      source: 'pasted',
      origin: { kind: 'paste' },
      origin_text: 'mine',
    });
    expect(out.ok).toBe(true);
    const meta = parseJson(writer.written.get('count-even-readings')!.files['meta.json']!);
    expect(meta).toMatchObject({ source: 'generated' });
    expect(writer.written.get('count-even-readings')!.files['origin.md']).toBeUndefined();
  });

  it('keeps origin, origin text and notice for pasted and imported problems', async () => {
    const { deps, writer } = setup();
    const out = await createProblem(deps, copyOf(GOOD), {
      origin: { kind: 'paste' },
      originText: 'Count the even readings, please.',
    });
    expect(out).toMatchObject({ ok: true, source: 'pasted' });
    const { kind, files } = writer.written.get('count-even-readings')!;
    expect(kind).toBe('imported');
    expect(files['origin.md']).toBe('Count the even readings, please.\n');
    expect(parseJson(files['meta.json']!)).toMatchObject({
      source: 'pasted',
      origin: { kind: 'paste' },
    });
  });

  it('takes expected values from the reference for expected_by "reference" tests', async () => {
    const { deps, writer } = setup();
    const spec = copyOf(GOOD);
    (spec.tests as Record<string, unknown>[]).push({
      visibility: 'hidden',
      category: 'large input',
      input: { readings: [2, 4, 6, 8, 10, 11] },
      expected_by: 'reference',
    });
    expect((await createProblem(deps, spec)).ok).toBe(true);
    const tests = (
      parseJson(writer.written.get('count-even-readings')!.files['tests.json']!) as {
        tests: { id: string; expected: unknown }[];
      }
    ).tests;
    expect(tests.at(-1)).toMatchObject({ id: 'hidden-4', expected: 5 });
  });

  it('runs model-written code only in Pyodide, whatever else the registry has', async () => {
    const registry: Record<ExecutorId, FunctionExecutor> = {
      pyodide: new FunctionExecutor('pyodide'),
      local: new FunctionExecutor('local'),
      container: new FunctionExecutor('container'),
    };
    const asked: ExecutorId[] = [];
    const { deps } = setup({
      executors: (id) => {
        asked.push(id);
        return registry[id];
      },
    });
    expect((await createProblem(deps, copyOf(GOOD))).ok).toBe(true);
    expect(asked).toEqual(['pyodide']);
    expect(registry.pyodide.jobs).toHaveLength(2);
    expect(registry.local.jobs).toHaveLength(0);
    expect(registry.container.jobs).toHaveLength(0);

    // An executor that is not Pyodide is refused, even when handed over as one.
    const local = new FunctionExecutor('local');
    const other = setup({ executors: () => local });
    const out = await createProblem(other.deps, copyOf(GOOD));
    expect(out).toMatchObject({ ok: false });
    expect(String(out.error)).toContain('Pyodide');
    expect(local.jobs).toHaveLength(0);
    expect(other.writer.written.size).toBe(0);
  });
});
