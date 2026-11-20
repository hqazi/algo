/**
 * The local toolchain executor (SPEC §6.4, T16): runs Rust and Go solutions
 * with the user's own `cargo` and `go`. No sandbox: the user's code runs with
 * the user's rights (Settings says so). Model-written code never comes here
 * (SPEC §6.3): only the learner's solution.
 *
 * - One cached project per problem under `<buildDir>/<lang>/<slug>/`. Files
 *   are rewritten only when their content changes, so `cargo` / `go build`
 *   rebuild incrementally; an unchanged project (same files, same toolchain)
 *   is not rebuilt at all.
 * - A build failure is `compile` (every test `error`), with the first
 *   compiler errors and the solution line.
 * - The harness runs as one process for all tests. Each test gets its limit
 *   (plus 250 ms) from the previous result line; past it the process tree is
 *   killed, that test is `timeout`, and a fresh process runs the rest. A
 *   crash (stack overflow, `process::exit`) is handled the same way.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
} from '@algo/core';
import {
  detectToolchain,
  pathKey,
  TOOLCHAIN_FOR,
  toolPath,
  type Toolchain,
  type ToolchainStatus,
} from './detect';
import { cancelled, harnessError, missing, runHarnessBatches } from './batches';
import { runProcess } from './process';

export interface LocalExecutorOptions {
  /** `<data>/cache/build`. */
  buildDir: string;
  /** The app's `content/runners` (the fixed runtime files). */
  runnersDir: string;
  /** The environment toolchains run with (default: this process's). */
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Folders searched after PATH (default: the usual install folders). */
  extraToolDirs?: readonly string[];
  buildTimeoutMs?: number;
  now?: () => number;
  /** What each run did, for logs and tests. */
  onEvent?: (event: LocalEvent) => void;
}

export type LocalEvent =
  | { kind: 'build'; language: 'rust' | 'go'; dir: string; ok: boolean; ms: number }
  | { kind: 'build-skipped'; language: 'rust' | 'go'; dir: string }
  | { kind: 'spawn'; language: 'rust' | 'go'; tests: number };

/** Time for a harness process to start before its first test. */
export const STARTUP_MS = 1000;
/** Added to each test's limit before the process is killed. */
export const KILL_SLACK_MS = 250;
const BUILD_TIMEOUT_MS = 300_000;
const STAMP = '.tutor-build-stamp';
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

type Compiled = 'rust' | 'go';
const isCompiled = (l: Language): l is Compiled => l === 'rust' || l === 'go';

export class LocalExecutor implements Executor {
  readonly id = 'local' as const;
  private readonly detected = new Map<Toolchain, Promise<ToolchainStatus>>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly platform: NodeJS.Platform;
  private readonly env: NodeJS.ProcessEnv;
  private readonly now: () => number;

  constructor(private readonly opts: LocalExecutorOptions) {
    this.platform = opts.platform ?? process.platform;
    this.env = childEnv(opts.env ?? process.env, this.platform, opts.extraToolDirs);
    this.now = opts.now ?? (() => performance.now());
  }

  /** `cargo` and `go`: found (path, version) or why not. Cached until `recheck`. */
  toolchains(): Promise<ToolchainStatus[]> {
    return Promise.all((['cargo', 'go'] as const).map((t) => this.detect(t)));
  }

  /** Forget what was detected (Settings → Recheck). */
  recheck(): void {
    this.detected.clear();
  }

  async status(): Promise<ExecutorStatus> {
    const found = await this.toolchains();
    const versions: Record<string, string> = {};
    for (const t of found) if (t.found) versions[t.tool] = t.version;
    if (Object.keys(versions).length) return { available: true, versions };
    return {
      available: false,
      reason: found.map((t) => (t.found ? '' : t.reason)).join('; '),
    };
  }

  async run(job: RunJob, signal?: CancelSignal): Promise<RunReport> {
    const t0 = this.now();
    const output = await this.output(job, signal).catch((e: unknown): HarnessOutput => ({
      kind: 'failed',
      error: { kind: 'harness', message: e instanceof Error ? e.message : String(e) },
    }));
    return gradeRun(job, output, Math.round(this.now() - t0));
  }

