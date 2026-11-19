/**
 * Fetching for open sets (SPEC §5.3, §10): a fixed host allowlist, no other
 * hosts. Ported from `dsa-tutor/dsa_tutor/intake/open_sets/fetch.py`.
 *
 *   const fetcher = new Fetcher({ allowedHosts: ['raw.githubusercontent.com'], cacheDir })
 *   const text = await fetcher.getText('https://raw.githubusercontent.com/...')
 *
 * Rules, all enforced here rather than by the caller:
 * - https only, port 443, no user info, and the host must be on the allowlist;
 * - redirects are followed by hand (at most `maxRedirects`) and only to the
 *   same host; a redirect to any other host is refused, allowlisted or not;
 * - a timeout per request and a deadline for the whole fetch;
 * - a size cap (`Content-Length` checked first, the body read to the cap + 1);
 * - successful bodies are cached on disk (`<data>/cache/open-sets/<host>/<sha256 of the URL>`);
 *   importers fetch pinned URLs, so a cached body never goes stale and a
 *   second import works offline.
 *
 * Only the main process fetches; the model has no tool for it. `fetch` is
 * injectable so tests never touch the network; the app uses Node's `fetch`
 * (DECISIONS D-26).
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { FetchError } from '@algorithm-tutor/core';

export const TIMEOUT_MS = 15_000;
export const DEADLINE_MS = 30_000;
export const MAX_BYTES = 1_000_000;
export const MAX_REDIRECTS = 3;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const USER_AGENT = 'algorithm-tutor-open-set-importer';

export type FetchFn = (
  url: string,
  init: { redirect: 'manual'; signal: AbortSignal; headers: Record<string, string> },
) => Promise<Response>;

export interface FetcherOptions {
  allowedHosts: readonly string[];
  cacheDir: string;
  fetch?: FetchFn;
  timeoutMs?: number;
  deadlineMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};

export class Fetcher {
  private readonly allowed: Set<string>;
  private readonly fetchFn: FetchFn;

  constructor(private readonly opts: FetcherOptions) {
    this.allowed = new Set(opts.allowedHosts.map((h) => h.toLowerCase()));
    this.fetchFn = opts.fetch ?? ((url, init) => fetch(url, init));
  }

  /** Throws `FetchError('not_allowed')` unless `url` is plain https on an allowlisted host. */
  checkUrl(url: string): void {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new FetchError('not_allowed', 'not a valid URL');
    }
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443'))
      throw new FetchError('not_allowed', 'only plain https URLs can be fetched');
    if (!this.allowed.has(u.hostname.toLowerCase()))
      throw new FetchError(
        'not_allowed',
        `the host "${u.hostname || '?'}" is not on the open-set allowlist`,
      );
  }

  cachePath(url: string): string {
    return join(
      this.opts.cacheDir,
      hostOf(url),
      createHash('sha256').update(url, 'utf8').digest('hex'),
    );
  }

  async getText(url: string): Promise<string> {
    return new TextDecoder('utf-8').decode(await this.get(url));
  }

  async get(url: string): Promise<Uint8Array> {
    this.checkUrl(url);
    const cached = this.cachePath(url);
    try {
      return new Uint8Array(await readFile(cached));
    } catch {
      // not cached yet
    }
    const deadline = Date.now() + (this.opts.deadlineMs ?? DEADLINE_MS);
    const maxRedirects = this.opts.maxRedirects ?? MAX_REDIRECTS;
    let current = url;
    for (let i = 0; i <= maxRedirects; i++) {
      if (Date.now() > deadline)
        throw new FetchError('timeout', 'fetching from the open set took too long');
      const res = await this.request(current, deadline);
      if (REDIRECTS.has(res.status)) {
        void res.body?.cancel().catch(() => {});
        const location = res.headers.get('location')?.trim();
        if (!location)
          throw new FetchError('http', `the open set answered ${res.status} without a location`);
        const target = new URL(location, current).toString();
        if (hostOf(target) !== hostOf(current))
          throw new FetchError(
            'redirect_refused',
            `refused a redirect from "${hostOf(current)}" to "${hostOf(target) || '?'}": ` +
              'only the same host is followed',
          );
        this.checkUrl(target);
        current = target;
        continue;
      }
      if (res.status === 404)
        throw new FetchError('not_found', 'the open set does not have this file');
      if (res.status !== 200)
        throw new FetchError('http', `the open set answered HTTP ${res.status}`);
      const body = await this.readBody(res, deadline);
      await store(cached, body);
      return body;
    }
    throw new FetchError('too_many_redirects', `more than ${maxRedirects} redirects`);
  }

  private async request(url: string, deadline: number): Promise<Response> {
    const ms = Math.max(1, Math.min(this.opts.timeoutMs ?? TIMEOUT_MS, deadline - Date.now()));
    const signal = AbortSignal.timeout(ms);
    try {
      return await this.fetchFn(url, {
        redirect: 'manual',
        signal,
        headers: { 'user-agent': USER_AGENT, 'accept-encoding': 'identity' },
      });
    } catch (e) {
      if (e instanceof FetchError) throw e;
      if (signal.aborted) throw new FetchError('timeout', 'the open set did not answer in time');
      throw new FetchError('network', 'could not reach the open set');
    }
  }

  private async readBody(res: Response, deadline: number): Promise<Uint8Array> {
    const max = this.opts.maxBytes ?? MAX_BYTES;
    const length = res.headers.get('content-length');
    if (length && /^\d+$/.test(length) && Number(length) > max)
      throw new FetchError('too_large', `the file is larger than ${max} bytes`);
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = res.body?.getReader();
    if (!reader) return new Uint8Array();
    try {
      for (;;) {
        if (Date.now() > deadline)
          throw new FetchError('timeout', 'the open set took too long to send the file');
        let next: ReadableStreamReadResult<Uint8Array>;
        try {
          next = await reader.read();
        } catch {
          throw new FetchError('timeout', 'the open set stopped sending the file');
        }
        if (next.done) break;
        chunks.push(next.value);
        size += next.value.byteLength;
        if (size > max) throw new FetchError('too_large', `the file is larger than ${max} bytes`);
      }
    } finally {
      void reader.cancel().catch(() => {});
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.byteLength;
    }
    return out;
  }
}

async function store(path: string, body: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, body);
  await rename(tmp, path);
}
