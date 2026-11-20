/**
 * Test-only (T26): a local HTTPS stand-in for a public image host, and the
 * linked-image downloader pointed at it. Used by `check:security` and the
 * Library end-to-end test's entry (`e2e-main.ts`); neither ships (see
 * `electron-builder.yml`).
 *
 * The real downloader (`downloadImage`) runs unchanged: URL checks, address
 * checks on every hop, redirects by hand, caps and magic bytes. Only the
 * name resolution and the socket are replaced: the stand-in names resolve
 * to a public-looking address, and the transport dials `127.0.0.1:<port>`
 * only when the checked address is that one (anything else throws, so
 * nothing ever reaches the real network).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, request as httpsRequest, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import {
  downloadImage,
  httpsTransport,
  pinnedLookup,
  type Downloaded,
  type Resolve,
} from '../library/images/download';

/** The public-looking address the stand-in names resolve to (never dialled). */
export const STANDIN_ADDRESS = '93.184.215.14';
/** Names of the stand-in host; certificates cover them. */
export const STANDIN_HOSTS = ['images.example.com', 'redirect.example.com'];
/** A public-looking name whose DNS answer is a private address. */
export const PRIVATE_NAME = 'private.example.com';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A real, decodable PNG of one colour (so a test can see it drawn). */
export function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill(rgb).flat())]);
  const raw = Buffer.concat(Array<Buffer>(height).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export interface Cert {
  key: string;
  cert: string;
}

/** A throwaway self-signed certificate for the stand-in names (needs `openssl`). */
export function makeCert(): Cert {
  const dir = mkdtempSync(join(tmpdir(), 'algotutor-cert-'));
  try {
    const san = STANDIN_HOSTS.map((h) => `DNS:${h}`).join(',');
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        `/CN=${STANDIN_HOSTS[0]}`,
        '-addext',
        `subjectAltName=${san}`,
        '-keyout',
        join(dir, 'key.pem'),
        '-out',
        join(dir, 'cert.pem'),
      ],
      { stdio: 'ignore' },
    );
    return {
      key: readFileSync(join(dir, 'key.pem'), 'utf8'),
      cert: readFileSync(join(dir, 'cert.pem'), 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface Standin {
  port: number;
  /** `host path` of every request the stand-in received. */
  requests: string[];
  close(): Promise<void>;
}

/**
 * The image host: `images.example.com/<name>.png` is a real PNG
 * (`/red.png`, `/blue.png`; others 404); `redirect.example.com/start.png`
 * redirects twice, ending at {@link PRIVATE_NAME}.
 */
export async function startStandin(cert: Cert): Promise<Standin> {
  const requests: string[] = [];
  const images: Record<string, Buffer> = {
    '/red.png': solidPng(40, 24, [220, 30, 30]),
    '/blue.png': solidPng(32, 32, [30, 60, 220]),
  };
  const server: Server = createServer(cert, (req, res) => {
    const host = (req.headers.host ?? '').toLowerCase();
    const path = req.url ?? '/';
    requests.push(`${host} ${path}`);
    if (host === 'redirect.example.com' && path === '/start.png') {
      res.writeHead(302, { location: 'https://images.example.com/hop.png' }).end();
    } else if (host === 'images.example.com' && path === '/hop.png') {
      res.writeHead(302, { location: `https://${PRIVATE_NAME}/metadata.png` }).end();
    } else if (host === 'images.example.com' && images[path]) {
      res.writeHead(200, { 'content-type': 'image/png' }).end(images[path]);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: (server.address() as AddressInfo).port,
    requests,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

/** Name resolution for tests: the stand-in names, one private answer, nothing else. */
export const standinResolve: Resolve = async (host) => {
  if (STANDIN_HOSTS.includes(host)) return [{ address: STANDIN_ADDRESS, family: 4 }];
  if (host === PRIVATE_NAME) return [{ address: '10.0.0.7', family: 4 }];
  throw new Error(`no test DNS answer for ${host}`);
};

/** The linked-image downloader, unchanged, reaching only the stand-in. */
export function standinDownload(opts: { port: number; ca: string }) {
  const transport = httpsTransport({
    port: opts.port,
    request: (o, cb) => {
      // Only the address the downloader checked and pinned is reachable here.
      const pinned = (o.lookup as unknown as ReturnType<typeof pinnedLookup>) ?? null;
      let checked = '';
      pinned?.('', {}, (_e, a) => (checked = typeof a === 'string' ? a : ''));
      if (checked !== STANDIN_ADDRESS) throw new Error(`refusing to dial ${checked}`);
      return httpsRequest(
        {
          ...o,
          protocol: 'https:',
          ca: opts.ca,
          lookup: pinnedLookup({ address: '127.0.0.1', family: 4 }) as typeof o.lookup,
        },
        cb,
      );
    },
  });
  return (url: string, signal?: AbortSignal): Promise<Downloaded> =>
    downloadImage(url, { resolve: standinResolve, transport, ...(signal ? { signal } : {}) });
}
