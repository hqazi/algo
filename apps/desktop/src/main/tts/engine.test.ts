/**
 * The Kokoro engine (T38) with a stand-in runtime: the GPU kept only when
 * clearly faster, the choice remembered, failures falling back to the CPU,
 * and the model's inputs (token ids, the voice's style row, speed).
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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

/** One phoneme per character, `language` recorded. */
const languages: string[] = [];
const phonemize = async (text: string, language: string): Promise<string[]> => {
  languages.push(language);
  return [text.toLowerCase().replace(/[^a-z ]/g, '')];
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
  languages.length = 0;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const engine = (extra: Partial<ConstructorParameters<typeof Engine>[0]> = {}) =>
  new Engine({ ort, dir, phonemize, platform: 'linux', choiceKey: 'k1', ...extra });

describe('Engine', () => {
  it('keeps a GPU that is clearly faster, and remembers it', async () => {
    const log: string[] = [];
    const e = engine({ log: (m) => log.push(m) });
    const info = await e.load();
    expect(info).toMatchObject({ device: 'gpu', gpu: 'WebGPU' });
    expect(released).toEqual(['cpu']);
    expect(log.join('\n')).toMatch(/WebGPU .*x, CPU .*x real time/);
    const saved = JSON.parse(await readFile(join(dir, 'device.json'), 'utf8'));
    expect(saved).toMatchObject({ key: 'k1', device: 'gpu', gpu: 'WebGPU' });

    // Next start: only the GPU session opens, checked with one short run.
    opened = [];
    runs = [];
    const again = await engine().load();
    expect(again.device).toBe('gpu');
    expect(opened).toEqual(['webgpu']);
    expect(runs).toHaveLength(1);
  });

  it('stays on the CPU when the GPU is not faster enough', async () => {
    cost = { cpu: 1000, webgpu: 900 };
    const info = await engine().load();
    expect(info).toMatchObject({ device: 'cpu', gpu: null });
    expect(released).toEqual(['webgpu']);
  });

  it('times a very slow GPU once, not twice', async () => {
    cost = { cpu: 1000, webgpu: 60_000 };
    const info = await engine().load();
    expect(info.device).toBe('cpu');
    expect(runs.filter((r) => r.ep === 'webgpu')).toHaveLength(1);
    expect(runs.filter((r) => r.ep === 'cpu')).toHaveLength(2);
  });

  it('falls back to the CPU when no GPU provider opens', async () => {
    failOpen = new Set(['webgpu']);
    const log: string[] = [];
    const info = await engine({ log: (m) => log.push(m) }).load();
    expect(info.device).toBe('cpu');
    expect(log.join('\n')).toMatch(/WebGPU unavailable: Error: no webgpu adapter/);
  });

  it('chooses again when the remembered GPU has gone', async () => {
    await engine().load();
    failOpen = new Set(['webgpu']);
    const info = await engine().load();
    expect(info.device).toBe('cpu');
    const saved = JSON.parse(await readFile(join(dir, 'device.json'), 'utf8'));
    expect(saved.device).toBe('cpu');
  });

  it('chooses again when the runtime changed', async () => {
    await engine().load();
    cost = { cpu: 100, webgpu: 1000 };
    expect((await engine({ choiceKey: 'k2' }).load()).device).toBe('cpu');
  });

  it('can be forced to the CPU', async () => {
    const info = await engine({ force: 'cpu' }).load();
    expect(info.device).toBe('cpu');
    expect(opened).toEqual(['cpu']);
  });

  it('tries DirectML, then WebGPU, on Windows', async () => {
    expect(gpuProviders('win32').map((p) => p.label)).toEqual(['DirectML', 'WebGPU']);
    expect(gpuProviders('darwin').map((p) => p.label)).toEqual(['WebGPU']);
    failOpen = new Set(['dml']);
    const info = await engine({ platform: 'win32' }).load();
    expect(info).toMatchObject({ device: 'gpu', gpu: 'WebGPU' });
  });

  it("feeds token ids, the voice's style row for that length, and the speed", async () => {
    const e = engine({ force: 'cpu' });
    await e.load();
    runs = [];
    languages.length = 0;
    const audio = await e.speak('Hi you', 'bm_george', 1.5);
    const feeds = runs[0]?.feeds;
    const ids = Array.from(feeds?.['input_ids']?.data as BigInt64Array, Number);
    // $ h i ␠ y o u $
    expect(ids).toEqual([0, 50, 51, 16, 67, 57, 63, 0]);
    expect(feeds?.['input_ids']?.dims).toEqual([1, 8]);
    const style = feeds?.['style']?.data as Float32Array;
    expect(style).toHaveLength(256);
    expect(style[0]).toBe(6);
    expect(Array.from(feeds?.['speed']?.data as Float32Array)).toEqual([1.5]);
    expect(languages).toEqual(['en']);
    expect(audio).toHaveLength(8 * 2400);

    await e.speak('Hi', 'af_heart', 1);
    expect(languages.at(-1)).toBe('en-us');
  });

  it('speaks one chunk at a time, in order', async () => {
    const e = engine({ force: 'cpu' });
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
