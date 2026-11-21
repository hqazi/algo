/**
 * One utility process that answers requests by id (T38, T40): started on
 * the first request, stopped after `idleMs` without one, a request failed
 * after `timeoutMs`, and every waiting request failed if the process
 * exits (the next one starts a new process). Used for the voice engine
 * (`worker.ts`) and for eSpeak NG (`espeak-worker.ts`).
 *
 * `fork` is injected so tests run without Electron.
 */
export interface ChildLike {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  kill(): boolean;
}

interface Waiting {
  resolve: (reply: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ChildProcess<Config> {
  private child: ChildLike | null = null;
  private config: Config | null = null;
  private nextId = 1;
  private readonly waiting = new Map<number, Waiting>();
  private idle: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly opts: {
      name: string;
      fork: (config: Config) => ChildLike;
      idleMs: number;
      timeoutMs: number;
      /** Messages without an id (status, logs). */
      onOther?: (message: Record<string, unknown>) => void;
      log?: (m: string) => void;
    },
  ) {}

  /** The config the running process was started with. */
  get running(): Config | null {
    return this.child ? this.config : null;
  }

  get busy(): boolean {
    return this.waiting.size > 0;
  }

  request<T>(config: Config, message: Record<string, unknown>): Promise<T> {
    const child = this.start(config);
    const id = this.nextId++;
    clearTimeout(this.idle);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`${this.opts.name} took too long`));
        this.armIdle();
      }, this.opts.timeoutMs);
      this.waiting.set(id, { resolve: resolve as (r: unknown) => void, reject, timer });
      child.postMessage({ ...message, id });
    });
  }

  stop(): void {
    clearTimeout(this.idle);
    const c = this.child;
    this.child = null;
    this.failAll(`${this.opts.name} stopped`);
    c?.kill();
  }

  private start(config: Config): ChildLike {
    if (this.child) return this.child;
    const child = this.opts.fork(config);
    this.child = child;
    this.config = config;
    child.on('message', (m) => this.onMessage(m as Record<string, unknown>));
    child.on('exit', (code) => {
      if (this.child !== child) return;
      this.child = null;
      clearTimeout(this.idle);
      if (this.waiting.size > 0) this.opts.log?.(`read aloud: ${this.opts.name} exited (${code})`);
      this.failAll(`${this.opts.name} stopped`);
    });
    return child;
  }

  private onMessage(m: Record<string, unknown>): void {
    const id = m['id'];
    if (typeof id !== 'number') {
      this.opts.onOther?.(m);
      return;
    }
    const w = this.waiting.get(id);
    if (!w) return;
    this.waiting.delete(id);
    clearTimeout(w.timer);
    if (typeof m['error'] === 'string') w.reject(new Error(m['error']));
    else w.resolve(m);
    this.armIdle();
  }

  private armIdle(): void {
    clearTimeout(this.idle);
    if (this.waiting.size > 0 || !this.child) return;
    this.idle = setTimeout(() => this.stop(), this.opts.idleMs);
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
