/**
 * Assembles the practice flow for the app (T08): the file catalog, the
 * workspace, the Pyodide executor behind the execution host, and `Practice`.
 */
import { join } from 'node:path';
import { isoNow, type Executor, type ExecutorId } from '@algorithm-tutor/core';
import { ExecHost, type ExecHostOptions } from '../exec/host-window';
import { ContainerExecutor, runnerImage } from '../exec/container';
import { LocalExecutor } from '../exec/local';
import { PyodideExecutor } from '../exec/pyodide-executor';
import type { AppStorage } from '../storage';
import { FileCatalog } from './catalog';
import { FileWorkspace } from './file-workspace';
import { Practice } from './service';

export { FileCatalog } from './catalog';
export { FileWorkspace } from './file-workspace';
export { Practice, PracticeRefusal } from './service';

export interface AppPractice {
  practice: Practice;
  catalog: FileCatalog;
  host: ExecHost;
  /** The executors by id; model-written code asks for `pyodide` only (T12, SPEC §6.3). */
  executors: (id: ExecutorId) => Executor | null;
  dispose(): void;
}

/**
 * The app's `content/` folder: next to the app's resources when packaged
 * (T13 ships it there), else the repository's.
 */
export function contentDir(packaged: boolean, resourcesPath: string, mainDir: string): string {
  return packaged ? join(resourcesPath, 'content') : join(mainDir, '../../../../content');
}

export async function openPractice(
  app: AppStorage,
  opts: { content: string; host: ExecHostOptions; appVersion?: string },
): Promise<AppPractice> {
  const catalog = await FileCatalog.open(
    { content: opts.content, dataDir: app.paths.root },
    isoNow,
    app.storage,
  );
  for (const issue of catalog.issues) console.warn(`problem ${issue.where}: ${issue.message}`);
  const host = new ExecHost(opts.host);
  const pyodide: Executor = new PyodideExecutor(host);
  // Rust and Go with the user's own toolchains (T16), or in a container
  // runtime when Settings chooses one (T17), falling back to local if it stops.
  const local = new LocalExecutor({
    buildDir: join(app.paths.cache, 'build'),
    runnersDir: join(opts.content, 'runners'),
  });
  const containers = new Map<'podman' | 'docker', ContainerExecutor>();
  const container = (): ContainerExecutor | null => {
    const runtime = app.settings.get().execution.runtime;
    if (runtime === 'local') return null;
    let c = containers.get(runtime);
    if (!c) {
      c = new ContainerExecutor({
        runtime,
        image: runnerImage(opts.appVersion ?? '0.0.0'),
        jobsDir: join(app.paths.cache, 'container-jobs'),
        runnersDir: join(opts.content, 'runners'),
        fallback: local,
        onNotice: (message) => console.warn(`code execution: ${message}`),
      });
      containers.set(runtime, c);
    }
    return c;
  };
  const compiled = (): Executor => container() ?? local;
  const practice = new Practice({
    storage: app.storage,
    catalog,
    workspace: new FileWorkspace(app.paths.workspace),
    executorFor: (language) => (language === 'python' ? pyodide : compiled()),
    languageStatus: async (language) => {
      if (language === 'python') return { available: true };
      const c = container();
      if (!c) return local.statusFor(language);
      // A stopped runtime falls back to local, so local decides then.
      const rt = await c.detect();
      return rt.state === 'running' ? c.statusFor(language) : local.statusFor(language);
    },
    timeScale: () => app.settings.get().execution.timeScale,
    now: isoNow,
  });
  return {
    practice,
    catalog,
    host,
    executors: (id) =>
      id === 'pyodide' ? pyodide : id === 'local' ? local : id === 'container' ? container() : null,
    dispose: () => host.dispose(),
  };
}
