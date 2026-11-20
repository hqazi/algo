/**
 * Settings → Code execution over IPC (T18, SPEC §6.5): detection (with
 * Recheck), Pull / Update of the runner image, Test sandbox, and the
 * install guide links. The renderer names a topic, never a URL.
 */
import type { CodeExecution } from '../../exec/code-execution';
import type { IpcRouter } from '../router';

/** The user guide page on code execution (`docs/guide/code-execution.md`). */
export const GUIDE_URL = 'https://github.com/hqazi/algo/blob/main/docs/guide/code-execution.md#';
/** Its headings: "Optional: a container sandbox", "Installing Rust and Go". */
export const INSTALL_HELP = {
  container: `${GUIDE_URL}optional-a-container-sandbox`,
  toolchains: `${GUIDE_URL}installing-rust-and-go`,
} as const;

export interface CodeExecutionHandlerDeps {
  codeExecution: CodeExecution;
  openExternal: (url: string) => Promise<boolean>;
}

export function registerCodeExecutionHandlers(
  router: IpcRouter,
  deps: CodeExecutionHandlerDeps,
): void {
  const c = deps.codeExecution;
  router.handle('exec:runtimes', ({ recheck }) => c.view(recheck));
  router.handle('exec:test', ({ runtime }) => c.test(runtime));
  router.handle('exec:install-help', async ({ topic }) => ({
    opened: await deps.openExternal(INSTALL_HELP[topic]),
  }));
  router.handleStream('exec:pull', ({ runtime }, { signal, emit }) =>
    c.pull(runtime, (p) => emit({ line: p.line.slice(0, 500), layers: p.layers ?? null }), signal),
  );
}
