/**
 * Finding the user's Claude Code (T11): the configured path, else `claude`
 * on `PATH`, else the places its installers use (an app started from the
 * macOS Dock does not get the shell's `PATH`). The version comes from
 * `claude --version`; versions older than the one the flags were checked
 * against are refused.
 *
 * The CLI's own sign-in is not checked or used: the app runs it in bare mode
 * with its own Anthropic API key (DECISIONS D-25).
 */
import { execFile } from 'node:child_process';
import { access, constants, stat } from 'node:fs/promises';
import { extname, isAbsolute, posix, win32 } from 'node:path';

/** The version the flags and the stream were checked against (D-25). */
export const MIN_VERSION = '2.1.328';
export const VERSION_TIMEOUT_MS = 15_000;

export interface ClaudeCodeInfo {
  found: boolean;
  /** The executable, when found. */
  path: string | null;
  version: string | null;
  /** Usable: found, a known version, and a kind of file the app can start. */
  usable: boolean;
  /** Why not usable (never a secret). */
  reason: string | null;
}

export interface DetectOptions {
  /** `tutor.claudeCodePath`, or `null`. */
  configured: string | null;
  env: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  home: string;
  /** Runs `<path> --version`; resolves its stdout. Tests pass a fake. */
  version?: (path: string) => Promise<string>;
}

/** -1, 0 or 1, comparing dotted numeric versions. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function parseVersion(stdout: string): string | null {
  return /^\s*(\d+\.\d+\.\d+)/.exec(stdout)?.[1] ?? null;
}

async function isExecutable(path: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) return false;
    if (platform !== 'win32') await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The places to look, in order. */
export function candidates(opts: DetectOptions): string[] {
  const platform = opts.platform ?? process.platform;
  const win = platform === 'win32';
  const names = win
    ? (opts.env.PATHEXT ?? '.EXE;.CMD;.BAT')
        .split(';')
        .filter(Boolean)
        .map((ext) => `claude${ext.toLowerCase()}`)
    : ['claude'];
  const { join, isAbsolute: absolute } = win ? win32 : posix;
  const out: string[] = [];
  for (const dir of (opts.env.PATH ?? opts.env.Path ?? '').split(win ? ';' : ':'))
    if (dir && absolute(dir)) for (const n of names) out.push(join(dir, n));
  const home = opts.home;
  if (win) out.push(join(home, '.local', 'bin', 'claude.exe'));
  else
    out.push(
      join(home, '.local', 'bin', 'claude'),
      join(home, '.claude', 'local', 'claude'),
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
    );
  return [...new Set(out)];
}

const defaultVersion = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      path,
      ['--version'],
      {
        timeout: VERSION_TIMEOUT_MS,
        windowsHide: true,
        env: { PATH: process.env.PATH ?? '', DISABLE_AUTOUPDATER: '1' },
      },
      (err, stdout) => (err ? reject(err) : resolve(String(stdout))),
    );
  });

export async function detectClaudeCode(opts: DetectOptions): Promise<ClaudeCodeInfo> {
  const platform = opts.platform ?? process.platform;
  let path: string | null = null;
  if (opts.configured) {
    if (!isAbsolute(opts.configured))
      return notUsable(null, 'The Claude Code path in Settings must be an absolute path.', false);
    if (!(await isExecutable(opts.configured, platform)))
      return notUsable(null, `No executable at ${opts.configured}.`, false);
    path = opts.configured;
  } else {
    for (const c of candidates(opts)) {
      if (await isExecutable(c, platform)) {
        path = c;
        break;
      }
    }
  }
  if (!path) return notUsable(null, 'Claude Code was not found.', false);
  if (platform === 'win32' && extname(path).toLowerCase() !== '.exe')
    return notUsable(
      path,
      'Found a script launcher for Claude Code; the app can start only the native build (claude.exe). Run `claude install` to get it.',
      true,
    );
  let version: string | null;
  try {
    version = parseVersion(await (opts.version ?? defaultVersion)(path));
  } catch {
    return notUsable(path, 'Claude Code did not report its version.', true);
  }
  if (!version) return notUsable(path, 'Claude Code did not report its version.', true);
  if (compareVersions(version, MIN_VERSION) < 0)
    return {
      found: true,
      path,
      version,
      usable: false,
      reason: `Claude Code ${version} is too old; ${MIN_VERSION} or later is needed (run \`claude update\`).`,
    };
  return { found: true, path, version, usable: true, reason: null };
}

function notUsable(path: string | null, reason: string, found: boolean): ClaudeCodeInfo {
  return { found, path, version: null, usable: false, reason };
}
