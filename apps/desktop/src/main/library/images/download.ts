/**
 * Downloading one linked image (T23, SPEC §15.4) in the main process.
 *
 * - `https:` on port 443 only, no user info in the URL.
 * - The host is resolved first and every address must be public
 *   (`address.ts`); the connection then goes to the address that was checked
 *   (a fixed `lookup`), so a DNS answer that changes cannot reach the local
 *   network.
 * - Redirects are followed by hand, each target checked the same way, at
 *   most 3. No cookies, `Referer` or credentials; a generic `User-Agent`,
 *   `Accept: image/*`, no compression.
 * - 10 MB and 15 s per request; the body must start with PNG, JPEG, GIF or
 *   WebP magic and state at most 100 megapixels. Nothing is decoded here.
 *
 * Unlike the open-set fetcher (`intake/fetch.ts`, any host on an allowlist,
 * via `fetch`) this needs its own transport: `fetch` cannot pin the address.
 * The resolver and the transport are injected so tests never touch the
 * network.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import type { IncomingMessage, RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { bareHost, isBlockedAddress, isLocalName } from './address';
import { imageInfo, MAX_PIXELS, type ImageInfo } from './header';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const REQUEST_MS = 15_000;
export const MAX_REDIRECTS = 3;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
export const REQUEST_HEADERS: Readonly<Record<string, string>> = {
  'user-agent': 'Mozilla/5.0',
  accept: 'image/*',
  'accept-encoding': 'identity',
};

/** Why a linked image was not downloaded (shown on its placeholder). */
export type DownloadReason =
  | 'insecure'
  | 'scheme'
  | 'port'
  | 'local_address'
  | 'redirects'
  | 'oversize'
  | 'timeout'
  | 'not_image'
  | 'pixels'
  | 'http'
  | 'network';

export interface Address {
  address: string;
  family: 4 | 6;
}
export type Resolve = (host: string) => Promise<Address[]>;

export interface TransportRequest {
  url: URL;
  /** The checked address to connect to. */
  address: Address;
  headers: Record<string, string>;
  signal: AbortSignal;
}
export interface TransportResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
  close(): void;
}
export type Transport = (r: TransportRequest) => Promise<TransportResponse>;

export type Downloaded =
  | { ok: true; bytes: Uint8Array; info: ImageInfo; url: string }
  | { ok: false; reason: DownloadReason; host: string | null };

export interface DownloadOptions {
  resolve?: Resolve;
  transport?: Transport;
  maxBytes?: number;
  timeoutMs?: number;
  /** Stops the download (e.g. "Make available offline" cancelled): `timeout`. */
  signal?: AbortSignal;
}

class Refused extends Error {
  constructor(
    readonly reason: DownloadReason,
    readonly host: string | null,
  ) {
    super(reason);
  }
}

/** Is this URL one the downloader may request? Throws `Refused` if not. */
export function checkImageUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Refused('scheme', null);
  }
  const host = bareHost(u.hostname) || null;
  if (u.protocol === 'http:') throw new Refused('insecure', host);
  if (u.protocol !== 'https:' || !host || u.username || u.password)
    throw new Refused('scheme', host);
  if (u.port && u.port !== '443') throw new Refused('port', host);
  if (isLocalName(host)) throw new Refused('local_address', host);
  if (isIP(host) && isBlockedAddress(host)) throw new Refused('local_address', host);
  return u;
}

export const systemResolve: Resolve = async (host) =>
  (await dnsLookup(host, { all: true, verbatim: true })).map((a) => ({
    address: a.address,
    family: a.family === 6 ? 6 : 4,
  }));

/** The address to connect to, after checking every address the name has. */
async function pick(u: URL, resolve: Resolve): Promise<Address> {
  const host = bareHost(u.hostname);
  const kind = isIP(host);
  if (kind) return { address: host, family: kind === 6 ? 6 : 4 };
  let addresses: Address[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new Refused('network', host);
  }
  if (!addresses.length) throw new Refused('network', host);
  if (addresses.some((a) => isBlockedAddress(a.address))) throw new Refused('local_address', host);
  return addresses[0]!;
}

type LookupCallback = (
  err: Error | null,
  address: string | { address: string; family: number }[],
  family?: number,
) => void;

/** A `lookup` that ignores the name and answers the checked address. */
export function pinnedLookup(a: Address) {
  return (_host: string, opts: unknown, cb: LookupCallback): void => {
    const all = typeof opts === 'object' && opts !== null && (opts as { all?: boolean }).all;
    if (all) cb(null, [{ address: a.address, family: a.family }]);
    else cb(null, a.address, a.family);
  };
}

