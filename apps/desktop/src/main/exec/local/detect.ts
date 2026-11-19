/**
 * Finds the user's `cargo` and `go` (SPEC §6.5): the path on `PATH` (plus the
 * usual install folders, since an app started from the desktop may not get
 * the shell's PATH), and the version each reports.
 */
import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runProcess } from './process';

export type Toolchain = 'cargo' | 'go';

export type ToolchainStatus =
  | { tool: Toolchain; found: true; path: string; version: string }
  | { tool: Toolchain; found: false; reason: string };

export const TOOLCHAIN_FOR = { rust: 'cargo', go: 'go' } as const satisfies Record<
  'rust' | 'go',
  Toolchain
>;

const VERSION_ARGS: Record<Toolchain, string[]> = {
  cargo: ['--version'],
  go: ['version'],
};

const INSTALL_HINT: Record<Toolchain, string> = {
  cargo: 'install Rust from https://rustup.rs',
  go: 'install Go from https://go.dev/dl',
};

/** Folders searched after `PATH`, where the official installers put the tools. */
export function extraToolDirs(platform: NodeJS.Platform, home: string): string[] {
  if (platform === 'win32') {
    return [join(home, '.cargo', 'bin'), 'C:\\Program Files\\Go\\bin'];
  }
  return [
    join(home, '.cargo', 'bin'),
    '/usr/local/go/bin',
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(home, 'go', 'bin'),
  ];
}

/** `PATH` for toolchain processes: the app's, then the extra folders. */
export function toolPath(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  extra: readonly string[] = extraToolDirs(platform, homedir()),
): string {
  const key = pathKey(env, platform);
  const sep = platform === 'win32' ? ';' : ':';
  const dirs = (env[key] ?? '').split(sep).filter(Boolean);
  for (const d of extra) if (!dirs.includes(d)) dirs.push(d);
  return dirs.join(sep);
}

/** The PATH variable's name (`Path` on Windows, usually). */
export function pathKey(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  if (platform !== 'win32') return 'PATH';
  return Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'Path';
}

/**
 * The first executable called `name` in `path`'s folders, or null. On
 * Windows only `name.exe` counts: the toolchains ship `.exe` files, and
 * `.cmd`/`.bat` would need a shell.
 */
export function findOnPath(
  name: string,
  path: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const windows = platform === 'win32';
  for (const dir of path.split(windows ? ';' : ':')) {
    if (!dir) continue;
    const file = join(dir, windows ? `${name}.exe` : name);
    try {
      if (!statSync(file).isFile()) continue;
      if (!windows) accessSync(file, constants.X_OK);
      return file;
    } catch {
      // not here
    }
  }
  return null;
}

/** `cargo 1.97.0 (…)` → `1.97.0`; `go version go1.24.7 linux/amd64` → `1.24.7`. */
export function parseVersion(tool: Toolchain, text: string): string | null {
  const m =
    tool === 'cargo'
      ? /cargo (\d+\.\d+\.\d+\S*)/.exec(text)
      : /go version go(\d+(?:\.\d+)*\S*)/.exec(text);
  return m ? m[1]! : null;
}

export async function detectToolchain(
  tool: Toolchain,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): Promise<ToolchainStatus> {
  const path = findOnPath(tool, env[pathKey(env, platform)] ?? '', platform);
  if (!path) {
    return { tool, found: false, reason: `${tool} was not found on PATH; ${INSTALL_HINT[tool]}` };
  }
  const r = await runProcess([path, ...VERSION_ARGS[tool]], {
    cwd: homedir(),
    env,
    timeoutMs: 20_000,
    platform,
  });
  const version = r.code === 0 ? parseVersion(tool, r.stdout) : null;
  if (!version) {
    const why = r.spawnError ?? (r.timedOut ? 'it did not answer' : r.stderr.trim().slice(0, 300));
    return { tool, found: false, reason: `${path} did not report its version: ${why}` };
  }
  return { tool, found: true, path, version };
}
