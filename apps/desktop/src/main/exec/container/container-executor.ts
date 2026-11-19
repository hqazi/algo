/**
 * The container executor (SPEC §6.5, T17): builds and runs Rust and Go
 * solutions in the runner image with Podman or Docker, hardened, so the
 * learner's code cannot reach the network or the user's files.
 *
 * Per job (D-31):
 * - The project (generated files, runtime files, the solution) is written to
 *   a fresh host folder and mounted read-only at `/job`.
 * - One container is started detached (`sleep`) with the flags of
 *   `containerRunArgs`. Its root is read-only; `/tmp` is a `noexec` tmpfs;
 *   `/build` is a per-job `exec` tmpfs where the project is copied, built
 *   (Rust's target directory, Go's caches) and run. Nothing persists, so
 *   every run builds from scratch.
 * - The build and each harness process are `exec`s in that container. The
 *   per-test kill timer is the local executor's (shared `runHarnessBatches`);
 *   killing the `exec` client does not stop the process inside, so the
 *   harness writes its pid first and is killed inside the container.
 * - The container (`rm -f`) and the host folder are removed afterwards.
 *
 * If the runtime is not running when a job starts and a fallback executor
 * is given, the job runs there and `onNotice` says so (SPEC §6.5).
 */
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  goProject,
  gradeRun,
  rustProject,
  toHarnessRequest,
  type CancelSignal,
  type Executor,
  type ExecutorStatus,
  type HarnessOutput,
  type HarnessProject,
  type Language,
  type RunJob,
  type RunReport,
} from '@algorithm-tutor/core';
import { cancelled, harnessError, missing, runHarnessBatches } from '../local/batches';
import { compileError, KILL_SLACK_MS } from '../local/local-executor';
import { runProcess, type ProcessResult } from '../local/process';
import { detectRuntime, runtimeEnv, type Runtime, type RuntimeStatus } from '../../runtimes';

export interface ContainerExecutorOptions {
  runtime: Runtime;
  /** The runner image, e.g. `ghcr.io/hqazi/algorithm-tutor-runner:<app version>`. */
  image: string;
  /** Where job folders are made (`<data>/cache/container-jobs`). */
  jobsDir: string;
  /** The app's `content/runners`. */
  runnersDir: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Runs the job when the runtime is not running (the local executor). */
  fallback?: Executor;
  /** A message for the user, e.g. that a job fell back to local. */
  onNotice?: (message: string) => void;
  buildTimeoutMs?: number;
  now?: () => number;
  onEvent?: (event: ContainerEvent) => void;
}

export type ContainerEvent =
  | { kind: 'start'; name: string; args: string[] }
  | { kind: 'build'; language: 'rust' | 'go'; ok: boolean; ms: number }
  | { kind: 'spawn'; language: 'rust' | 'go'; tests: number }
  | { kind: 'fallback'; reason: string };

export interface PullProgress {
  /** The runtime's last output line. */
  line: string;
  /** Docker only: layers finished and seen so far. */
  layers?: { done: number; total: number };
}

/** Docker's default runner image for an app version (built by CI, T19). */
export function runnerImage(appVersion: string): string {
  return `ghcr.io/hqazi/algorithm-tutor-runner:${appVersion}`;
}

/** `exec` overhead before the first test. */
export const CONTAINER_STARTUP_MS = 5000;
/** The container's memory floor, so the compilers fit (D-31). */
export const MIN_MEMORY_MB = 512;
/** The per-job build tmpfs. */
export const BUILD_TMPFS_MB = 256;
const BUILD_TIMEOUT_MS = 300_000;
const COMMAND_TIMEOUT_MS = 60_000;
const PULL_TIMEOUT_MS = 30 * 60_000;

/** The environment inside the container: writable homes and caches under `/build`. */
export const CONTAINER_ENV: Readonly<Record<string, string>> = {
  HOME: '/build/home',
  CARGO_HOME: '/build/cargo-home',
  CARGO_TERM_COLOR: 'never',
  GOCACHE: '/build/go-cache',
  GOPATH: '/build/go',
  GOTOOLCHAIN: 'local',
  GOPROXY: 'off',
  GOFLAGS: '-buildvcs=false',
  CGO_ENABLED: '0',
};

