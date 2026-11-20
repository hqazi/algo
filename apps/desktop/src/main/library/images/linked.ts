/**
 * Linked and `data:` images for the reader (T23, SPEC §15.4): what each
 * reference shows now (cached, failed recently, or not loaded yet), and
 * loading an article's images with the limits.
 *
 * - Only references `extractRefs` found in the article file are ever
 *   loaded; the renderer sends an article id, never a URL.
 * - Cached images are served through the asset route (`AssetRegistry`,
 *   cache variant), so the window still never contacts another host.
 * - A failed download is remembered for 1 hour; **Retry** forgets it.
 * - 4 downloads at a time; per article at most 200 images and 100 MB.
 */
import type { ImageView } from '../../../shared/library';
import type { AssetRegistry } from '../assets';
import { bareHost } from './address';
import { cacheKey, ImageCache } from './cache';
import { downloadImage, type DownloadReason, type Downloaded } from './download';
import { imageInfo, MAX_PIXELS } from './header';

export const FAILURE_MS = 60 * 60 * 1000;
export const CONCURRENCY = 4;
export const MAX_ARTICLE_IMAGES = 200;
export const MAX_ARTICLE_BYTES = 100 * 1024 * 1024;
export const MAX_DATA_BYTES = 2 * 1024 * 1024;

export type ImagesMode = 'on-open' | 'ask';

type Reason = DownloadReason | 'limit' | 'data' | 'remote';

export interface LinkedImagesDeps {
  cacheDir: string;
  assets: AssetRegistry;
  mode: () => ImagesMode;
  download?: (url: string, signal?: AbortSignal) => Promise<Downloaded>;
  now?: () => number;
}

const blocked = (reason: Reason, host: string | null): ImageView => ({
  kind: 'blocked',
  reason,
  host: host ? host.slice(0, 300) : null,
});

/** The URL a remote reference is downloaded from (`//host/x` is `https:`). */
export function remoteUrl(ref: string): string {
  return ref.startsWith('//') ? `https:${ref}` : ref;
}

function hostOf(url: string): string | null {
  try {
    return bareHost(new URL(url).hostname) || null;
  } catch {
    return null;
  }
}

const DATA_URL = /^data:([^,;]*)((?:;[^,;]*)*),([\s\S]*)$/i;
const ALLOWED_DATA = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** A `data:` image's bytes, or why it is not shown. */
export function decodeDataImage(ref: string): { bytes: Uint8Array } | { reason: Reason } {
  const m = DATA_URL.exec(ref.trim());
  if (!m) return { reason: 'data' };
  const type = m[1]!.trim().toLowerCase();
  const base64 = m[2]!.toLowerCase().split(';').includes('base64');
  if (!ALLOWED_DATA.has(type) || !base64) return { reason: 'data' };
  const text = m[3]!.replace(/\s+/g, '');
  if (text.length > Math.ceil(MAX_DATA_BYTES / 3) * 4 + 4) return { reason: 'oversize' };
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(text)) return { reason: 'data' };
  const bytes = new Uint8Array(Buffer.from(text, 'base64'));
  if (bytes.byteLength > MAX_DATA_BYTES) return { reason: 'oversize' };
  return { bytes };
}

class Gate {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  constructor(private readonly limit: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((r) => this.queue.push(r));
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }
}

export class LinkedImages {
  readonly cache: ImageCache;
  private readonly failures = new Map<
    string,
    { reason: DownloadReason; host: string | null; at: number }
  >();
  private readonly inflight = new Map<string, Promise<Downloaded>>();
  private readonly gate = new Gate(CONCURRENCY);

  constructor(private readonly deps: LinkedImagesDeps) {
    this.cache = new ImageCache(deps.cacheDir);
  }

