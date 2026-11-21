/**
 * Main's side of read aloud (T38, T39, T40, D-59–D-61). Each chunk goes
 * through two utility processes, both started on the first chunk and
 * stopped when idle (the model takes several hundred megabytes):
 *
 * 1. eSpeak NG (`espeak-worker.ts`) turns the text into phonemes. It is
 *    GPL-3.0, downloaded with the voice, and kept to its own process.
 * 2. The engine (`worker.ts`) turns phonemes into audio with Kokoro.
 *
 * Normalizing the text and splitting it around punctuation (`text.ts`)
 * happen here, between the two. When the device setting changes, the next
 * chunk starts the engine again on it, never during a chunk.
 *
 * `fork` and `forkEspeak` are injected so tests run without Electron.
 */
import type { TtsDevice, VoiceId } from '../../shared/tts';
import { ChildProcess, type ChildLike } from './child';
import type { EngineInfo } from './engine';
import type { EspeakRequest } from './espeak-worker';
import { toPhonemes } from './text';
import type { WorkerConfig, WorkerRequest } from './worker';

export type { ChildLike } from './child';

export const IDLE_MS = 5 * 60_000;
/** The first chunk also loads the model. */
export const SPEAK_MS = 180_000;
const ESPEAK_MS = 30_000;

export type ForkFn = (config: WorkerConfig) => ChildLike;

export class TtsHost {
  private readonly engineProcess: ChildProcess<WorkerConfig>;
  private readonly espeak: ChildProcess<string>;
  private info: EngineInfo | null = null;

  constructor(
    private readonly opts: {
      fork: ForkFn;
      /** Starts `espeak-worker.ts` with the downloaded module's path. */
      forkEspeak: (path: string) => ChildLike;
      ortPath: string;
      modelDir: string;
      /** The downloaded eSpeak module. */
      espeakPath: string;
      /** The device setting, read when the engine starts. */
      device: () => TtsDevice;
      log?: (m: string) => void;
    },
  ) {
    const log = opts.log;
    this.engineProcess = new ChildProcess<WorkerConfig>({
      name: 'the voice process',
      fork: opts.fork,
      idleMs: IDLE_MS,
      timeoutMs: SPEAK_MS,
      onOther: (m) => {
        if (typeof m['log'] === 'string') log?.(m['log']);
        else if (m['engine']) this.info = m['engine'] as EngineInfo;
      },
      ...(log ? { log } : {}),
    });
    this.espeak = new ChildProcess<string>({
      name: 'eSpeak NG',
      fork: opts.forkEspeak,
      idleMs: IDLE_MS,
      timeoutMs: ESPEAK_MS,
      ...(log ? { log } : {}),
    });
  }

  /** Where the engine runs, once it has started (kept after an idle stop). */
  get engine(): EngineInfo | null {
    return this.info;
  }

  async speak(text: string, voice: VoiceId, speed: number): Promise<Float32Array<ArrayBuffer>> {
    const phonemes = await toPhonemes(text, voice.startsWith('b') ? 'b' : 'a', (t, language) =>
      this.espeak
        .request<{ phonemes: string[] }>(this.opts.espeakPath, {
          text: t,
          language,
        } satisfies Omit<EspeakRequest, 'id'>)
        .then((r) => r.phonemes),
    );
    const device = this.opts.device();
    const running = this.engineProcess.running;
    // The setting changed: start again on the new device, between chunks.
    if (running && running.device !== device && !this.engineProcess.busy) {
      this.engineProcess.stop();
      this.info = null;
    }
    const config: WorkerConfig = {
      ortPath: this.opts.ortPath,
      modelDir: this.opts.modelDir,
      device,
    };
    const reply = await this.engineProcess.request<{ audio: Float32Array<ArrayBuffer> }>(config, {
      phonemes,
      voice,
      speed,
    } satisfies Omit<WorkerRequest, 'id'>);
    return reply.audio;
  }

  /** Stops both processes (quit, model removed). */
  stop(): void {
    this.engineProcess.stop();
    this.espeak.stop();
  }
}
