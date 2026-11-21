/**
 * The Kokoro engine (T38, D-59): runs in the read-aloud utility process
 * (`worker.ts`), never in the main process, so synthesis cannot stall the UI
 * or IPC.
 *
 * Where it runs: the GPU only when it is clearly faster. On first use both
 * are timed on the same sentence (after a warm-up run each) and the GPU is
 * kept only if it is at least `GPU_MARGIN` times as fast; the choice is
 * remembered in `device.json` next to the model, so later starts load one
 * session. The GPU goes through onnxruntime-node's WebGPU provider (Vulkan
 * on Linux, Metal on macOS, Direct3D 12 on Windows), with DirectML tried
 * first on Windows. Any GPU failure falls back to the CPU, which always
 * works. `ALGO_TTS_DEVICE=cpu|gpu` forces one (checks and debugging).
 *
 * Written against a small `Ort` interface so tests can stand in for the
 * runtime.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SAMPLE_RATE, type TtsDevice, type VoiceId } from '../../shared/tts';
import { MODEL_FILE, voicePath } from './model';
import { tokenize, toPhonemes, type Phonemize } from './text';

export interface OrtTensor {
  readonly data: unknown;
}
export interface OrtSession {
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
  release(): Promise<void>;
}
export interface Ort {
  InferenceSession: {
    create(path: string, options: Record<string, unknown>): Promise<OrtSession>;
  };
  Tensor: new (
    type: 'int64' | 'float32',
    data: BigInt64Array | Float32Array,
    dims: number[],
  ) => OrtTensor;
}

export interface EngineInfo {
  device: TtsDevice;
  /** Seconds of speech per second of work (above 1 is faster than real time). */
  speed: number;
  /** The GPU provider in use, e.g. "WebGPU"; null on the CPU. */
  gpu: string | null;
}

/** A GPU is kept only when it is at least this many times as fast as the CPU. */
export const GPU_MARGIN = 1.2;
export const BENCH_TEXT =
  'Binary search halves the range on every step, so a million items take about twenty looks.';
const STYLE = 256;
const CHOICE_FILE = 'device.json';

interface Provider {
  label: string;
  providers: unknown[];
}

export function gpuProviders(platform: NodeJS.Platform): Provider[] {
  const webgpu = { label: 'WebGPU', providers: [{ name: 'webgpu' }] };
  return platform === 'win32'
    ? [{ label: 'DirectML', providers: [{ name: 'dml' }] }, webgpu]
    : [webgpu];
}

interface Choice {
  key: string;
  device: TtsDevice;
  gpu: string | null;
  speed: number;
}

export interface EngineOptions {
  ort: Ort;
  /** The `ModelStore` directory (model, voices, `device.json`). */
  dir: string;
  phonemize: Phonemize;
  platform?: NodeJS.Platform;
  /** Changes when the runtime or the model changes, so the choice is made again. */
  choiceKey: string;
  force?: TtsDevice | undefined;
  log?: (message: string) => void;
}

export class Engine {
  private session: OrtSession | null = null;
  private info: EngineInfo | null = null;
  private loading: Promise<EngineInfo> | null = null;
  private readonly voices = new Map<VoiceId, Float32Array<ArrayBuffer>>();
  private queue: Promise<unknown> = Promise.resolve();
  /** How long the benchmark sentence is, in seconds of speech (known after the first run). */
  private benchAudioSecs: number | null = null;

  constructor(private readonly opts: EngineOptions) {}

  /** Loads the model (choosing the device the first time); idempotent. */
  load(): Promise<EngineInfo> {
    this.loading ??= this.choose().catch((e: unknown) => {
      this.loading = null;
      throw e;
    });
    return this.loading;
  }

