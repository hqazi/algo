/**
 * The Kokoro model download (T38): pinned files checked by hash, redirects
 * only to Hugging Face hosts, a stopped download never "installed", files
 * already there kept, and one download shared by its callers.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DownloadError,
  FILES,
  fileUrl,
  isAllowedHost,
  MODEL_FILE,
  ModelStore,
  REVISION,
  TOTAL_BYTES,
  type FetchFn,
  type ModelFile,
} from './model';

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const bytes = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);

const A = bytes('model bytes '.repeat(100));
const B = bytes('voice');
const FAKE: ModelFile[] = [
  { path: 'onnx/model.onnx', bytes: A.length, sha256: sha(A) },
  { path: 'voices/af_heart.bin', bytes: B.length, sha256: sha(B) },
];
const BODIES: Record<string, Uint8Array<ArrayBuffer>> = {
  [fileUrl('onnx/model.onnx')]: A,
  [fileUrl('voices/af_heart.bin')]: B,
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tts-model-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Answers each Hugging Face URL with a redirect to the CDN, then the body. */
function hub(over: Partial<Record<string, () => Response>> = {}) {
  const seen: string[] = [];
  const fetch: FetchFn = async (url, init) => {
    seen.push(url);
    expect(init.redirect).toBe('manual');
    expect(Object.keys(init.headers).map((h) => h.toLowerCase())).not.toContain('cookie');
    const custom = over[url];
    if (custom) return custom();
    if (url.startsWith('https://huggingface.co/')) {
      return new Response(null, {
        status: 302,
        headers: { location: `https://cdn-lfs.hf.co/x?u=${encodeURIComponent(url)}` },
      });
    }
    const original = decodeURIComponent(new URL(url).searchParams.get('u') ?? '');
    const body = BODIES[original];
    return body ? new Response(body) : new Response('missing', { status: 404 });
  };
  return { fetch, seen };
}

describe('ModelStore', () => {
  it('pins one revision, and every file with a size and hash', () => {
    expect(REVISION).toMatch(/^[0-9a-f]{40}$/);
    expect(FILES[0]).toBe(MODEL_FILE);
    expect(FILES).toHaveLength(29);
    for (const f of FILES) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.bytes).toBeGreaterThan(0);
    }
    expect(TOTAL_BYTES).toBe(340_154_952);
    expect(fileUrl('onnx/model.onnx')).toBe(
      `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/${REVISION}/onnx/model.onnx`,
    );
  });

  it('allows Hugging Face and its CDN only', () => {
    expect(isAllowedHost('huggingface.co')).toBe(true);
    expect(isAllowedHost('cas-bridge.xethub.hf.co')).toBe(true);
    expect(isAllowedHost('HUGGINGFACE.CO')).toBe(true);
    expect(isAllowedHost('hf.co.evil.example')).toBe(false);
    expect(isAllowedHost('evilhf.co')).toBe(false);
    expect(isAllowedHost('.hf.co')).toBe(false);
    expect(isAllowedHost('example.com')).toBe(false);
  });

  it('downloads, checks and installs, reporting progress', async () => {
    const { fetch } = hub();
    const store = new ModelStore({ cacheDir: dir, fetch, files: FAKE });
    expect(await store.installed()).toBe(false);
    const progress: number[] = [];
    await store.download((p) => progress.push(p.received));
    expect(await store.installed()).toBe(true);
    expect(await readFile(store.path('onnx/model.onnx'))).toEqual(Buffer.from(A));
    expect(progress.at(-1)).toBe(store.bytes);
    const marker = JSON.parse(await readFile(join(store.dir, 'ready.json'), 'utf8'));
    expect(marker.revision).toBe(REVISION);
  });

  it('fails on a checksum mismatch and leaves nothing installed', async () => {
    const bad = bytes('model bytes '.repeat(99) + 'MODEL BYTES ');
    const { fetch } = hub({
      [fileUrl('onnx/model.onnx')]: () => new Response(bad),
    });
    const store = new ModelStore({ cacheDir: dir, fetch, files: FAKE });
    await expect(store.download(() => undefined)).rejects.toMatchObject({ reason: 'checksum' });
    expect(await store.installed()).toBe(false);
    await expect(stat(store.path('onnx/model.onnx'))).rejects.toThrow();
    await expect(stat(`${store.path('onnx/model.onnx')}.part`)).rejects.toThrow();
  });

  it('refuses a redirect to another host, and plain http', async () => {
    for (const location of ['https://example.com/model.onnx', 'http://cdn-lfs.hf.co/x']) {
      const { fetch } = hub({
        [fileUrl('onnx/model.onnx')]: () =>
          new Response(null, { status: 302, headers: { location } }),
      });
      const store = new ModelStore({ cacheDir: dir, fetch, files: FAKE });
      const err = await store.download(() => undefined).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DownloadError);
      expect((err as DownloadError).reason).toBe('redirect');
    }
  });

  it('fails on an HTTP error', async () => {
    const { fetch } = hub({
      [fileUrl('onnx/model.onnx')]: () => new Response('no', { status: 503 }),
    });
    const store = new ModelStore({ cacheDir: dir, fetch, files: FAKE });
    await expect(store.download(() => undefined)).rejects.toMatchObject({ reason: 'http' });
  });

  it('keeps files already downloaded', async () => {
    const store0 = new ModelStore({ cacheDir: dir, files: FAKE });
    await mkdir(join(store0.dir, 'onnx'), { recursive: true });
    await writeFile(store0.path('onnx/model.onnx'), A);
    const { fetch, seen } = hub();
    const store = new ModelStore({ cacheDir: dir, fetch, files: FAKE });
    await store.download(() => undefined);
    expect(seen.some((u) => u.includes('model.onnx'))).toBe(false);
    expect(await store.installed()).toBe(true);
  });

  it('shares one download, aborted only when every caller has cancelled', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { fetch: inner } = hub();
    let calls = 0;
    const fetch: FetchFn = async (url, init) => {
      calls++;
      await gate;
      init.signal.throwIfAborted();
      return inner(url, init);
    };
    const store = new ModelStore({ cacheDir: dir, fetch, files: FAKE });
    const a = new AbortController();
    const b = new AbortController();
    const first = store.download(() => undefined, a.signal);
    const second = store.download(() => undefined, b.signal);
    expect(store.downloading).toBe(true);
    a.abort();
    release();
    await Promise.all([first, second]);
    expect(await store.installed()).toBe(true);
    expect(calls).toBe(4); // two files, a redirect each: one download, not two
    expect(store.downloading).toBe(false);

    // Now both cancel: it stops, and is not installed.
    await store.remove();
    const c = new AbortController();
    const stopped = store.download(() => undefined, c.signal);
    c.abort();
    await expect(stopped).rejects.toThrow();
    expect(await store.installed()).toBe(false);
  });

  it('removes the download, but not while downloading', async () => {
    const { fetch } = hub();
    const store = new ModelStore({ cacheDir: dir, fetch, files: FAKE });
    await store.download(() => undefined);
    await store.remove();
    expect(await store.installed()).toBe(false);
    await expect(stat(store.dir)).rejects.toThrow();
  });
});