/**
 * `run` arguments for a job's container (SPEC §6.5), after the runtime's
 * program name. The container only sleeps; work is done with `exec`.
 */
export function containerRunArgs(o: {
  name: string;
  image: string;
  memoryMb: number;
  jobDir: string;
  sleepSeconds: number;
}): string[] {
  const memory = `${Math.max(Math.ceil(o.memoryMb), MIN_MEMORY_MB)}m`;
  const args = [
    'run',
    '--detach',
    '--name',
    o.name,
    '--label',
    'algorithm-tutor.job=1',
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
    memory,
    '--memory-swap',
    memory,
    '--cpus',
    '1',
    '--tmpfs',
    '/tmp:rw,noexec,size=64m',
    '--tmpfs',
    `/build:rw,exec,size=${BUILD_TMPFS_MB}m,mode=1777`,
    '--volume',
    `${o.jobDir}:/job:ro`,
    '--workdir',
    '/build',
  ];
  for (const [k, v] of Object.entries(CONTAINER_ENV)) args.push('--env', `${k}=${v}`);
  args.push(o.image, 'sleep', String(Math.max(1, Math.ceil(o.sleepSeconds))));
  return args;
}

type Compiled = 'rust' | 'go';
const isCompiled = (l: Language): l is Compiled => l === 'rust' || l === 'go';

export class ContainerExecutor implements Executor {
  readonly id = 'container' as const;
  readonly runtime: Runtime;
  private readonly env: NodeJS.ProcessEnv;
  private readonly platform: NodeJS.Platform;
  private readonly now: () => number;
  private fellBack = false;

  constructor(private readonly opts: ContainerExecutorOptions) {
    this.runtime = opts.runtime;
    this.platform = opts.platform ?? process.platform;
    this.env = runtimeEnv(opts.env ?? process.env, this.platform);
    this.now = opts.now ?? (() => performance.now());
  }

  get image(): string {
    return this.opts.image;
  }

  /** The runtime's state now (never cached: Settings → Recheck calls this). */
  detect(): Promise<RuntimeStatus> {
    return detectRuntime(this.runtime, this.env, this.platform);
  }

  /** Whether the runner image is on this machine. */
  async hasImage(path?: string): Promise<boolean> {
    const bin = path ?? (await this.detect()).path;
    if (!bin) return false;
    const r = await this.command(bin, ['image', 'inspect', '--format', '{{.Id}}', this.opts.image]);
    return r.code === 0;
  }

  async status(): Promise<ExecutorStatus> {
    const rt = await this.detect();
    if (rt.state !== 'running' || !rt.path) return { available: false, reason: describe(rt) };
    if (!(await this.hasImage(rt.path))) {
      return { available: false, reason: imageMissing(this.opts.image) };
    }
    return {
      available: true,
      versions: { [this.runtime]: rt.version ?? '?', image: this.opts.image },
    };
  }

  async statusFor(language: Language): Promise<ExecutorStatus> {
    if (!isCompiled(language)) {
      return { available: false, reason: `not run in a container: ${language}` };
    }
    return this.status();
  }

