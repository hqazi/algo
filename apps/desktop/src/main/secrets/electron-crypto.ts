/**
 * `SecretCrypto` over Electron `safeStorage`, asynchronous API only: in
 * Electron 45 the synchronous calls are deprecated, and on Linux without a
 * keyring `isEncryptionAvailable()` is false while the asynchronous
 * encryptor works with the `basic_text` store (checked, DECISIONS D-24).
 */
import { safeStorage } from 'electron';
import type { SecretCrypto } from './secret-store';

export const electronCrypto: SecretCrypto = {
  available: () => safeStorage.isAsyncEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptStringAsync(plain),
  decrypt: (data) => safeStorage.decryptStringAsync(data),
  backend: () => (process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : null),
};
