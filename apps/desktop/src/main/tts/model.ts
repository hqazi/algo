/**
 * The Kokoro model and voices, and eSpeak NG, on disk (T38, T40, D-59,
 * D-61): downloaded once, on the learner's say-so, by the main process, into
 * `<data>/cache/kokoro-v1.0/` (a cache: not exported, removed by "reset
 * everything", downloaded again when needed).
 *
 * - Pinned: one revision of `onnx-community/Kokoro-82M-v1.0-ONNX` from
 *   Hugging Face, and eSpeak NG as the `phonemizer` npm package publishes it
 *   (one file, from jsDelivr), with every file's size and SHA-256 written
 *   here. A file whose hash differs is deleted and the download fails;
 *   nothing unchecked is ever loaded.
 * - eSpeak NG is GPL-3.0 and the app is Apache-2.0, so the app never ships
 *   it: it is downloaded here and run in its own process (D-61).
 * - `https:` only; redirects followed by hand, at most 5. The model's go only
 *   to `huggingface.co` or a `*.hf.co` host (its CDN); eSpeak's only to the
 *   host it is fetched from. No cookies or credentials; a generic user agent.
 * - Each file goes to `<name>.part` and is renamed when its hash checks out;
 *   `ready.json` is written last, so a stopped download is never "installed".
 * - One download at a time: a second caller follows the same one, and it is
 *   aborted only when every caller has cancelled.
 *
 * `fetch` is injected so tests never touch the network.
 */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { VoiceId } from '../../shared/tts';

export const REPO = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const REVISION = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';
export const MODEL_DIR_NAME = 'kokoro-v1.0';
const MARKER = 'ready.json';

export interface ModelFile {
  path: string;
  bytes: number;
  sha256: string;
  /** Where it comes from, when not the model repo. */
  url?: string;
}

/** The full-precision model: on the native runtime it is both faster and better than the quantized ones (D-59). */
export const MODEL_FILE: ModelFile = {
  path: 'onnx/model.onnx',
  bytes: 325_532_232,
  sha256: '8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb',
};

// prettier-ignore
const VOICE_FILES: Record<VoiceId, [number, string]> = {
  af_alloy: [522240, 'c4a6b876047fd7fb472edf4ebd63cfac7c3b958a7cae7c106e8f038ca6308c45'],
  af_aoede: [522240, '4a004c33430762e2461eedb2013fad808ef4ab3121f5300f554476caf58d8361'],
  af_bella: [522240, 'f69d836209b78eb8c66e75e3cda491e26ea838a3674257e9d4e5703cbaf55c8b'],
  af_heart: [522240, 'd583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b'],
  af_jessica: [522240, 'a240a5e3c15b43563d6e923bdca8ef5613a23471d9b77653694012435df23bd8'],
  af_kore: [522240, '9be5221b6a941c04b561959b8ff0b06e809444dcc4ab7e75a7b23606f691819e'],
  af_nicole: [522240, 'cd2191ab31b914ed7b318416b0e4440fdf392ddad9106a060819aa600a64f59a'],
  af_nova: [522240, '18778272caa0d0eebaea251c35fd635f038434f9eee5e691d02a174bd328414f'],
  af_river: [522240, '00a2bcf82b1d86e8f19902ede58c65ccf6c0e43b44b7d74fad54e5d8933c9c30'],
  af_sarah: [522240, '4409fbc125afabacc615d94db5398d847006a737b0247d6892b7a9a0007a2f0a'],
  af_sky: [522240, '4435255c9744f3f31659e0d714ab7689bf65d9e77ec1cce060f083912614f0b9'],
  am_adam: [522240, '162b035ed91cfc48b6046982184c645f72edcdd1b82843347f605d7bf7b15716'],
  am_echo: [522240, '3968b92c3c4cd1c4416dbded36c13eaa388a90d5788d02a13e4d781f5f8cf3c3'],
  am_eric: [522240, 'e8b5be17edd1e3636901ce7598baafe2dc8dd8ff707a0c23bf9e461add7e2832'],
  am_fenrir: [522240, 'c27989f741f7ee34d273a39d8a595cc0837d35f5ced9a29b7cc162614616df43'],
  am_liam: [522240, '52403be32fd047c6a44517cb0bcd6b134f2a18baa73e70ef41651e0eab921ade'],
  am_michael: [522240, '1d1f21dd8da39c30705cd4c75d039d265e9bc4a2a93ed09bc9e1b1225eb95ba1'],
  am_onyx: [522240, 'da5d135b424164916d75a68ffb4c2abce3d7d5ccc82dd1ee6cf447ce286145e6'],
  am_puck: [522240, 'fcf73c989033e9233e0b98713eca600c8c74dcc1614b37009d5450ff4a2274a0'],
  am_santa: [522240, '61150cf726ab6c5ed7a99f90a304f91f5a72c00c592e89ec94e5df11c319227a'],
  bf_alice: [522240, '08afa6ba24da61ea5e8efa139e5aadc938d83f0a6da5a900adaf763ac1da5573'],
  bf_emma: [522240, '669fe0647f9dd04fcab92f1439a40eeb4c8b4ab1f82e4996fe3d918ce4a63b73'],
  bf_isabella: [522240, '3754352c4aaa46d17f27654ab7518d65b62ad6163a0f55a5f4330c2da2c4e94f'],
  bf_lily: [522240, '5e0ee32ebe64a467124976b14e69590746f1c4ce41a12b587a50c862edfea335'],
  bm_daniel: [522240, '6b3194bbceffb746733cbc22c8f593dd44e401a71d53895a2dca891bc595a1e8'],
  bm_fable: [522240, 'f889083196807b4adb15e9204252165f503b8d33d3982e681c52443c49d798f1'],
  bm_george: [522240, 'c4b235a4c1f2cd3b939fed08b899ce9385638b763f7b73a59616c4fc9bd6c9bc'],
  bm_lewis: [522240, 'b8f671cef828c30e66fdf0b0756a76bba58f6bb3398cbbf27058642acbcedb97'],
};

