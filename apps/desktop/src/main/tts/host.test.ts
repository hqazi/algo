/**
 * The read-aloud process host (T38): started on the first chunk, replies
 * matched by id, waiting chunks failed when the process dies, and the
 * process stopped when idle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE_MS, TtsHost, type ChildLike } from './host';
import type { WorkerConfig } from './worker';

class FakeChild implements ChildLike {
  sent: { id: number; text: string }[] = [];
  killed = false;
  private listeners: Record<string, ((x: never) => void)[]> = {};
  postMessage(m: unknown): void {
    this.sent.push(m as { id: number; text: string });
  }
  on(event: string, l: (x: never) => void): this {
    (this.listeners[event] ??= []).push(l);
    return this;
  }
  kill(): boolean {
    this.killed = true;
    return true;
  }
  emit(event: 'message' | 'exit', x: unknown): void {
    for (const l of this.listeners[event] ?? []) l(x as never);
  }
}

let children: FakeChild[];
let configs: WorkerConfig[];
const host = () =>
  new TtsHost({
    ortPath: '/ort',
    modelDir: '/models/kokoro',
    force: 'cpu',
    fork: (c) => {
      configs.push(c);
      const child = new FakeChild();
      children.push(child);
      return child;
    },
  });

beforeEach(() => {
  children = [];
  configs = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('TtsHost', () => {
  it('starts the process on the first chunk and matches replies by id', async () => {
    const h = host();
    expect(children).toHaveLength(0);
    const a = h.speak('one', 'af_heart', 1);
    const b = h.speak('two', 'af_heart', 1);
    expect(children).toHaveLength(1);
    expect(configs[0]).toEqual({ ortPath: '/ort', modelDir: '/models/kokoro', force: 'cpu' });
    const [c] = children;
    const [m1, m2] = c!.sent;
    c!.emit('message', { engine: { device: 'cpu', speed: 4, gpu: null } });
    c!.emit('message', { id: m2!.id, audio: Float32Array.of(2) });
    c!.emit('message', { id: m1!.id, error: 'bad text' });
    await expect(b).resolves.toEqual(Float32Array.of(2));
    await expect(a).rejects.toThrow('bad text');
    expect(h.engine).toEqual({ device: 'cpu', speed: 4, gpu: null });
  });

  it('fails waiting chunks when the process dies, and starts a new one next time', async () => {
    const h = host();
    const a = h.speak('one', 'af_heart', 1);
    children[0]!.emit('exit', 1);
    await expect(a).rejects.toThrow('the voice process stopped');
    void h.speak('two', 'af_heart', 1).catch(() => undefined);
    expect(children).toHaveLength(2);
  });

  it('stops the process when idle', async () => {
    const h = host();
    const a = h.speak('one', 'af_heart', 1);
    const c = children[0]!;
    c.emit('message', { id: c.sent[0]!.id, audio: Float32Array.of(1) });
    await a;
    vi.advanceTimersByTime(IDLE_MS - 1);
    expect(c.killed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(c.killed).toBe(true);
  });
});
