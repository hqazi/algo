/**
 * Read aloud's processes (T38, T39, T40): eSpeak NG and the engine started
 * on the first chunk, the text turned into phonemes by eSpeak (in its own
 * process, with the accent's language) and only phonemes sent to the
 * engine; replies matched by id, waiting chunks failed when a process
 * dies, both stopped when idle, and the engine started again on the new
 * device when the setting changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE_MS, TtsHost, type ChildLike } from './host';
import type { WorkerConfig } from './worker';

type Sent = Record<string, unknown> & { id: number };

class FakeChild implements ChildLike {
  sent: Sent[] = [];
  killed = false;
  private listeners: Record<string, ((x: never) => void)[]> = {};
  constructor(private readonly auto?: (m: Sent) => unknown) {}
  postMessage(m: unknown): void {
    this.sent.push(m as Sent);
    const reply = this.auto?.(m as Sent);
    if (reply) queueMicrotask(() => this.emit('message', reply));
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

let engines: FakeChild[];
let espeaks: FakeChild[];
let configs: WorkerConfig[];
let espeakPaths: string[];
let device: 'cpu' | 'gpu';

const host = () =>
  new TtsHost({
    ortPath: '/ort',
    modelDir: '/models/kokoro',
    espeakPath: '/models/kokoro/espeak/phonemizer.js',
    device: () => device,
    fork: (c) => {
      configs.push(c);
      const child = new FakeChild();
      engines.push(child);
      return child;
    },
    forkEspeak: (path) => {
      espeakPaths.push(path);
      // "Phonemes": the text in capitals, tagged with the language.
      const child = new FakeChild((m) => ({
        id: m.id,
        phonemes: [`${String(m['text']).toUpperCase()}/${String(m['language'])}`],
      }));
      espeaks.push(child);
      return child;
    },
  });

/** Lets eSpeak's replies arrive and the engine's request go out. */
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  engines = [];
  espeaks = [];
  configs = [];
  espeakPaths = [];
  device = 'cpu';
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('TtsHost', () => {
  it('phonemizes in the eSpeak process and sends only phonemes to the engine', async () => {
    const h = host();
    expect(engines).toHaveLength(0);
    const a = h.speak('one', 'af_heart', 1);
    const b = h.speak('two', 'bm_george', 1.5);
    await settle();
    expect(espeakPaths).toEqual(['/models/kokoro/espeak/phonemizer.js']);
    expect(espeaks[0]!.sent.map((m) => [m['text'], m['language']])).toEqual([
      ['one', 'en-us'],
      ['two', 'en'],
    ]);
    expect(engines).toHaveLength(1);
    expect(configs[0]).toEqual({ ortPath: '/ort', modelDir: '/models/kokoro', device: 'cpu' });
    const [c] = engines;
    const [m1, m2] = c!.sent;
    expect(m1).toMatchObject({ phonemes: 'ONE/en-us', voice: 'af_heart', speed: 1 });
    expect(m2).toMatchObject({ phonemes: 'TWO/en', voice: 'bm_george', speed: 1.5 });
    expect(m1).not.toHaveProperty('text');
    c!.emit('message', { engine: { device: 'cpu', speed: 4, gpu: null, fellBack: false } });
    c!.emit('message', { id: m2!.id, audio: Float32Array.of(2) });
    c!.emit('message', { id: m1!.id, error: 'bad input' });
    await expect(b).resolves.toEqual(Float32Array.of(2));
    await expect(a).rejects.toThrow('bad input');
    expect(h.engine).toEqual({ device: 'cpu', speed: 4, gpu: null, fellBack: false });
  });

  it('fails when eSpeak fails, without starting the engine', async () => {
    const h = new TtsHost({
      ortPath: '/ort',
      modelDir: '/m',
      espeakPath: '/m/espeak/phonemizer.js',
      device: () => 'cpu',
      fork: () => {
        throw new Error('not expected');
      },
      forkEspeak: () => new FakeChild((m) => ({ id: m.id, error: 'no such module' })),
    });
    const a = expect(h.speak('one', 'af_heart', 1)).rejects.toThrow('no such module');
    await settle();
    await a;
  });

  it('fails waiting chunks when the engine dies, and starts a new one next time', async () => {
    const h = host();
    const a = h.speak('one', 'af_heart', 1);
    await settle();
    engines[0]!.emit('exit', 1);
    await expect(a).rejects.toThrow('the voice process stopped');
    void h.speak('two', 'af_heart', 1).catch(() => undefined);
    await settle();
    expect(engines).toHaveLength(2);
  });

  it('stops both processes when idle', async () => {
    const h = host();
    const a = h.speak('one', 'af_heart', 1);
    await settle();
    const c = engines[0]!;
    c.emit('message', { id: c.sent[0]!.id, audio: Float32Array.of(1) });
    await a;
    vi.advanceTimersByTime(IDLE_MS - 1);
    expect(c.killed).toBe(false);
    expect(espeaks[0]!.killed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(c.killed).toBe(true);
    expect(espeaks[0]!.killed).toBe(true);
  });

  it('starts the engine again on the new device when the setting changes, between chunks', async () => {
    const h = host();
    const a = h.speak('one', 'af_heart', 1);
    await settle();
    device = 'gpu';
    // A chunk is still waiting: the process is kept.
    const b = h.speak('two', 'af_heart', 1);
    await settle();
    expect(engines).toHaveLength(1);
    const [c] = engines;
    c!.emit('message', { engine: { device: 'cpu', speed: 4, gpu: null, fellBack: false } });
    for (const m of c!.sent) c!.emit('message', { id: m.id, audio: Float32Array.of(1) });
    await Promise.all([a, b]);
    void h.speak('three', 'af_heart', 1);
    await settle();
    expect(c!.killed).toBe(true);
    expect(h.engine).toBeNull(); // not known on the GPU yet
    expect(engines).toHaveLength(2);
    expect(configs[1]?.device).toBe('gpu');
    expect(espeaks).toHaveLength(1); // eSpeak is not restarted
  });
});