  /** Whether `language` can run here, for the language picker. */
  async statusFor(language: Language): Promise<ExecutorStatus> {
    if (!isCompiled(language)) return { available: false, reason: `not run locally: ${language}` };
    const t = await this.detect(TOOLCHAIN_FOR[language]);
    return t.found
      ? { available: true, versions: { [t.tool]: t.version } }
      : { available: false, reason: t.reason };
  }

  // ------------------------------------------------------------ internals

  private detect(tool: Toolchain): Promise<ToolchainStatus> {
    let p = this.detected.get(tool);
    if (!p) {
      p = detectToolchain(tool, this.env, this.platform);
      this.detected.set(tool, p);
      // A missing toolchain is looked for again next time (the user may install it).
      void p.then((s) => {
        if (!s.found && this.detected.get(tool) === p) this.detected.delete(tool);
      });
    }
    return p;
  }

  private async output(job: RunJob, signal?: CancelSignal): Promise<HarnessOutput> {
    const language = job.language;
    if (!isCompiled(language)) {
      return missing(`the local executor runs Rust and Go, not ${language}`);
    }
    if (signal?.aborted) return cancelled([]);
    const tool = await this.detect(TOOLCHAIN_FOR[language]);
    if (!tool.found) return missing(tool.reason);
    const project = language === 'rust' ? rustProject(job.signature) : goProject(job.signature);
    const dir = join(this.opts.buildDir, language, projectKey(job));
    return this.locked(dir, async () => {
      const built = await this.build(language, project, dir, job.code, tool, signal);
      if (built) return built;
      return this.runTests(language, project, dir, job, signal);
    });
  }

  /** One job at a time per project folder. */
  private async locked<T>(dir: string, fn: () => Promise<T>): Promise<T> {
    const before = this.locks.get(dir) ?? Promise.resolve();
    const mine = before.catch(() => undefined).then(fn);
    this.locks.set(dir, mine);
    try {
      return await mine;
    } finally {
      if (this.locks.get(dir) === mine) this.locks.delete(dir);
    }
  }

  /** Writes the project and builds it. Returns an output to stop with, or null to go on. */
  private async build(
    language: Compiled,
    project: HarnessProject,
    dir: string,
    code: string,
    tool: Extract<ToolchainStatus, { found: true }>,
    signal?: CancelSignal,
  ): Promise<HarnessOutput | null> {
    const files: { path: string; content: string }[] = [...project.files];
    for (const f of project.runtimeFiles) {
      files.push({
        path: f.path,
        content: await readFile(join(this.opts.runnersDir, language, f.from), 'utf8'),
      });
    }
    files.push({ path: project.solutionPath, content: code });
    const hash = createHash('sha256');
    hash.update(`${tool.tool} ${tool.version} ${this.platform}\0`);
    for (const f of files) hash.update(`${f.path}\0${f.content}\0`);
    const stamp = hash.digest('hex');

    const binary = join(dir, this.binaryPath(project));
    const stampFile = join(dir, STAMP);
    if ((await readText(stampFile)) === stamp && (await exists(binary))) {
      this.opts.onEvent?.({ kind: 'build-skipped', language, dir });
      return null;
    }
    await rm(stampFile, { force: true });
    for (const f of files) await writeIfChanged(join(dir, f.path), f.content);

    const cmd = [tool.path, ...this.buildArgs(project)];
    const t0 = this.now();
    const r = await runProcess(cmd, {
      cwd: dir,
      env: this.env,
      timeoutMs: this.opts.buildTimeoutMs ?? BUILD_TIMEOUT_MS,
      signal,
      platform: this.platform,
    });
    const ok = r.code === 0 && !r.timedOut && !r.cancelled && !r.spawnError;
    this.opts.onEvent?.({ kind: 'build', language, dir, ok, ms: Math.round(this.now() - t0) });
    if (r.cancelled) return cancelled([]);
    if (r.spawnError) return harnessError(`${tool.tool} could not start: ${r.spawnError}`);
    if (r.timedOut) {
      return harnessError(
        `the build took longer than ${Math.round((this.opts.buildTimeoutMs ?? BUILD_TIMEOUT_MS) / 1000)} s`,
      );
    }
    if (r.code !== 0) {
      const { message, line } = compileError(language, `${r.stderr}\n${r.stdout}`, dir);
      return { kind: 'load-error', errorType: 'compile error', message, line };
    }
    await writeFile(stampFile, stamp);
    return null;
  }

