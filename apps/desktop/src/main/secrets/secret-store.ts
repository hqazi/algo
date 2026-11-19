/**
 * The Anthropic API key (SPEC §4.4): encrypted with Electron `safeStorage`
 * in `secrets.bin`, or `ANTHROPIC_API_KEY` from the environment, which wins
 * and is read-only. The key stays in this process: callers outside the
 * tutor get only `status()`, which says where the key is from and its last
 * four characters.
 *
 * Encryption goes through `SecretCrypto` (the Electron adapter is in
 * `electron-crypto.ts`) so tests can run without Electron. DECISIONS D-24
 * records why only the asynchronous `safeStorage` API is used.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const API_KEY_ENV = 'ANTHROPIC_API_KEY';

export interface SecretCrypto {
  /** Whether encryption works now (after the app is ready). */
  available(): Promise<boolean>;
  encrypt(plain: string): Promise<Buffer>;
  decrypt(data: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
  /** The Linux password store in use (`basic_text` means no keyring), or `null` elsewhere. */
  backend(): string | null;
}

export interface KeyStatus {
  /** Where the key in use comes from. */
  source: 'environment' | 'stored' | 'none';
  /** `…abcd` for the key in use, else `null`. */
  hint: string | null;
  /** A key is also stored, though the environment's is the one in use. */
  stored: boolean;
  storage: {
    available: boolean;
    /** Linux: the password store, e.g. `gnome_libsecret`, `basic_text`. */
    backend: string | null;
    /** No OS keyring: the key is encrypted with a fixed key Chromium ships. */
    weak: boolean;
  };
  /** Why the stored key could not be read, if it could not. */
  problem: string | null;
}

export class SecretError extends Error {
  constructor(
    readonly reason: 'invalid_key' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'SecretError';
  }
}

interface SecretsFile {
  anthropicApiKey?: string;
}

/** Last four characters, as Settings shows them. */
export function keyHint(key: string): string {
  return `…${key.slice(-4)}`;
}

/** Rough shape check only; the API is the judge (test connection). */
export function checkApiKey(raw: string): string {
  const key = raw.trim();
  if (key.length < 20 || key.length > 400)
    throw new SecretError('invalid_key', 'That does not look like an API key (wrong length).');
  if (!/^[\x21-\x7e]+$/.test(key))
    throw new SecretError('invalid_key', 'An API key has no spaces or special characters.');
  return key;
}

export class SecretStore {
  private stored: string | null = null;
  private problem: string | null = null;
  private storageAvailable = false;

  private constructor(
    private readonly path: string,
    private readonly crypto: SecretCrypto,
    private readonly env: Record<string, string | undefined>,
  ) {}

  /**
   * Reads `secrets.bin` once (after the app is ready). Never throws: a file
   * that cannot be decrypted is reported in `status().problem` and left as
   * it is until the user stores or removes a key.
   */
  static async open(
    path: string,
    crypto: SecretCrypto,
    env: Record<string, string | undefined> = process.env,
  ): Promise<SecretStore> {
    const store = new SecretStore(path, crypto, env);
    store.storageAvailable = await crypto.available().catch(() => false);
    if (!existsSync(path)) return store;
    try {
      const { result, shouldReEncrypt } = await crypto.decrypt(readFileSync(path));
      const parsed = JSON.parse(result) as SecretsFile;
      store.stored =
        typeof parsed.anthropicApiKey === 'string' && parsed.anthropicApiKey
          ? parsed.anthropicApiKey
          : null;
      if (shouldReEncrypt && store.stored) await store.write({ anthropicApiKey: store.stored });
    } catch {
      // Never include the error: it could quote the decrypted text.
      store.problem =
        'The stored API key could not be read (the keychain may have changed). Enter it again.';
    }
    return store;
  }

  private envKey(): string | null {
    return this.env[API_KEY_ENV]?.trim() || null;
  }

  /** The key to use: the environment's, else the stored one. Main process only. */
  apiKey(): string | null {
    return this.envKey() ?? this.stored;
  }

  status(): KeyStatus {
    const env = this.envKey();
    const inUse = env ?? this.stored;
    const backend = this.crypto.backend();
    return {
      source: env ? 'environment' : this.stored ? 'stored' : 'none',
      hint: inUse ? keyHint(inUse) : null,
      stored: this.stored !== null,
      storage: { available: this.storageAvailable, backend, weak: backend === 'basic_text' },
      problem: this.problem,
    };
  }

  async setApiKey(raw: string): Promise<KeyStatus> {
    const key = checkApiKey(raw);
    if (!this.storageAvailable)
      throw new SecretError(
        'unavailable',
        'This system offers no way to store the key safely. Set ANTHROPIC_API_KEY instead.',
      );
    await this.write({ anthropicApiKey: key });
    this.stored = key;
    this.problem = null;
    return this.status();
  }

  clearApiKey(): KeyStatus {
    rmSync(this.path, { force: true });
    this.stored = null;
    this.problem = null;
    return this.status();
  }

  private async write(file: SecretsFile): Promise<void> {
    const data = await this.crypto.encrypt(JSON.stringify(file));
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp-${process.pid}`;
    writeFileSync(tmp, data, { mode: 0o600 });
    renameSync(tmp, this.path);
  }
}