  mode(): ImagesMode {
    return this.deps.mode();
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private async served(url: string): Promise<{ view: ImageView; size: number } | null> {
    const hit = await this.cache.get(url).catch(() => null);
    if (!hit) return null;
    const root = await this.cache.root();
    return {
      view: { kind: 'asset', url: this.deps.assets.url(null, root, hit.path) },
      size: hit.record.size,
    };
  }

  private failure(url: string) {
    const key = cacheKey(url);
    const f = this.failures.get(key);
    if (f && this.now() - f.at > FAILURE_MS) {
      this.failures.delete(key);
      return undefined;
    }
    return f;
  }

  /** What a remote reference shows now, without any network: cached, failed, or `remote` (not loaded). */
  async view(ref: string): Promise<ImageView> {
    const url = remoteUrl(ref);
    const cached = await this.served(url);
    if (cached) return cached.view;
    const f = this.failure(url);
    return f ? blocked(f.reason, f.host) : blocked('remote', hostOf(url));
  }

  /** A `data:` image, stored in the cache and served like a download (no network). */
  async dataImage(ref: string): Promise<ImageView> {
    const cached = await this.served(ref);
    if (cached) return cached.view;
    const d = decodeDataImage(ref);
    if ('reason' in d) return blocked(d.reason, null);
    const info = imageInfo(d.bytes);
    if (!info) return blocked('not_image', null);
    if (info.width * info.height > MAX_PIXELS) return blocked('pixels', null);
    await this.cache.put(ref, d.bytes, info, new Date(this.now()).toISOString());
    return (await this.served(ref))?.view ?? blocked('data', null);
  }

  private fetchOnce(url: string, signal?: AbortSignal): Promise<Downloaded> {
    const key = cacheKey(url);
    let p = this.inflight.get(key);
    if (!p) {
      const download =
        this.deps.download ??
        ((u: string, s?: AbortSignal) => downloadImage(u, s ? { signal: s } : {}));
      p = this.gate
        .run(async () => {
          if (signal?.aborted)
            return { ok: false as const, reason: 'timeout' as const, host: hostOf(url) };
          const d = await download(url, signal);
          if (d.ok) await this.cache.put(url, d.bytes, d.info, new Date(this.now()).toISOString());
          else if (!signal?.aborted)
            this.failures.set(key, { reason: d.reason, host: d.host, at: this.now() });
          return d;
        })
        .finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    return p;
  }

  /**
   * Loads an article's remote references (each once, 4 at a time) and
   * returns what each shows. `retry` forgets earlier failures first.
   */
  async load(
    refs: readonly string[],
    opts: { retry?: boolean; signal?: AbortSignal } = {},
  ): Promise<Record<string, ImageView>> {
    const out: Record<string, ImageView> = {};
    let bytes = 0;
    const over = () => bytes > MAX_ARTICLE_BYTES;
    await Promise.all(
      refs.map(async (ref, i) => {
        const url = remoteUrl(ref);
        if (opts.retry) this.failures.delete(cacheKey(url));
        if (i >= MAX_ARTICLE_IMAGES) {
          out[ref] = blocked('limit', hostOf(url));
          return;
        }
        const cached = await this.served(url);
        if (cached) {
          bytes += cached.size;
          out[ref] = over() ? blocked('limit', hostOf(url)) : cached.view;
          return;
        }
        const f = this.failure(url);
        if (f) {
          out[ref] = blocked(f.reason, f.host);
          return;
        }
        if (over()) {
          out[ref] = blocked('limit', hostOf(url));
          return;
        }
        const d = await this.fetchOnce(url, opts.signal);
        if (!d.ok) {
          out[ref] = blocked(d.reason, d.host);
          return;
        }
        bytes += d.bytes.byteLength;
        out[ref] = over()
          ? blocked('limit', hostOf(url))
          : ((await this.served(url))?.view ?? blocked('network', hostOf(url)));
      }),
    );
    return out;
  }

  usage(): Promise<{ images: number; bytes: number }> {
    return this.cache.usage();
  }

  /** Clears the cache and the failure memory. */
  async clear(): Promise<void> {
    this.failures.clear();
    await this.cache.clear();
  }
}