/**
 * eSpeak NG compiled to WebAssembly, as `phonemizer` 1.2.1 publishes it on
 * npm (one self-contained module): turns text into the phonemes Kokoro
 * reads. GPL-3.0, so downloaded, never shipped (D-61).
 */
export const ESPEAK_FILE: ModelFile = {
  path: 'espeak/phonemizer.js',
  bytes: 1_322_380,
  sha256: '193481f474f7c1ea81df3195d18b45df8ef7254dbdccb3f193d60215c4897bec',
  url: 'https://cdn.jsdelivr.net/npm/phonemizer@1.2.1/dist/phonemizer.js',
};

export const voicePath = (voice: VoiceId): string => `voices/${voice}.bin`;

export const FILES: readonly ModelFile[] = [
  MODEL_FILE,
  ...Object.entries(VOICE_FILES).map(([id, [bytes, sha256]]) => ({
    path: voicePath(id as VoiceId),
    bytes,
    sha256,
  })),
  ESPEAK_FILE,
];
export const TOTAL_BYTES = FILES.reduce((n, f) => n + f.bytes, 0);

export const fileUrl = (path: string): string =>
  `https://huggingface.co/${REPO}/resolve/${REVISION}/${path}`;

/** Where a file is downloaded from. */
export const urlOf = (f: ModelFile): string => f.url ?? fileUrl(f.path);

export const MAX_REDIRECTS = 5;
/** No bytes for this long ends the download. */
export const STALL_MS = 30_000;
const PROGRESS_STEP = 1024 * 1024;

/** The model repo's hosts. */
export function isAllowedHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'huggingface.co' || (h.endsWith('.hf.co') && h.length > '.hf.co'.length);
}

export type FetchFn = (
  url: string,
  init: { redirect: 'manual'; signal: AbortSignal; headers: Record<string, string> },
) => Promise<Response>;

export class DownloadError extends Error {
  constructor(
    readonly reason: 'http' | 'redirect' | 'checksum' | 'network' | 'stalled',
    message: string,
  ) {
    super(message);
  }
}

export interface Progress {
  received: number;
  total: number;
}

interface Running {
  promise: Promise<void>;
  abort: AbortController;
  listeners: Set<(p: Progress) => void>;
  last: Progress;
}

export class ModelStore {
  readonly dir: string;
  private readonly fetchFn: FetchFn;
  private running: Running | null = null;

  private readonly files: readonly ModelFile[];
  /** What a download fetches, in bytes. */
  readonly bytes: number;

  constructor(opts: { cacheDir: string; fetch?: FetchFn; files?: readonly ModelFile[] }) {
    this.dir = join(opts.cacheDir, MODEL_DIR_NAME);
    this.fetchFn = opts.fetch ?? ((url, init) => fetch(url, init));
    this.files = opts.files ?? FILES;
    this.bytes = this.files.reduce((n, f) => n + f.bytes, 0);
  }

  path(file: string): string {
    return join(this.dir, ...file.split('/'));
  }

  /** The marker is there and names this revision, and every file has its size. */
  async installed(): Promise<boolean> {
    try {
      const marker = JSON.parse(await readFile(join(this.dir, MARKER), 'utf8')) as {
        revision?: unknown;
      };
      if (marker.revision !== REVISION) return false;
      for (const f of this.files)
        if ((await stat(this.path(f.path))).size !== f.bytes) return false;
      return true;
    } catch {
      return false;
    }
  }

  get downloading(): boolean {
    return this.running !== null;
  }