  /** Mono samples at `SAMPLE_RATE` for `text`, one request at a time. */
  speak(text: string, voice: VoiceId, speed: number): Promise<Float32Array<ArrayBuffer>> {
    const run = this.queue.then(async () => {
      await this.load();
      if (!this.session) throw new Error('the voice model is not loaded');
      return this.synth(this.session, text, voice, speed);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async dispose(): Promise<void> {
    const s = this.session;
    this.session = null;
    this.loading = null;
    await s?.release();
  }

  private get modelPath(): string {
    return join(this.opts.dir, ...MODEL_FILE.path.split('/'));
  }

  private async open(providers: unknown[]): Promise<OrtSession> {
    return this.opts.ort.InferenceSession.create(this.modelPath, {
      executionProviders: providers,
      graphOptimizationLevel: 'all',
      // Warnings about nodes placed on the CPU are expected with a GPU provider.
      logSeverityLevel: 3,
    });
  }

  private async voice(id: VoiceId): Promise<Float32Array<ArrayBuffer>> {
    let v = this.voices.get(id);
    if (!v) {
      const buf = await readFile(join(this.opts.dir, ...voicePath(id).split('/')));
      v = new Float32Array(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
      );
      this.voices.set(id, v);
    }
    return v;
  }

  private async synth(
    session: OrtSession,
    text: string,
    voice: VoiceId,
    speed: number,
  ): Promise<Float32Array<ArrayBuffer>> {
    const accent = voice.startsWith('b') ? 'b' : 'a';
    const ids = tokenize(await toPhonemes(text, accent, this.opts.phonemize));
    const pack = await this.voice(voice);
    // The voice pack holds one style vector per input length.
    const row = Math.min(Math.max(ids.length - 2, 0), pack.length / STYLE - 1);
    const { Tensor } = this.opts.ort;
    const out = await session.run({
      input_ids: new Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
      style: new Tensor('float32', pack.slice(row * STYLE, (row + 1) * STYLE), [1, STYLE]),
      speed: new Tensor('float32', Float32Array.of(speed), [1]),
    });
    const wave = out['waveform']?.data;
    if (!(wave instanceof Float32Array)) throw new Error('the model returned no audio');
    return wave as Float32Array<ArrayBuffer>;
  }

  /**
   * Seconds of speech per second of work, from a second run (the first warms
   * up). A warm-up slower than `budgetMs` is the answer by itself: a GPU that
   * slow (a software driver) is not timed again.
   */
  private async bench(session: OrtSession, budgetMs = Infinity): Promise<number> {
    const time = async (): Promise<number> => {
      const t = performance.now();
      const wave = await this.synth(session, BENCH_TEXT, 'af_heart', 1);
      this.benchAudioSecs = wave.length / SAMPLE_RATE;
      return wave.length / SAMPLE_RATE / Math.max((performance.now() - t) / 1000, 1e-3);
    };
    const warm = await time();
    const benchSecs = this.benchAudioSecs ?? 0;
    if (benchSecs > 0 && (benchSecs / warm) * 1000 > budgetMs) return warm;
    return time();
  }

  private async readChoice(): Promise<Choice | null> {
    try {
      const c = JSON.parse(await readFile(join(this.opts.dir, CHOICE_FILE), 'utf8')) as Choice;
      return c.key === this.opts.choiceKey && (c.device === 'cpu' || c.device === 'gpu') ? c : null;
    } catch {
      return null;
    }
  }

  /**
   * Opens the first GPU provider that works. A session can open and still
   * fail on its first run (a driver without what the provider needs), so
   * `check` runs it once; when choosing, the benchmark is that run.
   */
  private async tryGpu(check: boolean): Promise<{ session: OrtSession; label: string } | null> {
    for (const p of gpuProviders(this.opts.platform ?? process.platform)) {
      try {
        const session = await this.open(p.providers);
        if (check) {
          try {
            await this.synth(session, 'Ready.', 'af_heart', 1);
          } catch (e) {
            await session.release();
            throw e;
          }
        }
        return { session, label: p.label };
      } catch (e) {
        this.opts.log?.(`read aloud: ${p.label} unavailable: ${String(e).split('\n')[0]}`);
      }
    }
    return null;
  }

  private async choose(): Promise<EngineInfo> {
    const { force } = this.opts;
    const saved = force ? null : await this.readChoice();
    if (force === 'cpu' || saved?.device === 'cpu') {
      this.session = await this.open(['cpu']);
      return this.done({
        device: 'cpu',
        gpu: null,
        speed: saved?.speed ?? (await this.bench(this.session)),
      });
    }
    if (force === 'gpu' || saved?.device === 'gpu') {
      const gpu = await this.tryGpu(true);
      if (gpu) {
        this.session = gpu.session;
        return this.done({
          device: 'gpu',
          gpu: gpu.label,
          speed: saved?.speed ?? (await this.bench(gpu.session)),
        });
      }
      // The GPU went away (driver, another machine): choose again.
    }
    const cpu = await this.open(['cpu']);
    const cpuSpeed = await this.bench(cpu);
    const gpu = await this.tryGpu(false);
    let info: EngineInfo = { device: 'cpu', gpu: null, speed: cpuSpeed };
    // Shader compilation makes a GPU's first run slow; one far slower than
    // the CPU's timed run is not worth a second.
    const cpuMs = ((this.benchAudioSecs ?? 0) / cpuSpeed) * 1000;
    const gpuSpeed = gpu
      ? await this.bench(gpu.session, cpuMs * 4 + 5000).catch(async (e: unknown) => {
          this.opts.log?.(`read aloud: ${gpu.label} failed: ${String(e).split('\n')[0]}`);
          await gpu.session.release();
          return null;
        })
      : null;
    if (gpu && gpuSpeed !== null) {
      this.opts.log?.(
        `read aloud: ${gpu.label} ${gpuSpeed.toFixed(1)}x, CPU ${cpuSpeed.toFixed(1)}x real time`,
      );
      if (gpuSpeed >= cpuSpeed * GPU_MARGIN) {
        info = { device: 'gpu', gpu: gpu.label, speed: gpuSpeed };
        await cpu.release();
        this.session = gpu.session;
      } else {
        await gpu.session.release();
        this.session = cpu;
      }
    } else {
      this.session = cpu;
    }
    await writeFile(
      join(this.opts.dir, CHOICE_FILE),
      JSON.stringify({ key: this.opts.choiceKey, ...info } satisfies Choice),
    ).catch(() => undefined);
    return this.done(info);
  }

  private done(info: EngineInfo): EngineInfo {
    this.info = info;
    return info;
  }

  get current(): EngineInfo | null {
    return this.info;
  }
}
