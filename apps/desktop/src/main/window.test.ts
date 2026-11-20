import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { devCsp, isAllowedRequest, isTrustedUrl, pageUrl, serveUi, UI_CSP } from './window';

const DEV = 'http://localhost:5173';

describe('isTrustedUrl', () => {
  it('trusts only the UI page itself', () => {
    expect(isTrustedUrl('tutor-app://app/renderer/index.html', {})).toBe(true);
    expect(isTrustedUrl('tutor-app://app/renderer/index.html#x', {})).toBe(true);
    for (const url of [
      'tutor-app://app/assets/x.html',
      'tutor-app://evil/renderer/index.html',
      'tutor-exec://host/exec-host/index.html',
      'file:///renderer/index.html',
      `${DEV}/renderer/index.html`,
      'not a url',
    ]) {
      expect(isTrustedUrl(url, {}), url).toBe(false);
    }
  });

  it('trusts the dev server page in development, and only that', () => {
    expect(isTrustedUrl(`${DEV}/renderer/index.html`, { devServerUrl: DEV })).toBe(true);
    expect(isTrustedUrl('tutor-app://app/renderer/index.html', { devServerUrl: DEV })).toBe(false);
    expect(isTrustedUrl('http://localhost:5174/renderer/index.html', { devServerUrl: DEV })).toBe(
      false,
    );
    expect(pageUrl({ devServerUrl: DEV })).toBe(`${DEV}/renderer/index.html`);
  });
});

describe('isAllowedRequest', () => {
  it('allows the app protocol and DevTools only', () => {
    expect(isAllowedRequest('tutor-app://app/assets/a.js', undefined)).toBe(true);
    expect(isAllowedRequest('devtools://devtools/bundled/x', undefined)).toBe(true);
    for (const url of [
      'https://example.com/',
      'http://localhost:5173/x',
      'tutor-exec://host/pyodide/x',
      'file:///etc/passwd',
      'data:text/html,hi',
    ]) {
      expect(isAllowedRequest(url, undefined), url).toBe(false);
    }
  });

  it('adds the dev server (http and its WebSocket) in development', () => {
    expect(isAllowedRequest(`${DEV}/@vite/client`, DEV)).toBe(true);
    expect(isAllowedRequest('ws://localhost:5173/?token=x', DEV)).toBe(true);
    expect(isAllowedRequest('http://localhost:5174/', DEV)).toBe(false);
    expect(isAllowedRequest('https://example.com/', DEV)).toBe(false);
  });
});

describe('CSP', () => {
  it('blocks network, frames and inline script in the packaged UI', () => {
    expect(UI_CSP).toContain("default-src 'none'");
    expect(UI_CSP).toContain("script-src 'self';");
    expect(UI_CSP).toContain("connect-src 'none'");
    expect(UI_CSP).not.toContain('unsafe-eval');
  });

  it('loosens only what Vite needs in development', () => {
    const csp = devCsp(DEV);
    expect(csp).toContain("script-src 'self' 'unsafe-inline';");
    expect(csp).toContain("connect-src 'self' ws://localhost:5173");
    // Library images are served by the app, not the dev server.
    expect(csp).toContain("img-src 'self' data: tutor-app://app;");
    expect(csp).not.toContain('unsafe-eval');
  });
});

describe('serveUi', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'algotutor-ui-'));
    await mkdir(join(dir, 'renderer'));
    await mkdir(join(dir, 'assets'));
    await mkdir(join(dir, 'pyodide'));
    await writeFile(join(dir, 'renderer', 'index.html'), '<html></html>');
    await writeFile(join(dir, 'assets', 'a.js'), 'export {}');
    await writeFile(join(dir, 'pyodide', 'p.mjs'), 'x');
    await writeFile(join(dir, 'secret.txt'), 'x');
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  const get = (url: string, method = 'GET') => serveUi(new Request(url, { method }), dir);

  it('serves the page with CSP and a script with its type', async () => {
    const page = await get('tutor-app://app/renderer/index.html');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toBe(UI_CSP);
    expect(page.headers.get('content-type')).toMatch(/^text\/html/);
    const js = await get('tutor-app://app/assets/a.js');
    expect(js.headers.get('content-type')).toMatch(/^text\/javascript/);
  });

  it('serves nothing else', async () => {
    for (const url of [
      'tutor-app://app/secret.txt',
      'tutor-app://app/pyodide/p.mjs',
      'tutor-app://app/renderer/missing.html',
      'tutor-app://app/renderer/%2e%2e/secret.txt',
      'tutor-app://app/assets/..%2fsecret.txt',
      'tutor-app://app/renderer/%E0%A4%A',
      'tutor-app://other/renderer/index.html',
    ]) {
      expect((await get(url)).status, url).toBe(404);
    }
    expect((await get('tutor-app://app/renderer/index.html', 'POST')).status).toBe(404);
  });
});
