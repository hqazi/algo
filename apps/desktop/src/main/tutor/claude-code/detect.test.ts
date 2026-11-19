import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { candidates, compareVersions, detectClaudeCode, MIN_VERSION, parseVersion } from './detect';

let dir: string;
let bin: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cc-detect-'));
  bin = join(dir, 'bin');
  await mkdir(bin);
});

async function exe(path: string): Promise<string> {
  await writeFile(path, '#!/bin/sh\necho "2.1.400 (Claude Code)"\n');
  await chmod(path, 0o755);
  return path;
}

const posix = process.platform !== 'win32';

describe('detection', () => {
  it('parses and compares versions', () => {
    expect(parseVersion('2.1.328 (Claude Code)\n')).toBe('2.1.328');
    expect(parseVersion('Claude Code')).toBeNull();
    expect(compareVersions('2.1.328', MIN_VERSION)).toBe(0);
    expect(compareVersions('2.1.40', '2.1.328')).toBe(-1);
    expect(compareVersions('2.10.0', '2.9.9')).toBe(1);
  });

  it('looks on PATH, then in the installers’ places', () => {
    const c = candidates({
      configured: null,
      env: { PATH: `/a/bin:relative:/b/bin` },
      home: '/home/u',
      platform: 'linux',
    });
    expect(c.slice(0, 2)).toEqual(['/a/bin/claude', '/b/bin/claude']);
    expect(c).toContain('/home/u/.local/bin/claude');
    expect(c).toContain('/opt/homebrew/bin/claude');
    expect(c.some((p) => p.includes('relative'))).toBe(false);
    const w = candidates({
      configured: null,
      env: { Path: 'C:\\x', PATHEXT: '.EXE;.CMD' },
      home: 'C:\\Users\\u',
      platform: 'win32',
    });
    expect(w[0]).toMatch(/claude\.exe$/);
    expect(w[1]).toMatch(/claude\.cmd$/);
  });

  it.skipIf(!posix)('finds claude on PATH and reads its version', async () => {
    const path = await exe(join(bin, 'claude'));
    const info = await detectClaudeCode({ configured: null, env: { PATH: bin }, home: dir });
    expect(info).toEqual({ found: true, path, version: '2.1.400', usable: true, reason: null });
  });

  it.skipIf(!posix)('a configured path wins and must be absolute and executable', async () => {
    const path = await exe(join(dir, 'my-claude'));
    await exe(join(bin, 'claude'));
    const env = { PATH: bin };
    expect((await detectClaudeCode({ configured: path, env, home: dir })).path).toBe(path);
    expect((await detectClaudeCode({ configured: 'claude', env, home: dir })).reason).toMatch(
      /absolute/,
    );
    const missing = await detectClaudeCode({ configured: join(dir, 'nope'), env, home: dir });
    expect(missing).toMatchObject({ found: false, usable: false });
  });

  it.skipIf(!posix)('refuses old versions and silent executables', async () => {
    const path = await exe(join(bin, 'claude'));
    const old = await detectClaudeCode({
      configured: null,
      env: { PATH: bin },
      home: dir,
      version: async () => '2.0.1 (Claude Code)',
    });
    expect(old).toMatchObject({ found: true, path, usable: false, version: '2.0.1' });
    expect(old.reason).toMatch(/too old/);
    const broken = await detectClaudeCode({
      configured: null,
      env: { PATH: bin },
      home: dir,
      version: () => Promise.reject(new Error('x')),
    });
    expect(broken).toMatchObject({ found: true, usable: false });
  });

  it('not found', async () => {
    const info = await detectClaudeCode({
      configured: null,
      env: { PATH: bin },
      home: dir,
      platform: 'linux',
    });
    // The fixed install places may exist on a developer's machine; only check
    // the PATH part when they do not.
    if (!info.found) expect(info.reason).toBe('Claude Code was not found.');
  });

  it('on Windows only the native build is started', async () => {
    const cmd = join(bin, 'claude.cmd');
    await writeFile(cmd, '@echo off');
    const info = await detectClaudeCode({
      configured: cmd,
      env: {},
      home: dir,
      platform: 'win32',
    });
    expect(info).toMatchObject({ found: true, usable: false });
    expect(info.reason).toMatch(/claude\.exe/);
  });
});