  /** Pulls (or updates) the runner image. The only command that uses the network. */
  async pull(
    onProgress?: (p: PullProgress) => void,
    signal?: CancelSignal,
  ): Promise<{ ok: boolean; message: string }> {
    const rt = await this.detect();
    if (rt.state !== 'running' || !rt.path) return { ok: false, message: describe(rt) };
    const layers = new Map<string, boolean>();
    let seen = { out: 0, err: 0 };
    const feed = (text: string, which: 'out' | 'err'): void => {
      const lines = text.slice(seen[which]).split(/\r?\n|\r/);
      const rest = lines.pop() ?? '';
      seen = { ...seen, [which]: text.length - rest.length };
      for (const line of lines.map((l) => l.trim()).filter(Boolean)) {
        const m = /^([0-9a-f]{12}): (.+)$/.exec(line);
        if (m) {
          const done = /^(Pull complete|Already exists)/.test(m[2]!);
          layers.set(m[1]!, done || (layers.get(m[1]!) ?? false));
        }
        const p: PullProgress = { line };
        if (layers.size) {
          p.layers = { done: [...layers.values()].filter(Boolean).length, total: layers.size };
        }
        onProgress?.(p);
      }
    };
    const r = await runProcess([rt.path, 'pull', this.opts.image], {
      cwd: homedir(),
      env: this.env,
      timeoutMs: PULL_TIMEOUT_MS,
      signal,
      platform: this.platform,
      onStdout: (out) => {
        feed(out, 'out');
        return undefined;
      },
      onStderr: (err) => feed(err, 'err'),
    }).catch((e: unknown) => failedResult(e));
    if (r.cancelled) return { ok: false, message: 'the pull was cancelled' };
    if (r.code === 0) return { ok: true, message: `pulled ${this.opts.image}` };
    const why = r.spawnError ?? (r.timedOut ? 'it took too long' : lastLines(r.stderr || r.stdout));
    return { ok: false, message: `${this.runtime} pull ${this.opts.image} failed: ${why}` };
  }

  async run(job: RunJob, signal?: CancelSignal): Promise<RunReport> {
    const t0 = this.now();
    if (isCompiled(job.language) && !signal?.aborted && this.opts.fallback) {
      const rt = await this.detect();
      if (rt.state !== 'running') {
        const reason = describe(rt);
        this.opts.onEvent?.({ kind: 'fallback', reason });
        if (!this.fellBack) {
          this.fellBack = true;
          this.opts.onNotice?.(`${reason}; running with the local toolchains instead`);
        }
        return this.opts.fallback.run(job, signal);
      }
      this.fellBack = false;
    }
    const output = await this.output(job, signal).catch((e: unknown): HarnessOutput => ({
      kind: 'failed',
      error: { kind: 'harness', message: e instanceof Error ? e.message : String(e) },
    }));
    return gradeRun(job, output, Math.round(this.now() - t0));
  }

  // ------------------------------------------------------------ internals

