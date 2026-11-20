/**
 * The container executor (SPEC §6.5). A fake `docker` (POSIX shell) checks
 * the exact commands, fallback, missing image and pull progress; the real
 * suite runs when Docker is running and `ALGOTUTOR_TEST_RUNNER_IMAGE` names a
 * local image with `cargo` and `go` (CI builds `test-image/Dockerfile`).
 */
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  metaSchema,
  parseJson,
  testsFileSchema,
  type Executor,
  type ProblemMeta,
  type RunJob,
  type RunReport,
  type TestCase,
} from '@algo/core';
import {
  containerRunArgs,
  ContainerExecutor,
  runnerImage,
  type ContainerEvent,
  type PullProgress,
} from './container-executor';

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
  dir = await mkdtemp(join(tmpdir(), 'container-exec-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

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

const IMAGE = 'example.test/runner:1.0.0';

/**
 * A fake `docker`: logs each command line, answers `version`, `image
 * inspect`, `run`, `exec` (the build prints a Go compile error), `rm`, `pull`.
 */
async function fakeDocker(opts: { running?: boolean; image?: boolean } = {}): Promise<{
  bin: string;
  log: string;
}> {
  const bin = await mkdtemp(join(dir, 'fake-'));
  const log = join(bin, 'log');
  const server = opts.running === false ? 'null' : '{"Version":"29.0.0"}';
  const script = `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
case "$1" in
  version) echo '{"Client":{"Version":"29.0.0","Context":"default"},"Server":${server}}'
           [ '${server}' = 'null' ] && { echo 'Cannot connect to the Docker daemon' >&2; exit 1; }
           exit 0 ;;
  image) exit ${opts.image === false ? 1 : 0} ;;
  run) vol=; prev=  # /bin/ls: the PATH the executor passes on macOS has no /bin
       for a in "$@"; do [ "$prev" = --volume ] && vol="\${a%%:*}"; prev="$a"; done
       /bin/ls -l "$vol" >> '${log}.files' 2>&1; echo abc123; exit 0 ;;
  exec) echo './solution.go:4:15: cannot use "no" (untyped string constant) as int value' >&2; exit 1 ;;
  rm) exit 0 ;;
  pull) echo '1.0.0: Pulling from runner'
        echo 'aaaaaaaaaaaa: Pulling fs layer'
        echo 'bbbbbbbbbbbb: Already exists'
        echo 'aaaaaaaaaaaa: Download complete'
        echo 'aaaaaaaaaaaa: Pull complete'
        echo 'Status: Downloaded newer image'
        exit 0 ;;
esac
exit 2
`;
  await writeFile(join(bin, 'docker'), script);
  await chmod(join(bin, 'docker'), 0o755);
  return { bin, log };
}

const lines = async (log: string): Promise<string[]> =>
  (await readFile(log, 'utf8')).trim().split('\n');

describe('run flags', () => {
  it('are exactly the hardened set (SPEC §6.5)', () => {
    expect(
      containerRunArgs({
        name: 'algo-job-1',
        image: IMAGE,
        memoryMb: 768,
        jobDir: '/data/jobs/1',
        sleepSeconds: 90.5,
      }),
    ).toEqual([
      'run',
      '--detach',
      '--name',
      'algo-job-1',
      '--label',
      'algo.job=1',
      '--pull',
      'never',
      '--rm',
      '--network',
      'none',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--user',
      '65534:65534',
      '--pids-limit',
      '128',
      '--memory',
      '768m',
      '--memory-swap',
      '768m',
      '--cpus',
      '1',
      '--tmpfs',
      '/tmp:rw,noexec,size=64m',
      '--tmpfs',
      '/build:rw,exec,size=256m,mode=1777',
      '--volume',
      '/data/jobs/1:/job:ro',
      '--workdir',
      '/build',
      '--env',
      'HOME=/build/home',
      '--env',
      'CARGO_HOME=/build/cargo-home',
      '--env',
      'CARGO_TERM_COLOR=never',
      '--env',
      'GOCACHE=/build/go-cache',
      '--env',
      'GOPATH=/build/go',
      '--env',
      'GOTOOLCHAIN=local',
      '--env',
      'GOPROXY=off',
      '--env',
      'GOFLAGS=-buildvcs=false',
      '--env',
      'CGO_ENABLED=0',
      IMAGE,
      'sleep',
      '91',
    ]);
  });

  it('keeps a memory floor for the compilers', () => {
    const args = containerRunArgs({
      name: 'n',
      image: IMAGE,
      memoryMb: 64,
      jobDir: '/j',
      sleepSeconds: 1,
    });
    expect(args[args.indexOf('--memory') + 1]).toBe('512m');
  });

  it('names the runner image by app version', () => {
    expect(runnerImage('2.0.0')).toBe('ghcr.io/hqazi/algo-runner:2.0.0');
  });
});

describe.skipIf(process.platform === 'win32')('with a fake docker', () => {
  const make = (
    bin: string,
    extra: Partial<ConstructorParameters<typeof ContainerExecutor>[0]> = {},
  ) =>
    new ContainerExecutor({
      runtime: 'docker',
      image: IMAGE,
      jobsDir: join(dir, 'jobs'),
      runnersDir: RUNNERS,
      env: { PATH: bin },
      platform: 'linux',
      ...extra,
    });

  it('runs the exact commands, reports the compile error, cleans up', async () => {
    const f = await fakeDocker();
    const events: ContainerEvent[] = [];
    const ex = make(f.bin, { onEvent: (e) => events.push(e) });
    const r = await ex.run(job('go', 'package main\n'));
    expect(r.error?.kind).toBe('compile');
    expect(r.results[0]).toMatchObject({ status: 'error', errorType: 'compile error', line: 4 });

    const start = events.find((e) => e.kind === 'start');
    expect(start?.kind).toBe('start');
    if (start?.kind !== 'start') return;
    const jobDir = start.args[start.args.indexOf('--volume') + 1]!.replace(/:\/job:ro$/, '');
    expect(start.args).toEqual(
      containerRunArgs({
        name: start.name,
        image: IMAGE,
        memoryMb: 256,
        jobDir,
        sleepSeconds: Number(start.args.at(-1)),
      }),
    );
    expect(start.name).toMatch(/^algo-job-[0-9a-f]{12}$/);
    expect(await lines(f.log)).toEqual([
      'version --format json',
      `image inspect --format {{.Id}} ${IMAGE}`,
      start.args.join(' '),
      `exec ${start.name} sh -c cp -R /job/. /build/src && cd /build/src && exec "$@" sh go build -o harness .`,
      `rm --force ${start.name}`,
    ]);
    // The project was readable by others when the container started, and is gone now.
    const listing = await readFile(`${f.log}.files`, 'utf8');
    expect(listing).toMatch(/-rw-r--r--[@+.]? .* go\.mod/);
    expect(listing).toMatch(/-rw-r--r--[@+.]? .* solution\.go/);
    expect(await readdir(join(dir, 'jobs'))).toEqual([]);
  });

  it('reports a missing image as runtime-missing, without starting anything', async () => {
    const f = await fakeDocker({ image: false });
    const r = await make(f.bin).run(job('rust', 'x'));
    expect(r.error).toMatchObject({ kind: 'runtime-missing' });
    expect(r.error?.message).toMatch(/runner image .* Pull|pull it/);
    expect((await lines(f.log)).some((l) => l.startsWith('run '))).toBe(false);
    expect(await make(f.bin).status()).toMatchObject({ available: false });
  });

  it('falls back to local with one notice while the runtime is down', async () => {
    const f = await fakeDocker({ running: false });
    const notices: string[] = [];
    const ran: RunJob[] = [];
    const fallback: Executor = {
      id: 'local',
      status: () => Promise.resolve({ available: true }),
      run: (j): Promise<RunReport> => {
        ran.push(j);
        return Promise.resolve({ ok: true, results: [], durationMs: 1 });
      },
    };
    const ex = make(f.bin, { fallback, onNotice: (m) => notices.push(m) });
    await ex.run(job('go', 'a'));
    await ex.run(job('go', 'b'));
    expect(ran.map((j) => j.code)).toEqual(['a', 'b']);
    expect(notices).toEqual([
      'docker is installed but not running (start it: sudo systemctl start docker); running with the local toolchains instead',
    ]);
    // Without a fallback it is runtime-missing.
    const r = await make(f.bin).run(job('go', 'a'));
    expect(r.error).toMatchObject({ kind: 'runtime-missing' });
    expect(await make(f.bin).status()).toMatchObject({ available: false });
  });

  it('reports pull progress', async () => {
    const f = await fakeDocker();
    const seen: PullProgress[] = [];
    const r = await make(f.bin).pull((p) => seen.push(p));
    expect(r).toEqual({ ok: true, message: `pulled ${IMAGE}` });
    expect((await lines(f.log)).at(-1)).toBe(`pull ${IMAGE}`);
    expect(seen.map((p) => p.layers)).toEqual([
      undefined,
      { done: 0, total: 1 },
      { done: 1, total: 2 },
      { done: 1, total: 2 },
      { done: 2, total: 2 },
      { done: 2, total: 2 },
    ]);
    expect(seen.at(-1)?.line).toBe('Status: Downloaded newer image');
  });

  it('does not run Python', async () => {
    const f = await fakeDocker();
    const r = await make(f.bin).run({ ...job('go', ''), language: 'python' });
    expect(r.error?.kind).toBe('runtime-missing');
  });
});

// ------------------------------------------------------------ real Docker

const REAL_IMAGE = process.env['ALGOTUTOR_TEST_RUNNER_IMAGE'];
const dockerReady = (): boolean => {
  if (!REAL_IMAGE) return false;
  const r = spawnSync('docker', ['image', 'inspect', REAL_IMAGE], { stdio: 'ignore' });
  return r.status === 0;
};

const CODE = {
  rust: {
    loopOnEmpty:
      'pub fn best_team(scores: Vec<(char, i64)>) -> Option<(char, i64)> {\n    if scores.is_empty() {\n        let mut i: u64 = 1;\n        while std::hint::black_box(i) != 0 { i = i.wrapping_add(2); }\n    }\n    let mut best: Option<(char, i64)> = None;\n    for s in scores { if best.map_or(true, |b| s.1 > b.1) { best = Some(s); } }\n    best\n}\n',
    network:
      'pub fn best_team(_scores: Vec<(char, i64)>) -> Option<(char, i64)> {\n    match std::net::TcpStream::connect("1.1.1.1:80") {\n        Ok(_) => Some((\'!\', 0)),\n        Err(e) => panic!("connect failed: {e}"),\n    }\n}\n',
  },
  go: {
    loopOnEmpty:
      'package main\n\nfunc bestTeam(scores []Tuple) *Tuple {\n\tif len(scores) == 0 {\n\t\tfor {\n\t\t}\n\t}\n\tvar best *Tuple\n\tfor i := range scores {\n\t\tif best == nil || scores[i].V1 > best.V1 {\n\t\t\tbest = &scores[i]\n\t\t}\n\t}\n\treturn best\n}\n',
    network:
      'package main\n\nimport "net"\n\nfunc bestTeam(scores []Tuple) *Tuple {\n\tc, err := net.Dial("tcp", "1.1.1.1:80")\n\tif err != nil {\n\t\tpanic("connect failed: " + err.Error())\n\t}\n\tc.Close()\n\treturn &Tuple{V0: \'!\', V1: 0}\n}\n',
  },
} as const;

describe.skipIf(!dockerReady())('with the real Docker', { timeout: 300_000 }, () => {
  for (const language of ['rust', 'go'] as const) {
    describe(language, () => {
      let ex: ContainerExecutor;
      let good: string;
      beforeAll(async () => {
        ex = new ContainerExecutor({
          runtime: 'docker',
          image: REAL_IMAGE!,
          jobsDir: join(dir, 'real-jobs'),
          runnersDir: RUNNERS,
        });
        good = await readFile(
          join(RUNNERS, language, 'check', `best-team.${language === 'rust' ? 'rs' : 'go'}`),
          'utf8',
        );
      });

      it('is available', async () => {
        expect(await ex.status()).toMatchObject({ available: true });
      });

      it('passes a correct solution', async () => {
        const r = await ex.run(job(language, good));
        expect(r.error).toBeUndefined();
        expect(r.results.map((x) => x.status)).toEqual(tests.map(() => 'pass'));
      });

      it('times out one test and runs the rest', async () => {
        const events: ContainerEvent[] = [];
        const timed = new ContainerExecutor({
          runtime: 'docker',
          image: REAL_IMAGE!,
          jobsDir: join(dir, 'real-jobs'),
          runnersDir: RUNNERS,
          onEvent: (e) => events.push(e),
        });
        const r = await timed.run(job(language, CODE[language].loopOnEmpty, { timeLimitMs: 500 }));
        expect(r.results.map((x) => x.status)).toEqual(
          tests.map((_, i) => (i === 1 ? 'timeout' : 'pass')),
        );
        expect(events.filter((e) => e.kind === 'spawn')).toHaveLength(2);
      });

      it('has no network: a solution that connects fails', async () => {
        const r = await ex.run(job(language, CODE[language].network));
        expect(r.error).toBeUndefined();
        expect(r.results[0]).toMatchObject({ status: 'error' });
        expect(r.results[0]!.message).toMatch(/connect failed: .*(unreachable|Network)/i);
      });

      it('leaves no container and no job folder behind', async () => {
        const ps = spawnSync('docker', ['ps', '--all', '--quiet', '--filter', 'label=algo.job=1'], {
          encoding: 'utf8',
        });
        expect(ps.stdout.trim()).toBe('');
        expect(await readdir(join(dir, 'real-jobs'))).toEqual([]);
      });
    });
  }
});
