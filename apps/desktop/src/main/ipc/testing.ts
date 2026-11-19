/** Test helpers: a stand-in for `ipcMain` and for a page that sends to it. */
import { STREAM_EVENT } from '../../shared/ipc';
import type { IpcEventLike, IpcMainLike } from './router';

export const APP_URL = 'tutor-app://app/renderer/index.html';

type Listener = (event: IpcEventLike, ...args: unknown[]) => unknown;

export class FakeIpcMain implements IpcMainLike {
  readonly handlers = new Map<string, Listener>();
  readonly listeners = new Map<string, Listener>();
  handle(channel: string, listener: Listener): void {
    if (this.handlers.has(channel)) throw new Error(`second handler for ${channel}`);
    this.handlers.set(channel, listener);
  }
  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }
  on(channel: string, listener: Listener): void {
    this.listeners.set(channel, listener);
  }
  removeListener(channel: string): void {
    this.listeners.delete(channel);
  }
  invoke(event: IpcEventLike, channel: string, payload?: unknown): Promise<unknown> {
    const h = this.handlers.get(channel);
    if (!h) throw new Error(`no handler for ${channel}`);
    return Promise.resolve(h(event, payload));
  }
  send(event: IpcEventLike, channel: string, payload: unknown): void {
    this.listeners.get(channel)?.(event, payload);
  }
}

let nextSender = 1;
export function page(url = APP_URL, parent: unknown = null) {
  const sent: { channel: string; args: unknown[] }[] = [];
  let onDestroyed: (() => void) | undefined;
  let destroyed = false;
  const event: IpcEventLike = {
    sender: {
      id: nextSender++,
      send: (channel, ...args) => sent.push({ channel, args }),
      isDestroyed: () => destroyed,
      once: (_e, l) => (onDestroyed = l),
    },
    senderFrame: { url, parent },
  };
  return {
    event,
    sent,
    events: () =>
      sent
        .filter((s) => s.channel === STREAM_EVENT && !('result' in (s.args[0] as object)))
        .map((s) => s.args[0]),
    /** The result messages sent in order after a stream's events. */
    results: () =>
      sent
        .filter((s) => s.channel === STREAM_EVENT && 'result' in (s.args[0] as object))
        .map((s) => s.args[0]),
    destroy: () => {
      destroyed = true;
      onDestroyed?.();
    },
  };
}
