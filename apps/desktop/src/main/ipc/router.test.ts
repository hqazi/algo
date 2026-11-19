import { describe, expect, it, vi } from 'vitest';
import { STREAM_CANCEL, STREAM_START, type IpcResult } from '../../shared/ipc';
import { registerHandlers } from './handlers';
import { IpcRouter } from './router';
import { APP_URL, FakeIpcMain, page } from './testing';

function setup() {
  const ipc = new FakeIpcMain();
  const onError = vi.fn();
  const router = new IpcRouter(ipc, {
    isTrustedUrl: (url) => url.startsWith('tutor-app://app/'),
    onError,
  });
  registerHandlers(router, {
    version: '1.2.3',
    versions: { electron: '45.3.4', chrome: '156', node: '24' },
  });
  return { ipc, router, onError };
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('invoke channels', () => {
  it('answers a valid call', async () => {
    const { ipc } = setup();
    expect(await ipc.invoke(page().event, 'app:version')).toEqual({
      ok: true,
      value: { app: '1.2.3', electron: '45.3.4', chrome: '156', node: '24' },
    });
  });

  it('rejects an invalid payload without calling the handler', async () => {
    const ipc = new FakeIpcMain();
    const router = new IpcRouter(ipc, { isTrustedUrl: () => true });
    const handler = vi.fn(() => ({ app: '', electron: '', chrome: '', node: '' }));
    router.handle('app:version', handler);
    const r = (await ipc.invoke(page().event, 'app:version', { evil: true })) as IpcResult<never>;
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe('invalid_request');
    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses senders that are not the app page', async () => {
    const { ipc } = setup();
    for (const p of [
      page('https://example.com/'),
      page('file:///etc/passwd'),
      page(APP_URL, { url: APP_URL }), // a subframe of the app page
    ]) {
      expect(await ipc.invoke(p.event, 'app:version')).toMatchObject({
        ok: false,
        error: { code: 'forbidden' },
      });
    }
    const noFrame = { ...page().event, senderFrame: null };
    expect(await ipc.invoke(noFrame, 'app:version')).toMatchObject({
      error: { code: 'forbidden' },
    });
  });

  it('reports a handler error and a reply that breaks the contract as internal', async () => {
    const ipc = new FakeIpcMain();
    const onError = vi.fn();
    const router = new IpcRouter(ipc, { isTrustedUrl: () => true, onError });
    router.handle('app:version', () => {
      throw new Error('boom');
    });
    expect(await ipc.invoke(page().event, 'app:version')).toEqual({
      ok: false,
      error: { code: 'internal', message: 'boom' },
    });
    ipc.removeHandler('app:version');
    router.handle('app:version', () => ({ app: 1 }) as never);
    expect(await ipc.invoke(page().event, 'app:version')).toMatchObject({
      error: { code: 'internal' },
    });
    expect(onError).toHaveBeenCalledTimes(2);
  });
});

describe('stream channels', () => {
  it('sends events in order, then the result', async () => {
    const { ipc, router } = setup();
    const p = page();
    const r = await ipc.invoke(p.event, STREAM_START, {
      id: 's1',
      channel: 'example:count',
      request: { to: 3, intervalMs: 0 },
    });
    expect(r).toEqual({ ok: true, value: { counted: 3 } });
    expect(p.events()).toEqual([
      { id: 's1', event: { n: 1 } },
      { id: 's1', event: { n: 2 } },
      { id: 's1', event: { n: 3 } },
    ]);
    expect(router.activeStreams).toBe(0);
  });

  it('cancels: answers "cancelled" at once and sends no more events', async () => {
    const { ipc, router } = setup();
    const p = page();
    const result = ipc.invoke(p.event, STREAM_START, {
      id: 's2',
      channel: 'example:count',
      request: { to: 1000, intervalMs: 5 },
    });
    await tick(30);
    expect(router.activeStreams).toBe(1);
    ipc.send(p.event, STREAM_CANCEL, 's2');
    expect(await result).toEqual({ ok: false, error: { code: 'cancelled', message: 'cancelled' } });
    const count = p.events().length;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(1000);
    await tick(30);
    expect(p.events().length).toBe(count);
    expect(router.activeStreams).toBe(0);
  });

  it('answers a cancel even when the handler ignores its signal', async () => {
    const ipc = new FakeIpcMain();
    const router = new IpcRouter(ipc, { isTrustedUrl: () => true });
    router.handleStream('example:count', () => new Promise(() => {}));
    const p = page();
    const result = ipc.invoke(p.event, STREAM_START, {
      id: 'x',
      channel: 'example:count',
      request: { to: 1, intervalMs: 0 },
    });
    await tick();
    ipc.send(p.event, STREAM_CANCEL, 'x');
    expect(await result).toMatchObject({ error: { code: 'cancelled' } });
  });

  it('lets a page cancel only its own streams', async () => {
    const { ipc } = setup();
    const a = page();
    const b = page();
    const result = ipc.invoke(a.event, STREAM_START, {
      id: 'same',
      channel: 'example:count',
      request: { to: 3, intervalMs: 5 },
    });
    await tick();
    ipc.send(b.event, STREAM_CANCEL, 'same');
    expect(await result).toEqual({ ok: true, value: { counted: 3 } });
  });

  it('cancels a page’s streams when the page goes away', async () => {
    const { ipc, router } = setup();
    const p = page();
    const result = ipc.invoke(p.event, STREAM_START, {
      id: 's3',
      channel: 'example:count',
      request: { to: 1000, intervalMs: 5 },
    });
    await tick(10);
    p.destroy();
    expect(await result).toMatchObject({ error: { code: 'cancelled' } });
    expect(router.activeStreams).toBe(0);
  });

  it('rejects invalid stream requests and unknown channels', async () => {
    const { ipc } = setup();
    const p = page();
    const start = (payload: unknown) => ipc.invoke(p.event, STREAM_START, payload);
    expect(
      await start({ id: 'a', channel: 'example:count', request: { to: 0, intervalMs: 0 } }),
    ).toMatchObject({ error: { code: 'invalid_request' } });
    expect(
      await start({ id: 'a', channel: 'example:count', request: { to: '3', intervalMs: 0 } }),
    ).toMatchObject({ error: { code: 'invalid_request' } });
    expect(await start({ channel: 'example:count', request: {} })).toMatchObject({
      error: { code: 'invalid_request' },
    });
    expect(await start({ id: 'a', channel: 'app:version', request: undefined })).toMatchObject({
      error: { code: 'unknown_channel' },
    });
    expect(await start({ id: 'a', channel: '__proto__', request: undefined })).toMatchObject({
      error: { code: 'unknown_channel' },
    });
    expect(p.events()).toEqual([]);
  });

  it('refuses streams from untrusted senders', async () => {
    const { ipc } = setup();
    const p = page('https://example.com/');
    expect(
      await ipc.invoke(p.event, STREAM_START, {
        id: 'a',
        channel: 'example:count',
        request: { to: 1, intervalMs: 0 },
      }),
    ).toMatchObject({ error: { code: 'forbidden' } });
  });

  it('drops events that break the contract', async () => {
    const ipc = new FakeIpcMain();
    const onError = vi.fn();
    const router = new IpcRouter(ipc, { isTrustedUrl: () => true, onError });
    router.handleStream('example:count', async (_req, { emit }) => {
      emit({ n: 'one' } as never);
      emit({ n: 2 });
      return { counted: 2 };
    });
    const p = page();
    await ipc.invoke(p.event, STREAM_START, {
      id: 'e',
      channel: 'example:count',
      request: { to: 2, intervalMs: 0 },
    });
    expect(p.events()).toEqual([{ id: 'e', event: { n: 2 } }]);
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe('dispose', () => {
  it('removes handlers and cancels running streams', async () => {
    const { ipc, router } = setup();
    const p = page();
    const result = ipc.invoke(p.event, STREAM_START, {
      id: 'd',
      channel: 'example:count',
      request: { to: 1000, intervalMs: 5 },
    });
    await tick();
    router.dispose();
    expect(await result).toMatchObject({ error: { code: 'cancelled' } });
    expect(ipc.handlers.size).toBe(0);
    expect(ipc.listeners.size).toBe(0);
  });
});
