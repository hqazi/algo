/**
 * Channel names only, without the schemas, for the preload: a sandboxed
 * preload cannot `require` packages, and it needs nothing but the names.
 * `ipc.ts` checks at compile time that these lists match the contract.
 */
export const INVOKE_CHANNELS = ['app:version'] as const;
export const STREAM_CHANNELS = ['example:count'] as const;

/** Internal Electron channels used to carry streams. */
export const STREAM_START = 'ipc:stream:start';
export const STREAM_EVENT = 'ipc:stream:event';
export const STREAM_CANCEL = 'ipc:stream:cancel';

export function isInvokeChannel(name: unknown): name is (typeof INVOKE_CHANNELS)[number] {
  return (INVOKE_CHANNELS as readonly unknown[]).includes(name);
}
export function isStreamChannel(name: unknown): name is (typeof STREAM_CHANNELS)[number] {
  return (STREAM_CHANNELS as readonly unknown[]).includes(name);
}