/**
 * The real transport: `https.request` with the pinned `lookup`, no agent
 * (no shared sockets, no cookies). `request` and `port` are for tests.
 */
export function httpsTransport(
  over: {
    request?: (
      o: RequestOptions,
      cb: (res: IncomingMessage) => void,
    ) => {
      on(ev: 'error', fn: (e: Error) => void): unknown;
      end(): unknown;
      destroy(): unknown;
    };
    port?: number;
  } = {},
): Transport {
  const request = over.request ?? httpsRequest;
  return ({ url, address, headers, signal }) =>
    new Promise((resolve, reject) => {
      const host = bareHost(url.hostname);
      const req = request(
        {
          protocol: over.request ? undefined : 'https:',
          hostname: host,
          ...(isIP(host) ? {} : { servername: host }),
          port: over.port ?? 443,
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          headers: { ...headers, host: url.host },
          lookup: pinnedLookup(address) as RequestOptions['lookup'],
          agent: false,
          signal,
        } as RequestOptions,
        (res) => {
          const h: Record<string, string | undefined> = {};
          for (const [k, v] of Object.entries(res.headers))
            h[k] = Array.isArray(v) ? v.join(', ') : v;
          resolve({
            status: res.statusCode ?? 0,
            headers: h,
            body: res,
            close: () => {
              res.destroy();
              req.destroy();
            },
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
}

/** Reads the body up to `max` bytes, stopping when `signal` aborts. */
async function readBody(
  body: AsyncIterable<Uint8Array>,
  max: number,
  signal: AbortSignal,
  host: string,
) {
  const it = body[Symbol.asyncIterator]();
  const aborted = new Promise<never>((_, reject) => {
    const fail = () => reject(new Refused('timeout', host));
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
  aborted.catch(() => {});
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      let next: IteratorResult<Uint8Array>;
      try {
        next = await Promise.race([it.next(), aborted]);
      } catch (e) {
        if (e instanceof Refused) throw e;
        throw new Refused(signal.aborted ? 'timeout' : 'network', host);
      }
      if (next.done) break;
      chunks.push(next.value);
      size += next.value.byteLength;
      if (size > max) throw new Refused('oversize', host);
    }
  } finally {
    void Promise.resolve(it.return?.()).catch(() => {});
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** Downloads and checks one image; never throws. */
export async function downloadImage(raw: string, opts: DownloadOptions = {}): Promise<Downloaded> {
  const resolve = opts.resolve ?? systemResolve;
  const transport = opts.transport ?? httpsTransport();
  const max = opts.maxBytes ?? MAX_IMAGE_BYTES;
  let current: URL | null = null;
  try {
    current = checkImageUrl(raw);
    for (let hop = 0; ; hop++) {
      const host = bareHost(current.hostname);
      const address = await pick(current, resolve);
      if (opts.signal?.aborted) throw new Refused('timeout', host);
      const timer = AbortSignal.timeout(opts.timeoutMs ?? REQUEST_MS);
      const signal = opts.signal ? AbortSignal.any([timer, opts.signal]) : timer;
      let res: TransportResponse;
      try {
        res = await transport({ url: current, address, headers: { ...REQUEST_HEADERS }, signal });
      } catch {
        throw new Refused(signal.aborted ? 'timeout' : 'network', host);
      }
      try {
        if (REDIRECTS.has(res.status)) {
          const location = res.headers.location?.trim();
          if (!location) throw new Refused('http', host);
          if (hop >= MAX_REDIRECTS) throw new Refused('redirects', host);
          let next: URL;
          try {
            next = new URL(location, current);
          } catch {
            throw new Refused('http', host);
          }
          current = checkImageUrl(next.href);
          continue;
        }
        if (res.status !== 200) throw new Refused('http', host);
        const length = res.headers['content-length'];
        if (length && /^\d+$/.test(length) && Number(length) > max)
          throw new Refused('oversize', host);
        const bytes = await readBody(res.body, max, signal, host);
        const info = imageInfo(bytes);
        if (!info) throw new Refused('not_image', host);
        if (info.width * info.height > MAX_PIXELS) throw new Refused('pixels', host);
        return { ok: true, bytes, info, url: current.href };
      } finally {
        res.close();
      }
    }
  } catch (e) {
    if (e instanceof Refused) return { ok: false, reason: e.reason, host: e.host };
    return { ok: false, reason: 'network', host: current ? bareHost(current.hostname) : null };
  }
}
