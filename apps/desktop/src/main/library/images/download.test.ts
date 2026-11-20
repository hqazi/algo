/**
 * Linked-image downloads (T23, SPEC §15.4): addresses, URL checks,
 * redirects, caps, magic bytes and dimensions, and that the connection goes
 * to the address that was checked. An injected resolver and transport stand
 * in for DNS and the network; the one real-socket test uses a local server.
 */
import { createServer, request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { isBlockedAddress, isLocalName } from './address';
import {
  downloadImage,
  httpsTransport,
  pinnedLookup,
  type Address,
  type Transport,
  type TransportRequest,
} from './download';
import { gif, jpeg, png, webp } from './fixtures';
import { imageInfo } from './header';

const PUBLIC: Address = { address: '93.184.216.34', family: 4 };

describe('addresses', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.255.0.9', 'loopback'],
    ['10.1.2.3', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['192.168.1.1', 'private'],
    ['169.254.169.254', 'link-local (cloud metadata)'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['100.127.255.254', 'carrier-grade NAT'],
    ['224.0.0.251', 'multicast'],
    ['239.255.255.250', 'multicast'],
    ['0.0.0.0', 'unspecified'],
    ['255.255.255.255', 'broadcast'],
    ['::1', 'IPv6 loopback'],
    ['::', 'IPv6 unspecified'],
    ['fe80::1', 'IPv6 link-local'],
    ['fe80::1%eth0', 'IPv6 with a zone'],
    ['fc00::1', 'IPv6 unique local'],
    ['fd12:3456::1', 'IPv6 unique local'],
    ['ff02::1', 'IPv6 multicast'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:7f00:1', 'IPv4-mapped loopback (hex)'],
    ['::ffff:10.0.0.1', 'IPv4-mapped private'],
    ['::127.0.0.1', 'IPv4-compatible loopback'],
    ['64:ff9b::a00:1', 'NAT64 of 10.0.0.1'],
    ['2002:c0a8:101::1', '6to4 of 192.168.1.1'],
    ['2001::1', 'Teredo'],
    ['not an address', 'not an address'],
  ])('%s is refused (%s)', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([
    '93.184.216.34',
    '8.8.8.8',
    '172.32.0.1',
    '100.128.0.1',
    '2606:4700::1111',
    '::ffff:8.8.8.8',
  ])('%s is public', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });

  it('local names are refused before any lookup', () => {
    for (const h of [
      'localhost',
      'LOCALHOST.',
      'a.localhost',
      'printer.local',
      'nas',
      'x.internal',
    ])
      expect(isLocalName(h)).toBe(true);
    expect(isLocalName('cdn.example.com')).toBe(false);
    expect(isLocalName('93.184.216.34')).toBe(false);
  });
});

describe('header', () => {
  it('reads type and dimensions without decoding', () => {
    expect(imageInfo(png(640, 480))).toEqual({ type: 'image/png', width: 640, height: 480 });
    expect(imageInfo(gif(3, 4))).toEqual({ type: 'image/gif', width: 3, height: 4 });
    expect(imageInfo(jpeg(800, 600))).toEqual({ type: 'image/jpeg', width: 800, height: 600 });
    for (const k of ['VP8 ', 'VP8L', 'VP8X'] as const)
      expect(imageInfo(webp(k, 300, 200))).toEqual({ type: 'image/webp', width: 300, height: 200 });
  });

  it('refuses what is not a readable image header', () => {
    expect(imageInfo(new TextEncoder().encode('<html><body>hi</body></html>'))).toBeNull();
    expect(imageInfo(png(0, 10))).toBeNull();
    expect(imageInfo(png(10, 10).slice(0, 20))).toBeNull();
    expect(imageInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull();
  });
});

// ---- the downloader with a fake resolver and transport

interface Route {
  status?: number;
  headers?: Record<string, string>;
  body?: AsyncIterable<Uint8Array> | Uint8Array;
}

let dns: Map<string, Address[] | (() => Address[])>;
let routes: Map<string, Route>;
let sent: TransportRequest[];
let lookups: string[];

async function* once(b: Uint8Array): AsyncIterable<Uint8Array> {
  yield b;
}

const transport: Transport = async (r) => {
  sent.push(r);
  const route = routes.get(r.url.href);
  if (!route) return { status: 404, headers: {}, body: once(new Uint8Array()), close: () => {} };
  const body = route.body ?? new Uint8Array();
  return {
    status: route.status ?? 200,
    headers: route.headers ?? {},
    body: body instanceof Uint8Array ? once(body) : body,
    close: () => {},
  };
};

const resolve = async (host: string): Promise<Address[]> => {
  lookups.push(host);
  const a = dns.get(host);
  if (!a) throw new Error('ENOTFOUND');
  return typeof a === 'function' ? a() : a;
};

const get = (url: string, over: Parameters<typeof downloadImage>[1] = {}) =>
  downloadImage(url, { resolve, transport, ...over });

const refused = async (url: string, over: Parameters<typeof downloadImage>[1] = {}) => {
  const d = await get(url, over);
  return d.ok ? 'ok' : d.reason;
};

describe('downloadImage', () => {
  function reset() {
    dns = new Map([['cdn.example.com', [PUBLIC]]]);
    routes = new Map([['https://cdn.example.com/a.png', { body: png(10, 10) }]]);
    sent = [];
    lookups = [];
  }

  it('downloads a public https image with plain headers', async () => {
    reset();
    const d = await get('https://cdn.example.com/a.png');
    expect(d).toMatchObject({ ok: true, info: { type: 'image/png', width: 10, height: 10 } });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers).toEqual({
      'user-agent': 'Mozilla/5.0',
      accept: 'image/*',
      'accept-encoding': 'identity',
    });
    for (const h of ['cookie', 'referer', 'authorization'])
      expect(Object.keys(sent[0]!.headers)).not.toContain(h);
  });

  it('refuses insecure links, other ports, user info and other schemes without a request', async () => {
    reset();
    expect(await refused('http://cdn.example.com/a.png')).toBe('insecure');
    expect(await refused('https://cdn.example.com:8443/a.png')).toBe('port');
    expect(await refused('https://user:pw@cdn.example.com/a.png')).toBe('scheme');
    expect(await refused('ftp://cdn.example.com/a.png')).toBe('scheme');
    expect(sent).toHaveLength(0);
  });

  it.each([
    'https://127.0.0.1/a.png',
    'https://2130706433/a.png',
    'https://[::1]/a.png',
    'https://[::ffff:10.0.0.1]/a.png',
    'https://169.254.169.254/latest/meta-data',
    'https://localhost/a.png',
    'https://printer.local/a.png',
  ])('refuses %s as a local address without a request', async (url) => {
    reset();
    expect(await refused(url)).toBe('local_address');
    expect(sent).toHaveLength(0);
  });

  it.each([
    [[{ address: '127.0.0.1', family: 4 }]],
    [[{ address: '10.0.0.7', family: 4 }]],
    [[PUBLIC, { address: '192.168.0.2', family: 4 }]],
    [[{ address: 'fd00::1', family: 6 }]],
  ] as Address[][][])('refuses a public name that resolves to %j', async (answer) => {
    reset();
    dns.set('evil.example.com', answer);
    routes.set('https://evil.example.com/a.png', { body: png(1, 1) });
    expect(await refused('https://evil.example.com/a.png')).toBe('local_address');
    expect(sent).toHaveLength(0);
  });

  it('connects to the checked address even if DNS answers differently later', async () => {
    reset();
    let n = 0;
    dns.set('flip.example.com', () =>
      n++ === 0 ? [PUBLIC] : [{ address: '127.0.0.1', family: 4 }],
    );
    routes.set('https://flip.example.com/a.png', { body: png(2, 2) });
    const d = await get('https://flip.example.com/a.png');
    expect(d.ok).toBe(true);
    // One lookup, checked, and the request carries that answer to connect to.
    expect(lookups).toEqual(['flip.example.com']);
    expect(sent[0]!.address).toEqual(PUBLIC);
    // The pinned lookup ignores the name and answers the checked address only.
    const answers: unknown[] = [];
    const lookup = pinnedLookup(PUBLIC);
    lookup('flip.example.com', {}, (_e, a, f) => answers.push([a, f]));
    lookup('flip.example.com', { all: true }, (_e, a) => answers.push(a));
    expect(answers).toEqual([['93.184.216.34', 4], [PUBLIC]]);
  });

  it('follows redirects by hand, checking each target', async () => {
    reset();
    routes.set('https://cdn.example.com/r1', {
      status: 302,
      headers: { location: '/a.png' },
    });
    expect((await get('https://cdn.example.com/r1')).ok).toBe(true);
    expect(sent.map((s) => s.url.href)).toEqual([
      'https://cdn.example.com/r1',
      'https://cdn.example.com/a.png',
    ]);
  });

  it('refuses a redirect to a private address, to http, and more than 3 redirects', async () => {
    reset();
    dns.set('inside.example.com', [{ address: '10.0.0.5', family: 4 }]);
    routes.set('https://cdn.example.com/to-private', {
      status: 301,
      headers: { location: 'https://inside.example.com/a.png' },
    });
    routes.set('https://cdn.example.com/to-ip', {
      status: 307,
      headers: { location: 'https://192.168.1.1/a.png' },
    });
    routes.set('https://cdn.example.com/to-http', {
      status: 302,
      headers: { location: 'http://cdn.example.com/a.png' },
    });
    for (let i = 0; i < 5; i++)
      routes.set(`https://cdn.example.com/loop${i}`, {
        status: 302,
        headers: { location: `/loop${i + 1}` },
      });
    expect(await refused('https://cdn.example.com/to-private')).toBe('local_address');
    expect(await refused('https://cdn.example.com/to-ip')).toBe('local_address');
    expect(await refused('https://cdn.example.com/to-http')).toBe('insecure');
    expect(await refused('https://cdn.example.com/loop0')).toBe('redirects');
    expect(sent.some((s) => s.url.hostname !== 'cdn.example.com')).toBe(false);
  });

  it('refuses an oversized body, with and without Content-Length', async () => {
    reset();
    routes.set('https://cdn.example.com/big-declared', {
      headers: { 'content-length': String(11 * 1024 * 1024) },
      body: png(1, 1),
    });
    async function* stream() {
      for (let i = 0; i < 12; i++) yield new Uint8Array(1024 * 1024);
    }
    routes.set('https://cdn.example.com/big-streamed', { body: stream() });
    expect(await refused('https://cdn.example.com/big-declared')).toBe('oversize');
    expect(await refused('https://cdn.example.com/big-streamed')).toBe('oversize');
  });

  it('gives up on a slow body', async () => {
    reset();
    const slow: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]: () => {
        let first = true;
        return {
          next: () =>
            first
              ? ((first = false), Promise.resolve({ done: false, value: png(1, 1) }))
              : new Promise<IteratorResult<Uint8Array>>(() => {}),
        };
      },
    };
    routes.set('https://cdn.example.com/slow', { body: slow });
    expect(await refused('https://cdn.example.com/slow', { timeoutMs: 50 })).toBe('timeout');
  });

  it('refuses HTML served as image/png, and a 50,000 × 50,000 PNG', async () => {
    reset();
    routes.set('https://cdn.example.com/html.png', {
      headers: { 'content-type': 'image/png' },
      body: new TextEncoder().encode('<!doctype html><script>alert(1)</script>'),
    });
    routes.set('https://cdn.example.com/huge.png', { body: png(50_000, 50_000) });
    expect(await refused('https://cdn.example.com/html.png')).toBe('not_image');
    expect(await refused('https://cdn.example.com/huge.png')).toBe('pixels');
  });

  it('reports errors from the site and names that do not resolve', async () => {
    reset();
    routes.set('https://cdn.example.com/500', { status: 500 });
    expect(await refused('https://cdn.example.com/500')).toBe('http');
    expect(await refused('https://cdn.example.com/missing')).toBe('http');
    expect(await refused('https://nowhere.example.com/a.png')).toBe('network');
  });
});

