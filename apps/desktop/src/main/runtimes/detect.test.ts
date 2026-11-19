/**
 * Runtime detection (SPEC §6.5) against fake `podman` / `docker` programs:
 * each state, versions, `DOCKER_HOST` and the context. POSIX shell fakes,
 * so not on Windows.
 */
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  detectRuntime,
  detectRuntimes,
  parseDockerVersion,
  parsePodmanInfo,
  runtimeEnv,
  startHint,
} from './detect';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'runtimes-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const DOCKER_RUNNING = JSON.stringify({
  Client: { Version: '29.1.0', Context: 'desktop-linux' },
  Server: { Version: '29.0.2' },
});
const DOCKER_STOPPED = JSON.stringify({
  Client: { Version: '29.1.0', Context: 'default' },
  Server: null,
});
const PODMAN_RUNNING = JSON.stringify({ host: { arch: 'amd64' }, version: { Version: '5.6.1' } });

/** A fake runtime in its own folder: logs argv and DOCKER_HOST, answers per `mode`. */
async function fake(
  name: 'docker' | 'podman',
  mode: 'running' | 'stopped' | 'garbage',
): Promise<{ bin: string; log: string }> {
  const bin = await mkdtemp(join(dir, `${name}-${mode}-`));
  const log = join(bin, 'log');
  const out =
    mode === 'garbage'
      ? 'not json'
      : name === 'docker'
        ? mode === 'running'
          ? DOCKER_RUNNING
          : DOCKER_STOPPED
        : mode === 'running'
          ? PODMAN_RUNNING
          : '';
  const err =
    mode === 'stopped'
      ? name === 'docker'
        ? 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?'
        : 'Error: unable to connect to Podman socket: dial unix: no such file'
      : '';
  const code = mode === 'running' ? 0 : 125;
  await writeFile(
    join(bin, name),
    [
      '#!/bin/sh',
      `echo "$* DOCKER_HOST=$DOCKER_HOST" >> '${log}'`,
      `printf '%s\\n' '${out}'`,
      err ? `echo '${err}' >&2` : '',
      `exit ${code}`,
      '',
    ].join('\n'),
  );
  await chmod(join(bin, name), 0o755);
  return { bin, log };
}

describe.skipIf(process.platform === 'win32')('detection with fake runtimes', () => {
  it('reports not-found when neither is on PATH', async () => {
    const empty = await mkdtemp(join(dir, 'empty-'));
    const all = await detectRuntimes({ PATH: empty }, 'linux');
    expect(all).toEqual([
      { runtime: 'podman', state: 'not-found' },
      { runtime: 'docker', state: 'not-found' },
    ]);
  });

  it('docker running: server version and current context', async () => {
    const f = await fake('docker', 'running');
    const s = await detectRuntime('docker', { PATH: f.bin }, 'linux');
    expect(s).toEqual({
      runtime: 'docker',
      state: 'running',
      path: join(f.bin, 'docker'),
      version: '29.0.2',
      endpoint: 'desktop-linux',
    });
    expect(await readFile(f.log, 'utf8')).toBe('version --format json DOCKER_HOST=\n');
  });

  it('docker honours DOCKER_HOST: passed through and reported', async () => {
    const f = await fake('docker', 'running');
    const s = await detectRuntime(
      'docker',
      { PATH: f.bin, DOCKER_HOST: 'tcp://10.0.0.5:2376' },
      'linux',
    );
    expect(s.endpoint).toBe('tcp://10.0.0.5:2376');
    expect(await readFile(f.log, 'utf8')).toContain('DOCKER_HOST=tcp://10.0.0.5:2376');
  });

  it('docker installed but not running: client version, reason, start hint', async () => {
    const f = await fake('docker', 'stopped');
    const s = await detectRuntime('docker', { PATH: f.bin }, 'darwin');
    expect(s).toMatchObject({
      runtime: 'docker',
      state: 'installed-not-running',
      version: '29.1.0',
      endpoint: 'default',
      startHint: 'open Docker Desktop',
    });
    expect(s.reason).toMatch(/Cannot connect to the Docker daemon/);
  });

  it('podman running and stopped', async () => {
    const up = await fake('podman', 'running');
    expect(await detectRuntime('podman', { PATH: up.bin }, 'linux')).toEqual({
      runtime: 'podman',
      state: 'running',
      path: join(up.bin, 'podman'),
      version: '5.6.1',
    });
    expect(await readFile(up.log, 'utf8')).toBe('info --format json DOCKER_HOST=\n');

    const down = await fake('podman', 'stopped');
    const s = await detectRuntime(
      'podman',
      { PATH: down.bin, CONTAINER_HOST: 'ssh://core@localhost:2222/run/podman.sock' },
      'darwin',
    );
    expect(s).toMatchObject({
      state: 'installed-not-running',
      startHint: 'podman machine start',
      endpoint: 'ssh://core@localhost:2222/run/podman.sock',
    });
    expect(s.reason).toMatch(/unable to connect/);
  });

  it('a runtime that prints nonsense is installed, not running', async () => {
    const f = await fake('docker', 'garbage');
    const s = await detectRuntime('docker', { PATH: f.bin }, 'linux');
    expect(s.state).toBe('installed-not-running');
  });
});

describe('parsing and environment', () => {
  it('parses docker and podman output', () => {
    expect(parseDockerVersion(DOCKER_RUNNING)).toEqual({
      clientVersion: '29.1.0',
      context: 'desktop-linux',
      serverVersion: '29.0.2',
    });
    expect(parseDockerVersion(DOCKER_STOPPED).serverVersion).toBeUndefined();
    expect(parseDockerVersion('')).toEqual({});
    expect(parsePodmanInfo(PODMAN_RUNNING)).toEqual({ serverVersion: '5.6.1' });
  });

  it('start hints per platform', () => {
    expect(startHint('podman', 'linux')).toBe('systemctl --user start podman.socket');
    expect(startHint('podman', 'win32')).toBe('podman machine start');
    expect(startHint('docker', 'linux')).toBe('sudo systemctl start docker');
  });

  it('runtime commands do not get the app secrets', () => {
    const env = runtimeEnv(
      { PATH: '/bin', ANTHROPIC_API_KEY: 'k', ELECTRON_RUN_AS_NODE: '1', DOCKER_HOST: 'x' },
      'linux',
      ['/opt/x'],
    );
    expect(env).toEqual({ PATH: '/bin:/opt/x', DOCKER_HOST: 'x' });
  });
});
