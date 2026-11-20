/**
 * The local toolchain executor with the real `cargo` and `go` (SPEC §6.4).
 * Each language's suite runs only where its toolchain is installed (CI's
 * runner images have both on Linux, macOS and Windows); the rest of the
 * behaviour is covered without toolchains below.
 */
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  goStub,
  metaSchema,
  parseJson,
  rustStub,
  testsFileSchema,
  type ProblemMeta,
  type RunJob,
  type TestCase,
} from '@algo/core';
import { findOnPath, parseVersion, toolPath } from './detect';
import {
  childEnv,
  compileError,
  LocalExecutor,
  projectKey,
  type LocalEvent,
} from './local-executor';
import { runProcess } from './process';

const ROOT = fileURLToPath(new URL('../../../../../../', import.meta.url));
const RUNNERS = join(ROOT, 'content', 'runners');
const FIXTURE = join(ROOT, 'packages', 'core', 'src', 'langs', 'fixtures', 'best-team');

let meta: ProblemMeta;
let tests: TestCase[];
let dir: string;

beforeAll(async () => {
  meta = metaSchema.parse(parseJson(await readFile(join(FIXTURE, 'meta.json'), 'utf8')));
  tests = testsFileSchema.parse(
    parseJson(await readFile(join(FIXTURE, 'tests.json'), 'utf8')),
  ).tests;
  dir = await mkdtemp(join(tmpdir(), 'local-exec-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const has = (cmd: string, arg: string): boolean => {
  const r = spawnSync(cmd, [arg], {
    encoding: 'utf8',
    env: childEnv(process.env, process.platform),
  });
  return r.status === 0;
};
const HAS = { rust: has('cargo', '--version'), go: has('go', 'version') };

function job(language: 'rust' | 'go', code: string, extra: Partial<RunJob> = {}): RunJob {
  return {
    language,
    slug: 'best-team',
    code,
    signature: meta.signature,
    compare: meta.compare,
    tests,
    timeLimitMs: 2000,
    memoryLimitMb: 256,
    ...extra,
  };
}

const CODE = {
  rust: {
    wrong:
      'pub fn best_team(scores: Vec<(char, i64)>) -> Option<(char, i64)> {\n    scores.first().copied()\n}\n',
    broken:
      'pub fn best_team(scores: Vec<(char, i64)>) -> Option<(char, i64)> {\n    let x: i64 = "no";\n    None\n}\n',
    // Endless only for the empty list (the second test).
    loopOnEmpty:
      'pub fn best_team(scores: Vec<(char, i64)>) -> Option<(char, i64)> {\n    if scores.is_empty() {\n        let mut i: u64 = 1;\n        while std::hint::black_box(i) != 0 { i = i.wrapping_add(2); }\n    }\n    let mut best: Option<(char, i64)> = None;\n    for s in scores { if best.map_or(true, |b| s.1 > b.1) { best = Some(s); } }\n    best\n}\n',
  },
  go: {
    wrong:
      'package main\n\nfunc bestTeam(scores []Tuple) *Tuple {\n\tif len(scores) == 0 {\n\t\treturn nil\n\t}\n\treturn &scores[0]\n}\n',
    broken:
      'package main\n\nfunc bestTeam(scores []Tuple) *Tuple {\n\tvar x int = "no"\n\treturn nil\n}\n',
    loopOnEmpty:
      'package main\n\nfunc bestTeam(scores []Tuple) *Tuple {\n\tif len(scores) == 0 {\n\t\tfor {\n\t\t}\n\t}\n\tvar best *Tuple\n\tfor i := range scores {\n\t\tif best == nil || scores[i].V1 > best.V1 {\n\t\t\tbest = &scores[i]\n\t\t}\n\t}\n\treturn best\n}\n',
  },
} as const;

for (const language of ['rust', 'go'] as const) {
  describe.skipIf(!HAS[language])(
    `${language} with the real toolchain`,
    { timeout: 300_000 },
    () => {
      const events: LocalEvent[] = [];
      let executor: LocalExecutor;
      let good: string;
      beforeAll(async () => {
        executor = new LocalExecutor({
          buildDir: join(dir, 'build'),
          runnersDir: RUNNERS,
          onEvent: (e) => events.push(e),
        });
        good = await readFile(
          join(RUNNERS, language, 'check', `best-team.${language === 'rust' ? 'rs' : 'go'}`),
          'utf8',
        );
      });
      const builds = (): string[] => events.filter((e) => e.kind !== 'spawn').map((e) => e.kind);

      it('detects the toolchain', async () => {
        const s = await executor.status();
        expect(s.available).toBe(true);
        expect(s.versions?.[language === 'rust' ? 'cargo' : 'go']).toMatch(/^\d+\.\d+/);
      });

      it('passes a correct solution, and reruns without rebuilding', async () => {
        events.length = 0;
        const first = await executor.run(job(language, good));
        expect(first.ok).toBe(true);
        expect(first.results.every((r) => r.status === 'pass')).toBe(true);
        expect(first.results).toHaveLength(tests.length);
        const projectDir = join(dir, 'build', language, 'best-team');
        const generated = language === 'rust' ? 'Cargo.toml' : 'go.mod';
        const before = (await stat(join(projectDir, generated))).mtimeMs;

        const again = await executor.run(job(language, good));
        expect(again.results.every((r) => r.status === 'pass')).toBe(true);
        expect(builds()).toEqual(['build', 'build-skipped']);

        // A changed solution rebuilds in the same project; other files are untouched.
        const wrong = await executor.run(job(language, CODE[language].wrong));
        expect(builds()).toEqual(['build', 'build-skipped', 'build']);
        expect((await stat(join(projectDir, generated))).mtimeMs).toBe(before);
        expect(wrong.ok).toBe(true);
        expect(wrong.results[0]).toMatchObject({
          status: 'fail',
          expected: ['b', 7],
          actual: ['a', 3],
        });
        expect(wrong.results[1]!.status).toBe('pass');
      });

      it('reports a compile error with the solution line', async () => {
        const r = await executor.run(job(language, CODE[language].broken));
        expect(r.ok).toBe(false);
        expect(r.error?.kind).toBe('compile');
        expect(r.error?.message).toMatch(
          language === 'rust' ? /mismatched types/ : /cannot use "no"/,
        );
        expect(r.error?.message).not.toContain(dir);
        expect(r.results.every((x) => x.status === 'error')).toBe(true);
        expect(r.results[0]).toMatchObject({
          errorType: 'compile error',
          line: 4 - (language === 'rust' ? 2 : 0),
        });
        // The failed build is not cached as good: fixing it builds again and passes.
        const fixed = await executor.run(job(language, good));
        expect(fixed.results.every((x) => x.status === 'pass')).toBe(true);
      });

      it('times out one test, kills it, and runs the rest in a fresh process', async () => {
        events.length = 0;
        const t0 = Date.now();
        const r = await executor.run(
          job(language, CODE[language].loopOnEmpty, { timeLimitMs: 300 }),
        );
        expect(r.ok).toBe(true);
        expect(r.results.map((x) => x.status)).toEqual(
          tests.map((t, i) => (i === 1 ? 'timeout' : 'pass')),
        );
        expect(events.filter((e) => e.kind === 'spawn')).toHaveLength(2);
        expect(Date.now() - t0).toBeLessThan(120_000);
      });

      it('cancels a running job', async () => {
        const ac = new AbortController();
        const running = executor.run(
          job(language, CODE[language].loopOnEmpty, { timeLimitMs: 60_000 }),
          ac.signal,
        );
        setTimeout(() => ac.abort(), 1500);
        const r = await running;
        expect(r.error?.kind).toBe('cancelled');
        expect(r.results[0]!.status).toBe('pass');
      });

      it('keys the cache by signature when there is no slug', async () => {
        const stub = language === 'rust' ? rustStub(meta.signature) : goStub(meta.signature);
        const r = await executor.run(job(language, stub, { slug: undefined }));
        expect(r.results[0]).toMatchObject({ status: 'error', errorType: 'panic' });
        expect(
          await stat(join(dir, 'build', language, projectKey({ signature: meta.signature }))),
        ).toBeTruthy();
      });
    },
  );
}

describe('without toolchains', () => {
  it('says what to install when the toolchain is missing', async () => {
    const executor = new LocalExecutor({
      buildDir: join(dir, 'none'),
      runnersDir: RUNNERS,
      env: { PATH: join(dir, 'empty') },
      extraToolDirs: [],
    });
    const r = await executor.run(job('go', 'package main\n'));
    expect(r.error).toEqual({
      kind: 'runtime-missing',
      message: 'go was not found on PATH; install Go from https://go.dev/dl',
    });
    expect(r.results.every((x) => x.status === 'error')).toBe(true);
    const s = await executor.status();
    expect(s.available).toBe(false);
    expect(s.reason).toContain('cargo was not found');
    const py = await executor.run({ ...job('go', ''), language: 'python' });
    expect(py.error?.kind).toBe('runtime-missing');
  });

  it.skipIf(process.platform === 'win32')(
    'detects a toolchain on PATH and its version',
    async () => {
      const bin = join(dir, 'fakebin');
      await import('node:fs/promises').then((fs) => fs.mkdir(bin, { recursive: true }));
      await writeFile(join(bin, 'cargo'), '#!/bin/sh\necho "cargo 1.80.1 (abc 2024-01-01)"\n');
      await chmod(join(bin, 'cargo'), 0o755);
      const executor = new LocalExecutor({
        buildDir: join(dir, 'fake'),
        runnersDir: RUNNERS,
        env: { PATH: bin },
        extraToolDirs: [],
      });
      const [cargo, go] = await executor.toolchains();
      expect(cargo).toEqual({
        tool: 'cargo',
        found: true,
        path: join(bin, 'cargo'),
        version: '1.80.1',
      });
      expect(go).toMatchObject({ tool: 'go', found: false });
      expect(findOnPath('cargo', `${join(dir, 'nope')}:${bin}`, 'linux')).toBe(join(bin, 'cargo'));
    },
  );

  it('parses versions', () => {
    expect(parseVersion('cargo', 'cargo 1.97.0 (c980f4866 2026-06-30)\n')).toBe('1.97.0');
    expect(parseVersion('go', 'go version go1.24.7 linux/amd64\n')).toBe('1.24.7');
    expect(parseVersion('go', 'go version devel +abc\n')).toBeNull();
  });

  it('builds the child environment without the app secrets, Go offline', () => {
    const env = childEnv(
      {
        PATH: '/bin',
        ANTHROPIC_API_KEY: 'k',
        ELECTRON_RUN_AS_NODE: '1',
        GOFLAGS: '-x',
        HOME: '/h',
      },
      'linux',
      ['/opt/go/bin'],
    );
    expect(env).toEqual({
      PATH: '/bin:/opt/go/bin',
      HOME: '/h',
      GOTOOLCHAIN: 'local',
      GOPROXY: 'off',
      CARGO_TERM_COLOR: 'never',
    });
    expect(toolPath({ Path: 'C:\\a' }, 'win32', ['C:\\b'])).toBe('C:\\a;C:\\b');
  });

  it('keeps compiler errors, drops warnings and finds the solution line', () => {
    const rust = compileError(
      'rust',
      'warning: unused variable: `x`\n --> /p/src/main.rs:3:9\n\nerror[E0308]: mismatched types\n --> /p/src/solution.rs:2:18\n  |\n\nerror: could not compile `harness` (bin "harness") due to 1 previous error\n',
      '/p',
    );
    expect(rust).toEqual({
      message: 'error[E0308]: mismatched types\n --> ./src/solution.rs:2:18\n  |',
      line: 2,
    });
    const go = compileError('go', '# solution\n./solution.go:4:14: cannot use "no"\n', '/p');
    expect(go).toEqual({ message: './solution.go:4:14: cannot use "no"', line: 4 });
  });

  it('uses the slug as the cache key when it is safe', () => {
    const signature = { function: 'f', params: [], returns: 'int' };
    expect(projectKey({ slug: 'two-sum', signature })).toBe('two-sum');
    expect(projectKey({ slug: '../x', signature })).toMatch(/^sig-[0-9a-f]{16}$/);
  });

  it.skipIf(process.platform === 'win32')('kills the whole process group on timeout', async () => {
    const t0 = Date.now();
    const r = await runProcess(['sh', '-c', 'sleep 30 & sleep 30'], {
      cwd: dir,
      env: process.env,
      timeoutMs: 300,
    });
    expect(r.timedOut).toBe(true);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});
