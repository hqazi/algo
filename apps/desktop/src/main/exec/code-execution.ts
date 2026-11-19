/**
 * What Settings → Code execution needs from main (SPEC §6.5, T18): the local
 * toolchains and the container runtimes as detected now, the runner image's
 * presence, pulling it, a hello-world "Test sandbox" per language, and the
 * last fallback notice. Detection only: nothing here installs or starts a
 * runtime.
 */
import type { CancelSignal, Language, RunJob, RunReport } from '@algorithm-tutor/core';
import type { ContainerExecutor, PullProgress } from './container';
import type { LocalExecutor } from './local';
import type { Runtime, RuntimeStatus } from '../runtimes';
import { RUNTIMES } from '../runtimes';

export type ContainerRuntime = Runtime;

export interface RuntimeView {
  runtime: Runtime;
  state: RuntimeStatus['state'];
  version: string | null;
  path: string | null;
  endpoint: string | null;
  reason: string | null;
  start_hint: string | null;
  /** The runner image: `present` is `null` when the runtime is not running (unknown). */
  image: { name: string; present: boolean | null };
}

export interface ToolchainView {
  language: 'rust' | 'go';
  tool: 'cargo' | 'go';
  found: boolean;
  version: string | null;
  path: string | null;
  reason: string | null;
}

export interface CodeExecutionView {
  selected: 'local' | Runtime;
  toolchains: ToolchainView[];
  runtimes: RuntimeView[];
  /** The latest fallback notice (the selected runtime stopped, so jobs ran locally). */
  notice: string | null;
}

export interface SandboxCheck {
  language: 'rust' | 'go';
  ok: boolean;
  message: string;
}

export interface CodeExecutionOptions {
  local: Pick<LocalExecutor, 'toolchains' | 'recheck'>;
  /** The executor practice uses for `runtime` (it falls back to local). */
  container: (
    runtime: Runtime,
  ) => Pick<ContainerExecutor, 'detect' | 'hasImage' | 'pull' | 'image'>;
  /** An executor for `runtime` without a fallback: Test sandbox must not run locally. */
  sandbox: (runtime: Runtime) => Pick<ContainerExecutor, 'run'>;
  selected: () => 'local' | Runtime;
}

/** The hello-world job "Test sandbox" runs in each language. */
export const HELLO_CODE: Record<'rust' | 'go', string> = {
  rust: 'pub fn greet(name: String) -> String {\n    format!("Hello, {}!", name)\n}\n',
  go: 'package main\n\nfunc greet(name string) string {\n\treturn "Hello, " + name + "!"\n}\n',
};

export function helloJob(language: 'rust' | 'go'): RunJob {
  return {
    language,
    code: HELLO_CODE[language],
    signature: { function: 'greet', params: [{ name: 'name', type: 'string' }], returns: 'string' },
    compare: { mode: 'exact' },
    tests: [
      {
        id: 'hello',
        visibility: 'visible',
        input: { name: 'sandbox' },
        expected: 'Hello, sandbox!',
      },
    ],
    timeLimitMs: 5000,
    memoryLimitMb: 256,
  };
}

const NAMES: Record<Language, string> = { python: 'Python', rust: 'Rust', go: 'Go' };

/** One line for a Test sandbox result. */
export function describeCheck(language: 'rust' | 'go', r: RunReport): SandboxCheck {
  const name = NAMES[language];
  if (r.error) return { language, ok: false, message: `${name}: ${r.error.message}` };
  const t = r.results[0];
  if (t?.status === 'pass') {
    return {
      language,
      ok: true,
      message: `${name}: hello world passed (${(r.durationMs / 1000).toFixed(1)} s, build included)`,
    };
  }
  const why = t ? (t.message ?? t.status) : 'no result';
  return { language, ok: false, message: `${name}: hello world did not pass (${why})` };
}

export class CodeExecution {
  private lastNotice: string | null = null;

  constructor(private readonly opts: CodeExecutionOptions) {}

  /** Called by the container executors when a job falls back to local. */
  notice(message: string): void {
    this.lastNotice = message;
  }

  /** Detects now. `recheck` also forgets the cached toolchain detection. */
  async view(recheck = false): Promise<CodeExecutionView> {
    if (recheck) this.opts.local.recheck();
    const [toolchains, runtimes] = await Promise.all([
      this.opts.local.toolchains(),
      Promise.all(RUNTIMES.map((r) => this.runtime(r))),
    ]);
    const selected = this.opts.selected();
    // A notice is about the runtime in use; once it runs again (or local is chosen) it is stale.
    const sel = runtimes.find((r) => r.runtime === selected);
    if (!sel || sel.state === 'running') this.lastNotice = null;
    return {
      selected,
      toolchains: toolchains.map((t) => ({
        language: t.tool === 'cargo' ? 'rust' : 'go',
        tool: t.tool,
        found: t.found,
        version: t.found ? t.version : null,
        path: t.found ? t.path : null,
        reason: t.found ? null : t.reason,
      })),
      runtimes,
      notice: this.lastNotice,
    };
  }

  /** Whether `runtime` can be chosen now: `null` if so, else why not. */
  async refusal(runtime: 'local' | Runtime): Promise<string | null> {
    if (runtime === 'local') return null;
    const rt = await this.opts.container(runtime).detect();
    if (rt.state === 'running') return null;
    return rt.state === 'not-found'
      ? `${runtime} was not found on this computer`
      : `${runtime} is installed but not running`;
  }

  pull(
    runtime: Runtime,
    onProgress: (p: PullProgress) => void,
    signal?: CancelSignal,
  ): Promise<{ ok: boolean; message: string }> {
    return this.opts.container(runtime).pull(onProgress, signal);
  }

  /** Hello world in Rust, then Go, in `runtime`'s container (never locally). */
  async test(runtime: Runtime): Promise<{ ok: boolean; checks: SandboxCheck[] }> {
    const ex = this.opts.sandbox(runtime);
    const checks: SandboxCheck[] = [];
    for (const language of ['rust', 'go'] as const) {
      checks.push(describeCheck(language, await ex.run(helloJob(language))));
    }
    return { ok: checks.every((c) => c.ok), checks };
  }

  private async runtime(runtime: Runtime): Promise<RuntimeView> {
    const c = this.opts.container(runtime);
    const rt = await c.detect();
    const running = rt.state === 'running' && !!rt.path;
    return {
      runtime,
      state: rt.state,
      version: rt.version ?? null,
      path: rt.path ?? null,
      endpoint: rt.endpoint ?? null,
      reason: rt.reason ?? null,
      start_hint: rt.startHint ?? null,
      image: { name: c.image, present: running ? await c.hasImage(rt.path) : null },
    };
  }
}