  /**
   * Downloads what is missing (files already there with the right size and
   * hash are kept). Resolves when installed; rejects with `DownloadError`, or
   * an `AbortError` once every caller has aborted.
   */
  download(onProgress: (p: Progress) => void, signal?: AbortSignal): Promise<void> {
    let run = this.running;
    if (!run) {
      const abort = new AbortController();
      const listeners = new Set<(p: Progress) => void>();
      const r: Running = {
        abort,
        listeners,
        last: { received: 0, total: this.bytes },
        promise: Promise.resolve(),
      };
      r.promise = this.fetchAll(abort.signal, (p) => {
        r.last = p;
        for (const l of listeners) l(p);
      }).finally(() => {
        if (this.running === r) this.running = null;
      });
      this.running = r;
      run = r;
    }
    const mine = run;
    mine.listeners.add(onProgress);
    onProgress(mine.last);
    if (signal) {
      const leave = (): void => {
        mine.listeners.delete(onProgress);
        if (mine.listeners.size === 0) mine.abort.abort();
      };
      if (signal.aborted) leave();
      else signal.addEventListener('abort', leave, { once: true });
    }
    return mine.promise.finally(() => mine.listeners.delete(onProgress));
  }

  /** Deletes the model, voices and eSpeak (Settings → Library). Refused while downloading. */
  async remove(): Promise<void> {
    if (this.running) throw new Error('downloading');
    await rm(this.dir, { recursive: true, force: true });
  }

  private async fetchAll(signal: AbortSignal, progress: (p: Progress) => void): Promise<void> {
    await rm(join(this.dir, MARKER), { force: true });
    let received = 0;
    let reported = 0;
    const report = (force = false): void => {
      if (force || received - reported >= PROGRESS_STEP) {
        reported = received;
        progress({ received, total: this.bytes });
      }
    };
    for (const f of this.files) {
      signal.throwIfAborted();
      const dest = this.path(f.path);
      if (await hasFile(dest, f)) {
        received += f.bytes;
        report();
        continue;
      }
      await mkdir(dirname(dest), { recursive: true });
      const before = received;
      try {
        await this.fetchFile(f, dest, signal, (n) => {
          received = before + n;
          report();
        });
      } catch (e) {
        await rm(`${dest}.part`, { force: true });
        throw e;
      }
      received = before + f.bytes;
    }
    report(true);
    await writeFile(
      join(this.dir, MARKER),
      JSON.stringify({ repo: REPO, revision: REVISION, files: this.files.length }),
    );
  }

  private async fetchFile(
    f: ModelFile,
    dest: string,
    signal: AbortSignal,
    onBytes: (n: number) => void,
  ): Promise<void> {
    const stall = new AbortController();
    const both = AbortSignal.any([signal, stall.signal]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => stall.abort(), STALL_MS);
    };
    arm();
    try {
      const res = await this.open(urlOf(f), both, (host) =>
        f.url ? host.toLowerCase() === new URL(f.url).hostname : isAllowedHost(host),
      );
      if (!res.body) throw new DownloadError('http', `no body for ${f.path}`);
      const hash = createHash('sha256');
      const out = createWriteStream(`${dest}.part`);
      const closed = new Promise<void>((resolve, reject) => {
        out.on('close', resolve);
        out.on('error', reject);
      });
      let n = 0;
      try {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          arm();
          n += chunk.byteLength;
          if (n > f.bytes) throw new DownloadError('checksum', `${f.path} is larger than expected`);
          hash.update(chunk);
          if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()));
          onBytes(n);
        }
      } finally {
        out.end();
        await closed;
      }
      if (n !== f.bytes || hash.digest('hex') !== f.sha256) {
        throw new DownloadError('checksum', `${f.path} did not match its checksum`);
      }
      await rename(`${dest}.part`, dest);
    } catch (e) {
      if (stall.signal.aborted && !signal.aborted) {
        throw new DownloadError('stalled', `the download stalled (${f.path})`);
      }
      if (signal.aborted || e instanceof DownloadError) throw e;
      throw new DownloadError(
        'network',
        `${f.path}: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** GET with redirects followed by hand, each target checked. */
  private async open(
    url: string,
    signal: AbortSignal,
    allowed: (host: string) => boolean,
  ): Promise<Response> {
    let current = url;
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const u = new URL(current);
      if (u.protocol !== 'https:' || u.username || u.password || !allowed(u.hostname)) {
        throw new DownloadError('redirect', `refused to download from ${u.hostname || current}`);
      }
      const res = await this.fetchFn(current, {
        redirect: 'manual',
        signal,
        headers: { 'user-agent': 'algo-read-aloud', 'accept-encoding': 'identity' },
      });
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers.get('location');
        await res.body?.cancel();
        if (!location) throw new DownloadError('http', `${res.status} without a location`);
        current = new URL(location, current).href;
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new DownloadError('http', `${u.hostname} answered ${res.status}`);
      }
      return res;
    }
    throw new DownloadError('redirect', `more than ${MAX_REDIRECTS} redirects`);
  }
}

/** A file already downloaded: the right size and hash. */
async function hasFile(path: string, f: ModelFile): Promise<boolean> {
  try {
    if ((await stat(path)).size !== f.bytes) return false;
    const hash = createHash('sha256');
    hash.update(await readFile(path));
    return hash.digest('hex') === f.sha256;
  } catch {
    return false;
  }
}
