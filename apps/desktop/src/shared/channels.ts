/**
 * Channel names only, without the schemas, for the preload: a sandboxed
 * preload cannot `require` packages, and it needs nothing but the names.
 * `ipc.ts` checks at compile time that these lists match the contract.
 */
export const INVOKE_CHANNELS = [
  'app:version',
  'catalog:topics',
  'profile:get',
  'profile:defaults',
  'status:get',
  'problems:list',
  'problems:get',
  'problems:next',
  'problems:start',
  'problems:reference',
  'workspace:get',
  'workspace:save',
  'runs:run',
  'runs:submit',
  'attempts:give-up',
  'attempts:list',
  'settings:theme',
  'settings:set-theme',
  'tutor:status',
  'chat:thread',
  'chat:reset',
  'explanations:list',
  'explanations:page',
  'explanations:viewed',
] as const;
export const STREAM_CHANNELS = ['example:count', 'workspace:watch', 'chat:send'] as const;

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
