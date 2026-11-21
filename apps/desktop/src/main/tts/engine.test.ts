/**
 * The Kokoro engine (T38, T39) with a stand-in runtime: the CPU unless the
 * GPU is asked for, GPU failures falling back to the CPU, the speed of the
 * last chunk, and the model's inputs (token ids, the voice's style row,
 * speed).
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Engine, gpuProviders, type Ort, type OrtSession, type OrtTensor } from './engine';

let dir: string;
let clock: number;

/** Milliseconds one run takes, by provider name. */
let cost: Record<string, number>;
let failOpen: Set<string>;
let opened: string[];
let released: string[];
let runs: { ep: string; feeds: Record<string, { data: unknown; dims: number[] }> }[];

class Tensor implements OrtTensor {
  constructor(
    readonly type: string,
    readonly data: BigInt64Array | Float32Array,
    readonly dims: number[],
  ) {}
}

function providerName(p: unknown): string {
  return typeof p === 'string' ? p : (p as { name: string }).name;
}

const ort: Ort = {
  InferenceSession: {
    async create(_path, options) {
      const ep = providerName((options['executionProviders'] as unknown[])[0]);
      if (failOpen.has(ep)) throw new Error(`no ${ep} adapter`);
      opened.push(ep);
      const s: OrtSession = {
        async run(feeds) {
          runs.push({ ep, feeds: feeds as never });
          clock += cost[ep] ?? 100;
          const ids = (feeds['input_ids'] as Tensor).data as BigInt64Array;
          // 0.1 s of audio per token.
          return { waveform: new Tensor('float32', new Float32Array(ids.length * 2400), []) };
        },
        async release() {
          released.push(ep);
        },
      };
      return s;
    },
  },
  Tensor: Tensor as unknown as Ort['Tensor'],
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tts-engine-'));
  await mkdir(join(dir, 'voices'));
  // Style row r of every voice is filled with r.
  const pack = new Float32Array(510 * 256);
  for (let r = 0; r < 510; r++) pack.fill(r, r * 256, (r + 1) * 256);
  for (const v of ['af_heart', 'bm_george']) {
    await writeFile(join(dir, 'voices', `${v}.bin`), Buffer.from(pack.buffer));
  }
  clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  cost = { cpu: 1000, webgpu: 100, dml: 100 };
  failOpen = new Set();
  opened = [];
  released = [];
  runs = [];
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const engine = (extra: Partial<ConstructorParameters<typeof Engine>[0]> = {}) =>
  new Engine({ ort, dir, platform: 'linux', device: 'cpu', ...extra });

describe('Engine', () => {
  it('runs on the CPU by default, without touching the GPU', async () => {
    const info = await engine().load();
    expect(info).toMatchObject({ device: 'cpu', gpu: null, fellBack: false });
    expect(opened).toEqual(['cpu']);
    expect(runs).toHaveLength(0);
  });

  it('uses the GPU when asked, checked and warmed up with one short run', async () => {
    const info = await engine({ device: 'gpu' }).load();
    expect(info).toMatchObject({ device: 'gpu', gpu: 'WebGPU', fellBack: false });
    expect(opened).toEqual(['webgpu']);
    expect(runs).toHaveLength(1);
  });

  it('falls back to the CPU when no GPU provider opens', async () => {
    failOpen = new Set(['webgpu']);
    const log: string[] = [];
    const info = await engine({ device: 'gpu', log: (m) => log.push(m) }).load();
    expect(info).toMatchObject({ device: 'cpu', fellBack: true });
    expect(log.join('\n')).toMatch(/WebGPU unavailable: Error: no webgpu adapter/);
  });

  it('falls back to the CPU when the GPU opens but cannot run', async () => {
    const create = ort.InferenceSession.create.bind(ort.InferenceSession);
    vi.spyOn(ort.InferenceSession, 'create').mockImplementation(async (path, options) => {
      const s = await create(path, options);
      const ep = providerName((options['executionProviders'] as unknown[])[0]);
      if (ep !== 'webgpu') return s;
      return { ...s, run: () => Promise.reject(new Error('device lost')) };
    });
    const info = await engine({ device: 'gpu' }).load();
    expect(info).toMatchObject({ device: 'cpu', fellBack: true });
    expect(released).toEqual(['webgpu']);
  });

  it('tries DirectML, then WebGPU, on Windows', async () => {
    expect(gpuProviders('win32').map((p) => p.label)).toEqual(['DirectML', 'WebGPU']);
    expect(gpuProviders('darwin').map((p) => p.label)).toEqual(['WebGPU']);
    failOpen = new Set(['dml']);
    const info = await engine({ device: 'gpu', platform: 'win32' }).load();
    expect(info).toMatchObject({ device: 'gpu', gpu: 'WebGPU' });
  });

  it('reports the speed of the last chunk', async () => {
    const e = engine();
    expect((await e.load()).speed).toBe(0);
    // 3 tokens + 2 pads = 0.5 s of audio in 1 s of work.
    await e.speak('abc', 'af_heart', 1);
    expect(e.current?.speed).toBeCloseTo(0.5);
  });

  it("feeds the phonemes' token ids, the voice's style row for that length, and the speed", async () => {
    const e = engine();
    await e.load();
    runs = [];
    const audio = await e.speak('hi you', 'bm_george', 1.5);
    const feeds = runs[0]?.feeds;
    const ids = Array.from(feeds?.['input_ids']?.data as BigInt64Array, Number);
    // $ h i ␠ y o u $
    expect(ids).toEqual([0, 50, 51, 16, 67, 57, 63, 0]);
    expect(feeds?.['input_ids']?.dims).toEqual([1, 8]);
    const style = feeds?.['style']?.data as Float32Array;
    expect(style).toHaveLength(256);
    expect(style[0]).toBe(6);
    expect(Array.from(feeds?.['speed']?.data as Float32Array)).toEqual([1.5]);
    expect(audio).toHaveLength(8 * 2400);
  });

  it('speaks one chunk at a time, in order', async () => {
    const e = engine();
    await e.load();
    runs = [];
    await Promise.all([e.speak('one', 'af_heart', 1), e.speak('two', 'af_heart', 1)]);
    expect(
      runs.map((r) => Array.from(r.feeds['input_ids']?.data as BigInt64Array, Number)),
    ).toEqual([
      [0, 57, 56, 47, 0],
      [0, 62, 65, 57, 0],
    ]);
  });
});
