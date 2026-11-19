/**
 * The open-set fetcher (ported cases of `dsa-tutor/tests/test_open_sets.py`):
 * allowlist, same-host redirects only, size cap, errors, on-disk cache. A
 * stand-in `fetch` serves the responses; nothing touches the network.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FetchError } from '@algorithm-tutor/core';
import { Fetcher, type FetchFn } from './fetch';

const HOST = 'raw.githubusercontent.com';
const URL1 = `https://${HOST}/exercism/problem-specifications/abc/exercises/x/instructions.md`;

let dir: string;
let calls: { url: string; redirect: string }[];
let routes: Map<string, () => Response>;

const serve: FetchFn = (url, init) => {
  calls.push({ url, redirect: init.redirect });
  const r = routes.get(url);
  return Promise.resolve(r ? r() : new Response('missing', { status: 404 }));
};

const fetcher = (over: Partial<ConstructorParameters<typeof Fetcher>[0]> = {}) =>
  new Fetcher({ allowedHosts: [HOST], cacheDir: dir, fetch: serve, ...over });

const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof FetchError ? e.code : String(e);
  }
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'algotutor-fetch-'));
  calls = [];
  routes = new Map();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('Fetcher', () => {
  it('fetches, caches on disk and serves the cache afterwards', async () => {
    routes.set(URL1, () => new Response('# Hello'));
    const f = fetcher();
    expect(await f.getText(URL1)).toBe('# Hello');
    expect(f.cachePath(URL1).startsWith(join(dir, HOST))).toBe(true);
    routes.clear();
    expect(await fetcher().getText(URL1)).toBe('# Hello');
    expect(calls).toEqual([{ url: URL1, redirect: 'manual' }]);
  });

  it('fetches only plain https URLs on the allowlist', async () => {
    const f = fetcher();
    for (const url of [
      `http://${HOST}/x`,
      `https://user:pw@${HOST}/x`,
      `https://${HOST}:8443/x`,
      'https://example.com/x',
      'file:///etc/passwd',
      'not a url',
    ])
      expect(await code(f.getText(url))).toBe('not_allowed');
    expect(calls).toEqual([]);
  });

  it('follows a few same-host redirects and refuses any other host', async () => {
    const hop = (to: string) => () =>
      new Response(null, { status: 302, headers: { location: to } });
    routes.set(URL1, hop('/moved'));
    routes.set(`https://${HOST}/moved`, () => new Response('moved here'));
    expect(await fetcher().getText(URL1)).toBe('moved here');

    routes.set(URL1, hop('https://evil.example/x'));
    rmSync(dir, { recursive: true, force: true });
    expect(await code(fetcher().getText(URL1))).toBe('redirect_refused');
    // Even to another allowlisted host.
    routes.set(URL1, hop('https://objects.githubusercontent.com/x'));
    const two = fetcher({ allowedHosts: [HOST, 'objects.githubusercontent.com'] });
    expect(await code(two.getText(URL1))).toBe('redirect_refused');

    routes.set(URL1, hop(URL1));
    expect(await code(fetcher().getText(URL1))).toBe('too_many_redirects');
    routes.set(URL1, () => new Response(null, { status: 301 }));
    expect(await code(fetcher().getText(URL1))).toBe('http');
  });

  it('caps the size and reports HTTP errors', async () => {
    routes.set(URL1, () => new Response('x'.repeat(20)));
    expect(await code(fetcher({ maxBytes: 10 }).getText(URL1))).toBe('too_large');
    routes.set(URL1, () => new Response('small', { headers: { 'content-length': '999999999' } }));
    expect(await code(fetcher({ maxBytes: 10 }).getText(URL1))).toBe('too_large');
    routes.set(URL1, () => new Response('', { status: 500 }));
    expect(await code(fetcher().getText(URL1))).toBe('http');
    routes.delete(URL1);
    expect(await code(fetcher().getText(URL1))).toBe('not_found');
  });

  it('turns network failures and time-outs into fetch errors', async () => {
    const down = fetcher({ fetch: () => Promise.reject(new TypeError('fetch failed')) });
    expect(await code(down.getText(URL1))).toBe('network');
    const slow = fetcher({
      timeoutMs: 20,
      fetch: (_u, init) =>
        new Promise((_r, reject) =>
          init.signal.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    });
    expect(await code(slow.getText(URL1))).toBe('timeout');
  });
});
