/**
 * The only bridge between the UI renderer and the main process (SPEC §3.1,
 * §10). Exposes `window.tutor` (`TutorBridge` in `shared/ipc.ts`) and nothing
 * else: no `ipcRenderer`, no Node. Channels outside the contract are refused
 * here; requests are validated again in main, which is the real check.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  isInvokeChannel,
  isStreamChannel,
  STREAM_CANCEL,
  STREAM_EVENT,
  STREAM_START,
} from '../shared/channels';
import type { IpcResult, StreamEventMessage, StreamStart, TutorBridge } from '../shared/ipc';

const listeners = new Map<string, (event: unknown) => void>();
/** Resolvers for running streams' results, which arrive after their events. */
const enders = new Map<string, (result: IpcResult<never>) => void>();
/** Replies main gives before a stream starts: no result message follows them. */
const EARLY = new Set(['forbidden', 'invalid_request', 'unknown_channel']);

ipcRenderer.on(STREAM_EVENT, (_e: IpcRendererEvent, message: StreamEventMessage) => {
  if ('result' in message) {
    listeners.delete(message.id);
    enders.get(message.id)?.(message.result as IpcResult<never>);
    enders.delete(message.id);
  } else listeners.get(message.id)?.(message.event);
});

const unknownChannel = (channel: unknown): IpcResult<never> => ({
  ok: false,
  error: { code: 'unknown_channel', message: `no channel "${String(channel)}"` },
});

const bridge: TutorBridge = {
  invoke(channel, request) {
    if (!isInvokeChannel(channel)) return Promise.resolve(unknownChannel(channel));
    return ipcRenderer.invoke(channel, request);
  },

  stream(channel, request, onEvent) {
    if (!isStreamChannel(channel)) {
      return { result: Promise.resolve(unknownChannel(channel)), cancel: () => {} };
    }
    const id = crypto.randomUUID();
    listeners.set(id, onEvent as (event: unknown) => void);
    const start: StreamStart = { id, channel, request };
    const ended = new Promise<IpcResult<never>>((resolve) => enders.set(id, resolve));
    const result = (ipcRenderer.invoke(STREAM_START, start) as Promise<IpcResult<never>>).then(
      (reply) => {
        if (reply.ok || !EARLY.has(reply.error.code)) return ended;
        listeners.delete(id);
        enders.delete(id);
        return reply;
      },
      (err: unknown) => {
        listeners.delete(id);
        enders.delete(id);
        throw err;
      },
    );
    return {
      result,
      cancel: () => {
        // Events already on their way are dropped from here on.
        listeners.delete(id);
        ipcRenderer.send(STREAM_CANCEL, id);
      },
    };
  },
};

contextBridge.exposeInMainWorld('tutor', bridge);
