/**
 * Container runtime detection (SPEC §6.5, T17): is Podman or Docker
 * installed, and is it running? Detection only runs the runtimes' own
 * read-only commands (`podman info`, `docker version`); the app never
 * installs or starts anything.
 *
 * Docker honours `DOCKER_HOST`, `DOCKER_CONTEXT` and the current context by
 * itself: the command runs with the app's environment, and the endpoint it
 * used is reported (`DOCKER_HOST`, else the context name).
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { findOnPath, pathKey, toolPath } from '../exec/local/detect';
import { runProcess } from '../exec/local/process';

export const RUNTIMES = ['podman', 'docker'] as const;
export type Runtime = (typeof RUNTIMES)[number];

export type RuntimeState = 'not-found' | 'installed-not-running' | 'running';

export interface RuntimeStatus {
  runtime: Runtime;
  state: RuntimeState;
  /** The program found (absent when not found). */
  path?: string;
  /** The server's version when running, else the client's when known. */
  version?: string;
  /** Docker: `DOCKER_HOST`, else the context used. Podman: `CONTAINER_HOST` / `CONTAINER_CONNECTION`. */
  endpoint?: string;
  /** Why it is not running (the runtime's own words, shortened). */
  reason?: string;
  /** For a stopped runtime: what the user can run or open to start it. */
  startHint?: string;
}

const DETECT_TIMEOUT_MS = 20_000;

/** Folders searched after `PATH`, where the official installers put the runtimes. */
export function runtimeDirs(platform: NodeJS.Platform, home: string): string[] {
  if (platform === 'win32') {
    return [
      'C:\\Program Files\\Docker\\Docker\\resources\\bin',
      'C:\\Program Files\\RedHat\\Podman',
    ];
  }
  if (platform === 'darwin') {
    return [
      '/usr/local/bin',
      '/opt/homebrew/bin',
      '/opt/podman/bin',
      join(home, '.docker', 'bin'),
      '/Applications/Docker.app/Contents/Resources/bin',
    ];
  }
  return ['/usr/bin', '/usr/local/bin', join(home, '.local', 'bin')];
}

/** The environment runtime commands run with: the app's, with the extra folders on PATH. */
export function runtimeEnv(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  extraDirs: readonly string[] = runtimeDirs(platform, homedir()),
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (/^(ANTHROPIC_|ELECTRON_)/i.test(k) || k === 'NODE_OPTIONS') continue;
    out[k] = v;
  }
  out[pathKey(env, platform)] = toolPath(env, platform, extraDirs);
  return out;
}

export function startHint(runtime: Runtime, platform: NodeJS.Platform): string {
  if (runtime === 'podman') {
    return platform === 'linux' ? 'systemctl --user start podman.socket' : 'podman machine start';
  }
  return platform === 'linux' ? 'sudo systemctl start docker' : 'open Docker Desktop';
}

export async function detectRuntime(
  runtime: Runtime,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): Promise<RuntimeStatus> {
  const path = findOnPath(runtime, env[pathKey(env, platform)] ?? '', platform);
  if (!path) return { runtime, state: 'not-found' };
  const args =
    runtime === 'podman' ? ['info', '--format', 'json'] : ['version', '--format', 'json'];
  const r = await runProcess([path, ...args], {
    cwd: homedir(),
    env,
    timeoutMs: DETECT_TIMEOUT_MS,
    platform,
  });
  const parsed = runtime === 'podman' ? parsePodmanInfo(r.stdout) : parseDockerVersion(r.stdout);
  const base: RuntimeStatus = { runtime, state: 'installed-not-running', path };
  if (runtime === 'docker') {
    const endpoint = env['DOCKER_HOST'] || parsed.context;
    if (endpoint) base.endpoint = endpoint;
  } else {
    const endpoint = env['CONTAINER_HOST'] || env['CONTAINER_CONNECTION'];
    if (endpoint) base.endpoint = endpoint;
  }
  if (r.code === 0 && parsed.serverVersion) {
    return { ...base, state: 'running', version: parsed.serverVersion };
  }
  if (parsed.clientVersion) base.version = parsed.clientVersion;
  const why =
    r.spawnError ??
    (r.timedOut
      ? `${runtime} did not answer in ${DETECT_TIMEOUT_MS / 1000} s`
      : firstLines(r.stderr));
  return {
    ...base,
    reason: why || `${runtime} is not running`,
    startHint: startHint(runtime, platform),
  };
}

export function detectRuntimes(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): Promise<RuntimeStatus[]> {
  return Promise.all(RUNTIMES.map((r) => detectRuntime(r, env, platform)));
}

interface Parsed {
  serverVersion?: string;
  clientVersion?: string;
  context?: string;
}

/** `docker version --format json`: `Server` is null when the daemon cannot be reached. */
export function parseDockerVersion(text: string): Parsed {
  const j = parseObject(text);
  if (!j) return {};
  const out: Parsed = {};
  const client = obj(j['Client']);
  const server = obj(j['Server']);
  if (typeof client?.['Version'] === 'string') out.clientVersion = client['Version'];
  if (typeof client?.['Context'] === 'string') out.context = client['Context'];
  if (typeof server?.['Version'] === 'string') out.serverVersion = server['Version'];
  return out;
}

/** `podman info --format json`: only printed when Podman can reach its service. */
export function parsePodmanInfo(text: string): Parsed {
  const j = parseObject(text);
  if (!j) return {};
  const out: Parsed = {};
  const version = obj(j['version']);
  if (typeof version?.['Version'] === 'string') out.serverVersion = version['Version'];
  return out;
}

function parseObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  try {
    return obj(JSON.parse(text.slice(start))) ?? null;
  } catch {
    return null;
  }
}

function obj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function firstLines(text: string): string {
  return text.trim().split('\n').slice(0, 3).join('\n').slice(0, 400);
}