// ---- the real transport, on a local server

describe('httpsTransport', () => {
  let close: (() => void) | null = null;
  afterEach(() => close?.());

  it('connects to the given address, whatever the name resolves to', async () => {
    const seen: IncomingHttpHeaders[] = [];
    const server = createServer((req, res) => {
      seen.push(req.headers);
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(Buffer.from(png(5, 6)));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    close = () => server.close();
    const port = (server.address() as AddressInfo).port;
    // `.invalid` never resolves: only the pinned address can be reached.
    const t = httpsTransport({ request: httpRequest, port });
    const res = await t({
      url: new URL('https://images.invalid/a.png?x=1'),
      address: { address: '127.0.0.1', family: 4 },
      headers: { accept: 'image/*' },
      signal: AbortSignal.timeout(5000),
    });
    const chunks: Uint8Array[] = [];
    for await (const c of res.body) chunks.push(c);
    res.close();
    expect(res.status).toBe(200);
    expect(imageInfo(new Uint8Array(Buffer.concat(chunks)))).toMatchObject({ width: 5, height: 6 });
    expect(seen[0]).toMatchObject({ host: 'images.invalid', accept: 'image/*' });
    expect(seen[0]!.cookie).toBeUndefined();
    expect(seen[0]!.referer).toBeUndefined();
  });
});
