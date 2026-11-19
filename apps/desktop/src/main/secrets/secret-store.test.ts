/**
 * The API key store (SPEC §4.4) over a stand-in for `safeStorage` that
 * really encrypts (AES-GCM with a fixed test key), so the file on disk can
 * be checked for the plain key.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SecretError, SecretStore } from './secret-store';
import { FAKE_KEY, testCrypto } from './testing';

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'algotutor-secrets-'));
  path = join(dir, 'secrets.bin');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('SecretStore', () => {
  it('starts with no key', async () => {
    const s = await SecretStore.open(path, testCrypto(), {});
    expect(s.apiKey()).toBeNull();
    expect(s.status()).toEqual({
      source: 'none',
      hint: null,
      stored: false,
      storage: { available: true, backend: 'gnome_libsecret', weak: false },
      problem: null,
    });
  });

  it('stores the key encrypted, shows only the last four, and reads it back after a restart', async () => {
    const s = await SecretStore.open(path, testCrypto(), {});
    const status = await s.setApiKey(`  ${FAKE_KEY}\n`);
    expect(status).toMatchObject({ source: 'stored', hint: '…Zq9W', stored: true });
    expect(JSON.stringify(status)).not.toContain(FAKE_KEY.slice(0, -4));
    expect(s.apiKey()).toBe(FAKE_KEY);
    const bytes = readFileSync(path);
    expect(bytes.toString('latin1')).not.toContain('FAKE-test-key');
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o077).toBe(0);

    const again = await SecretStore.open(path, testCrypto(), {});
    expect(again.apiKey()).toBe(FAKE_KEY);
    expect(again.status().source).toBe('stored');
  });

  it('prefers ANTHROPIC_API_KEY from the environment, read-only', async () => {
    const s = await SecretStore.open(path, testCrypto(), {
      ANTHROPIC_API_KEY: ' sk-env-key-0000000000000000abcd ',
    });
    expect(s.apiKey()).toBe('sk-env-key-0000000000000000abcd');
    expect(s.status()).toMatchObject({ source: 'environment', hint: '…abcd', stored: false });
    await s.setApiKey(FAKE_KEY);
    expect(s.apiKey()).toBe('sk-env-key-0000000000000000abcd');
    expect(s.status()).toMatchObject({ source: 'environment', stored: true });
  });

  it('removes the key', async () => {
    const s = await SecretStore.open(path, testCrypto(), {});
    await s.setApiKey(FAKE_KEY);
    expect(s.clearApiKey().source).toBe('none');
    expect(existsSync(path)).toBe(false);
    expect(s.apiKey()).toBeNull();
  });

  it('refuses keys of the wrong shape', async () => {
    const s = await SecretStore.open(path, testCrypto(), {});
    await expect(s.setApiKey('short')).rejects.toMatchObject({ reason: 'invalid_key' });
    await expect(s.setApiKey('sk-ant has spaces in it 0000000000')).rejects.toBeInstanceOf(
      SecretError,
    );
    expect(existsSync(path)).toBe(false);
  });

  it('flags the weak Linux store and refuses to store when encryption is unavailable', async () => {
    const weak = await SecretStore.open(path, testCrypto({ backend: 'basic_text' }), {});
    expect(weak.status().storage).toEqual({ available: true, backend: 'basic_text', weak: true });
    await weak.setApiKey(FAKE_KEY); // still works (SPEC §4.4)

    const none = await SecretStore.open(
      join(dir, 'other.bin'),
      testCrypto({ available: false }),
      {},
    );
    await expect(none.setApiKey(FAKE_KEY)).rejects.toMatchObject({ reason: 'unavailable' });
  });

  it('reports a file it cannot decrypt without quoting it, and recovers on a new key', async () => {
    writeFileSync(path, Buffer.from('not encrypted at all'));
    const s = await SecretStore.open(path, testCrypto(), {});
    expect(s.apiKey()).toBeNull();
    expect(s.status().problem).toMatch(/could not be read/);
    await s.setApiKey(FAKE_KEY);
    expect(s.status().problem).toBeNull();
  });

  it('re-encrypts when safeStorage asks to', async () => {
    await (await SecretStore.open(path, testCrypto(), {})).setApiKey(FAKE_KEY);
    const crypto = testCrypto({ reEncrypt: true });
    const s = await SecretStore.open(path, crypto, {});
    expect(crypto.encrypted).toBe(1);
    expect(s.apiKey()).toBe(FAKE_KEY);
  });
});