  /** The build command's arguments (Windows: Go writes `harness.exe`). */
  private buildArgs(project: HarnessProject): string[] {
    const args = project.build.slice(1);
    if (this.platform === 'win32' && project.language === 'go') {
      const o = args.indexOf('-o');
      if (o >= 0 && args[o + 1]) args[o + 1] = `${args[o + 1]}.exe`;
    }
    return args;
  }

  private binaryPath(project: HarnessProject): string {
    const bin = project.run[0]!;
    return this.platform === 'win32' ? `${bin}.exe` : bin;
  }

  private async runTests(
    language: Compiled,
    project: HarnessProject,
    dir: string,
    job: RunJob,
    signal?: CancelSignal,
  ): Promise<HarnessOutput> {
    const binary = join(dir, this.binaryPath(project));
    return runHarnessBatches({
      inputs: toHarnessRequest(job).inputs,
      perTestMs: job.timeLimitMs + KILL_SLACK_MS,
      startupMs: STARTUP_MS,
      signal,
      onSpawn: (tests) => this.opts.onEvent?.({ kind: 'spawn', language, tests }),
      spawn: (run) =>
        runProcess([binary, ...project.run.slice(1)], {
          cwd: dir,
          env: this.env,
          input: run.input,
          timeoutMs: run.timeoutMs,
          signal: run.signal,
          platform: this.platform,
          onStdout: run.onStdout,
        }),
    });
  }
}

// ------------------------------------------------------------ helpers

/** The cache folder name: the slug, else a hash of the signature. */
export function projectKey(job: Pick<RunJob, 'slug' | 'signature'>): string {
  if (job.slug && SLUG_RE.test(job.slug)) return job.slug;
  const h = createHash('sha256').update(JSON.stringify(job.signature)).digest('hex');
  return `sig-${h.slice(0, 16)}`;
}

/**
 * The environment toolchains and harnesses run with: the app's, without its
 * own secrets and Electron switches, with the extra tool folders on PATH,
 * and with Go kept offline and on the installed toolchain (D-29).
 */
export function childEnv(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  extraDirs?: readonly string[],
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (/^(ANTHROPIC_|ELECTRON_|ALGOTUTOR_)/i.test(k)) continue;
    if (k === 'GOFLAGS' || k === 'NODE_OPTIONS') continue;
    out[k] = v;
  }
  out[pathKey(env, platform)] = toolPath(env, platform, extraDirs);
  out['GOTOOLCHAIN'] = 'local';
  out['GOPROXY'] = 'off';
  out['CARGO_TERM_COLOR'] = 'never';
  return out;
}

/**
 * The compiler's errors, without warnings and with the project folder
 * removed, and the first line in the solution file they point at.
 */
export function compileError(
  language: Compiled,
  text: string,
  dir: string,
): { message: string; line: number | undefined } {
  const clean = text.split(dir).join('.').replace(/\r\n/g, '\n');
  let kept: string;
  if (language === 'rust') {
    const blocks = clean.split(/\n(?=(?:error|warning)(?:\[\w+\])?: )/);
    kept = blocks
      .filter((b) => /^error/.test(b.trimStart()))
      .filter((b) => !/^error: could not compile/.test(b.trimStart()))
      .map((b) => b.trim())
      .join('\n\n');
  } else {
    kept = clean
      .split('\n')
      .filter((l) => l.trim() && !/^# /.test(l))
      .join('\n');
  }
  kept = kept.trim() || clean.trim() || 'the build failed';
  const file = language === 'rust' ? 'solution\\.rs' : 'solution\\.go';
  const m = new RegExp(`${file}:(\\d+)`).exec(kept);
  return { message: kept, line: m ? Number(m[1]) : undefined };
}

async function readText(path: string): Promise<string | null> {
  return readFile(path, 'utf8').catch(() => null);
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    (s) => s.isFile(),
    () => false,
  );
}

/** Leaves the file (and its mtime) alone when the content is the same. */
async function writeIfChanged(path: string, content: string): Promise<void> {
  if ((await readText(path)) === content) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
