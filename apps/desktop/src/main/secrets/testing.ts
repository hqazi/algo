/** Test helpers: a stand-in for `safeStorage` that really encrypts (AES-GCM, fixed key). */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { SecretCrypto } from './secret-store';

/** A made-up key in the API's shape; never a real one. */
export const FAKE_KEY = 'sk-ant-api03-FAKE-test-key-0123456789abcdefghij-Zq9W';
const AES_KEY = Buffer.alloc(32, 7);

export function testCrypto(
  opts: { available?: boolean; backend?: string | null; reEncrypt?: boolean } = {},
): SecretCrypto & { encrypted: number } {
  const c = {
    encrypted: 0,
    available: () => Promise.resolve(opts.available ?? true),
    backend: () => (opts.backend === undefined ? 'gnome_libsecret' : opts.backend),
    encrypt: (plain: string) => {
      c.encrypted += 1;
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', AES_KEY, iv);
      const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return Promise.resolve(Buffer.concat([iv, cipher.getAuthTag(), body]));
    },
    decrypt: (data: Buffer) => {
      const d = createDecipheriv('aes-256-gcm', AES_KEY, data.subarray(0, 12));
      d.setAuthTag(data.subarray(12, 28));
      const result = Buffer.concat([d.update(data.subarray(28)), d.final()]).toString('utf8');
      return Promise.resolve({ result, shouldReEncrypt: opts.reEncrypt ?? false });
    },
  };
  return c;
}
