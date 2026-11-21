/**
 * Main's side of the read-aloud engine (T38, D-59): starts the utility
 * process (`worker.ts`) on the first chunk, sends it chunks and resolves each
 * with its audio. The process is stopped after `IDLE_MS` without a request
 * (the model takes several hundred megabytes) and started again when needed;
 * if it dies, waiting chunks fail and the next one starts a new process.
 *
 * `fork` is injected so tests run without Electron.
 */
import type { TtsDevice, VoiceId } from '../../shared/tts';
import type { EngineInfo } from './engine';
import type { WorkerConfig, WorkerReply, WorkerRequest } from './worker';

export const IDLE_MS = 5 * 60_000;
/** The first chunk also loads the model and times the devices. */
export const SPEAK_MS = 180_000;

export interface ChildLike {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  kill(): boolean;
}

export type ForkFn = (config: WorkerConfig) => ChildLike;

interface Waiting {
  resolve: (audio: Float32Array<ArrayBuffer>) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class TtsHost {
  private child: ChildLike | null = null;
  private nextId = 1;
  private readonly waiting = new Map<number, Waiting>();
  private idle: ReturnType<typeof setTimeout> | undefined;
  private info: EngineInfo | null = null;

  constructor(
    private readonly opts: {
      fork: ForkFn;
      ortPath: string;
      modelDir: string;
      force?: TtsDevice | undefined;
      log?: (m: string) => void;
    },
  ) {}

  /** Where the engine runs, once it has started (kept after an idle stop). */
  get engine(): EngineInfo | null {
    return this.info;
  }

  speak(text: string, voice: VoiceId, speed: number): Promise<Float32Array<ArrayBuffer>> {
    const child = this.start();
    const id = this.nextId++;
    clearTimeout(this.idle);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error('the voice took too long'));
        this.armIdle();
      }, SPEAK_MS);
      this.waiting.set(id, { resolve, reject, timer });
      child.postMessage({ id, text, voice, speed } satisfies WorkerRequest);
    });
  }

  /** Stops the process (quit, model removed). */
  stop(): void {
    clearTimeout(this.idle);
    const c = this.child;
    this.child = null;
    this.failAll('read aloud stopped');
    c?.kill();
  }

  private start(): ChildLike {
    if (this.child) return this.child;
    const child = this.opts.fork({
      ortPath: this.opts.ortPath,
      modelDir: this.opts.modelDir,
      force: this.opts.force,
    });
    this.child = child;
    child.on('message', (m) => this.onMessage(m as WorkerReply));
    child.on('exit', (code) => {
      if (this.child !== child) return;
      this.child = null;
      clearTimeout(this.idle);
      if (this.waiting.size > 0) this.opts.log?.(`read aloud: the voice process exited (${code})`);
      this.failAll('the voice process stopped');
    });
    return child;
  }

  private onMessage(m: WorkerReply): void {
    if ('log' in m) {
      this.opts.log?.(m.log);
      return;
    }
    if ('engine' in m) {
      this.info = m.engine;
      return;
    }
    const w = this.waiting.get(m.id);
    if (!w) return;
    this.waiting.delete(m.id);
    clearTimeout(w.timer);
    if ('audio' in m) w.resolve(m.audio);
    else w.reject(new Error(m.error));
    this.armIdle();
  }

  private armIdle(): void {
    clearTimeout(this.idle);
    if (this.waiting.size > 0 || !this.child) return;
    this.idle = setTimeout(() => this.stop(), IDLE_MS);
    this.idle.unref?.();
  }

  private failAll(message: string): void {
    for (const [id, w] of this.waiting) {
      clearTimeout(w.timer);
      w.reject(new Error(message));
      this.waiting.delete(id);
    }
  }
}