  private async output(job: RunJob, signal?: CancelSignal): Promise<HarnessOutput> {
    const language = job.language;
    if (!isCompiled(language)) {
      return missing(`the container executor runs Rust and Go, not ${language}`);
    }
    if (signal?.aborted) return cancelled([]);
    const rt = await this.detect();
    if (rt.state !== 'running' || !rt.path) return missing(describe(rt));
    const bin = rt.path;
    if (!(await this.hasImage(bin))) return missing(imageMissing(this.opts.image));

    const project = language === 'rust' ? rustProject(job.signature) : goProject(job.signature);
    const id = randomBytes(6).toString('hex');
    const name = `algorithm-tutor-job-${id}`;
    const jobDir = join(this.opts.jobsDir, id);
    const buildMs = this.opts.buildTimeoutMs ?? BUILD_TIMEOUT_MS;
    const perTest = job.timeLimitMs + KILL_SLACK_MS;
    let started = false;
    try {
      await this.writeProject(language, project, jobDir, job.code);
      const args = containerRunArgs({
        name,
        image: this.opts.image,
        memoryMb: job.memoryLimitMb,
        jobDir,
        // A leaked container ends by itself.
        sleepSeconds:
          (buildMs + (CONTAINER_STARTUP_MS + perTest) * (job.tests.length + 1)) / 1000 + 60,
      });
      this.opts.onEvent?.({ kind: 'start', name, args });
      const up = await this.command(bin, args, signal);
      started = up.code === 0;
      if (up.cancelled) return cancelled([]);
      if (!started) {
        return harnessError(
          `${this.runtime} could not start the container: ${up.spawnError ?? lastLines(up.stderr)}`,
        );
      }

      const t0 = this.now();
      const build = await runProcess(
        [
          bin,
          'exec',
          name,
          'sh',
          '-c',
          'cp -R /job/. /build/src && cd /build/src && exec "$@"',
          'sh',
          ...project.build,
        ],
        { cwd: jobDir, env: this.env, timeoutMs: buildMs, signal, platform: this.platform },
      );
      const ok = build.code === 0 && !build.timedOut && !build.cancelled && !build.spawnError;
      this.opts.onEvent?.({ kind: 'build', language, ok, ms: Math.round(this.now() - t0) });
      if (build.cancelled) return cancelled([]);
      if (build.spawnError) return harnessError(`${this.runtime} exec failed: ${build.spawnError}`);
      if (build.timedOut) {
        return harnessError(`the build took longer than ${Math.round(buildMs / 1000)} s`);
      }
      if (build.code !== 0) {
        const { message, line } = compileError(
          language,
          `${build.stderr}\n${build.stdout}`,
          '/build/src',
        );
        return { kind: 'load-error', errorType: 'compile error', message, line };
      }

      return await runHarnessBatches({
        inputs: toHarnessRequest(job).inputs,
        perTestMs: perTest,
        startupMs: CONTAINER_STARTUP_MS,
        signal,
        onSpawn: (tests) => this.opts.onEvent?.({ kind: 'spawn', language, tests }),
        spawn: async (run, i) => {
          const pidFile = `/build/run-${i}.pid`;
          const r = await runProcess(
            [
              bin,
              'exec',
              '--interactive',
              '--workdir',
              '/build/src',
              name,
              'sh',
              '-c',
              `echo $$ > ${pidFile} && exec "$@"`,
              'sh',
              `./${project.run[0]!}`,
              ...project.run.slice(1),
            ],
            {
              cwd: jobDir,
              env: this.env,
              input: run.input,
              timeoutMs: run.timeoutMs,
              signal: run.signal,
              platform: this.platform,
              onStdout: run.onStdout,
            },
          );
          // Killing the client leaves the process running inside the container.
          if (r.timedOut || r.cancelled || r.overflowed) {
            await this.command(bin, [
              'exec',
              name,
              'sh',
              '-c',
              `kill -KILL "$(cat ${pidFile})" 2>/dev/null; true`,
            ]);
          }
          return r;
        },
      });
    } finally {
      if (started) await this.command(bin, ['rm', '--force', name]).catch(() => undefined);
      await rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** The project files, readable by the container's user (65534). */
  private async writeProject(
    language: Compiled,
    project: HarnessProject,
    dir: string,
    code: string,
  ): Promise<void> {
    const files: { path: string; content: string }[] = [...project.files];
    for (const f of project.runtimeFiles) {
      files.push({
        path: f.path,
        content: await readFile(join(this.opts.runnersDir, language, f.from), 'utf8'),
      });
    }
    files.push({ path: project.solutionPath, content: code });
    await mkdir(dir, { recursive: true });
    await chmod(dir, 0o755);
    for (const f of files) {
      const path = join(dir, f.path);
      await mkdir(dirname(path), { recursive: true, mode: 0o755 });
      await writeFile(path, f.content, { mode: 0o644 });
    }
  }

  private command(bin: string, args: string[], signal?: CancelSignal): Promise<ProcessResult> {
    return runProcess([bin, ...args], {
      cwd: homedir(),
      env: this.env,
      timeoutMs: COMMAND_TIMEOUT_MS,
      signal,
      platform: this.platform,
    }).catch((e: unknown) => failedResult(e));
  }
}

/** Why a runtime cannot run jobs, in a sentence. */
export function describe(rt: RuntimeStatus): string {
  if (rt.state === 'not-found') return `${rt.runtime} was not found`;
  if (rt.state === 'installed-not-running') {
    const hint = rt.startHint ? ` (start it: ${rt.startHint})` : '';
    return `${rt.runtime} is installed but not running${hint}`;
  }
  return `${rt.runtime} is running`;
}

function imageMissing(image: string): string {
  return `the runner image ${image} is not on this machine; pull it in Settings → Code execution`;
}

function lastLines(text: string): string {
  return text.trim().split('\n').slice(-3).join('\n').slice(0, 400);
}

function failedResult(e: unknown): ProcessResult {
  return {
    code: null,
    stdout: '',
    stderr: '',
    timedOut: false,
    cancelled: false,
    overflowed: false,
    spawnError: e instanceof Error ? e.message : String(e),
  };
}
