/**
 * The Kokoro engine (T38, T39, D-59, D-60): runs in the read-aloud utility
 * process (`worker.ts`), never in the main process, so synthesis cannot
 * stall the UI or IPC.
 *
 * Where it runs: the CPU, unless the learner turns on "Use the GPU" in
 * Settings → Library. The GPU goes through onnxruntime-node's WebGPU
 * provider (Vulkan on Linux, Metal on macOS, Direct3D 12 on Windows), with
 * DirectML tried first on Windows. If no GPU provider opens and runs, it
 * falls back to the CPU, which always works.
 *
 * Written against a small `Ort` interface so tests can stand in for the
 * runtime.
 */
import { readFile } from 'node:fs/promises';
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
  /**
   * Seconds of speech per second of work on the last chunk (above 1 is
   * faster than real time); 0 before the first.
   */
  speed: number;
  /** The GPU provider in use, e.g. "WebGPU"; null on the CPU. */
  gpu: string | null;
  /** The GPU was asked for but none could be used. */
  fellBack: boolean;
}

const STYLE = 256;

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

export interface EngineOptions {
  ort: Ort;
  /** The `ModelStore` directory (model and voices). */
  dir: string;
  phonemize: Phonemize;
  platform?: NodeJS.Platform;
  /** Where to run; `gpu` falls back to the CPU when no GPU provider works. */
  device: TtsDevice;
  log?: (message: string) => void;
}

export class Engine {
  private session: OrtSession | null = null;
  private info: EngineInfo | null = null;
  private loading: Promise<EngineInfo> | null = null;
  private readonly voices = new Map<VoiceId, Float32Array<ArrayBuffer>>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: EngineOptions) {}

  /** Loads the model on the chosen device; idempotent. */
  load(): Promise<EngineInfo> {
    this.loading ??= this.open().catch((e: unknown) => {
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
      const t = performance.now();
      const audio = await this.synth(this.session, text, voice, speed);
      const secs = Math.max((performance.now() - t) / 1000, 1e-3);
      if (this.info) this.info = { ...this.info, speed: audio.length / SAMPLE_RATE / secs };
      return audio;
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

  private async openSession(providers: unknown[]): Promise<OrtSession> {
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
   * Opens the first GPU provider that works. A session can open and still
   * fail on its first run (a driver without what the provider needs), so it
   * is run once; that also warms it up (shader compilation).
   */
  private async tryGpu(): Promise<{ session: OrtSession; label: string } | null> {
    for (const p of gpuProviders(this.opts.platform ?? process.platform)) {
      try {
        const session = await this.openSession(p.providers);
        try {
          await this.synth(session, 'Ready.', 'af_heart', 1);
        } catch (e) {
          await session.release();
          throw e;
        }
        return { session, label: p.label };
      } catch (e) {
        this.opts.log?.(`read aloud: ${p.label} unavailable: ${String(e).split('\n')[0]}`);
      }
    }
    return null;
  }

  private async open(): Promise<EngineInfo> {
    if (this.opts.device === 'gpu') {
      const gpu = await this.tryGpu();
      if (gpu) {
        this.session = gpu.session;
        this.info = { device: 'gpu', gpu: gpu.label, speed: 0, fellBack: false };
        return this.info;
      }
      this.opts.log?.('read aloud: no GPU could be used; running on the CPU');
    }
    this.session = await this.openSession(['cpu']);
    this.info = { device: 'cpu', gpu: null, speed: 0, fellBack: this.opts.device === 'gpu' };
    return this.info;
  }

  get current(): EngineInfo | null {
    return this.info;
  }
}
