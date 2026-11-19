/**
 * Launch a packaged app and check it works (T13): it starts with its fuses
 * flipped, loads the curated problems from `<resources>/content`, runs Python
 * in Pyodide out of `app.asar`, and Settings → Updates shows the updater.
 *
 *   tsx packaging/smoke.ts <path to the packaged executable>
 *
 * Playwright's Electron launcher needs `--inspect`, which the fuses turn
 * off, so the app is started with a DevTools port and driven over CDP.
 * Linux needs a display (`xvfb-run -a`). Uses a temporary data folder.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      s.close(() => (typeof a === 'object' && a ? resolve(a.port) : reject(new Error('no port'))));
    });
  });
}

async function connect(port: number): Promise<Page> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      for (;;) {
        const page = browser
          .contexts()
          .flatMap((c) => c.pages())
          .find((p) => p.url().startsWith('tutor-app:'));
        if (page) return page;
        if (Date.now() > deadline) throw new Error('the main window never opened');
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch (e) {
      if (Date.now() > deadline) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

type Result = { ok: true; value: unknown } | { ok: false; error: { message: string } };

async function call(page: Page, channel: string, request?: unknown): Promise<unknown> {
  const r = (await page.evaluate(
    ([c, req]) =>
      (
        window as unknown as { tutor: { invoke(c: string, r: unknown): Promise<unknown> } }
      ).tutor.invoke(c as string, req),
    [channel, request] as const,
  )) as Result;
  if (!r.ok) throw new Error(`${channel}: ${r.error.message}`);
  return r.value;
}

async function main(exe: string): Promise<void> {
  const data = mkdtempSync(join(tmpdir(), 'algotutor-smoke-'));
  const port = await freePort();
  const root = process.platform !== 'win32' && process.getuid?.() === 0;
  const child = spawn(exe, [`--remote-debugging-port=${port}`, ...(root ? ['--no-sandbox'] : [])], {
    env: { ...process.env, ALGOTUTOR_DATA_DIR: data },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  try {
    const page = await connect(port);
    const version = (await call(page, 'app:version')) as { app: string; electron: string };
    console.log(`ok   started: app ${version.app}, Electron ${version.electron}`);

    const { problems } = (await call(page, 'problems:list', {})) as {
      problems: { slug: string }[];
    };
    if (problems.length === 0) throw new Error('no curated problems loaded');
    console.log(`ok   ${problems.length} curated problems from <resources>/content`);

    await call(page, 'profile:defaults');
    const slug = problems[0]!.slug;
    await call(page, 'problems:start', { slug });
    const report = (await call(page, 'runs:run', { slug })) as {
      total: number;
      run_error?: { kind: string; message: string };
    };
    if (report.total === 0 || (report.run_error && report.run_error.kind !== 'solution')) {
      throw new Error(`Python did not run: ${JSON.stringify(report).slice(0, 500)}`);
    }
    console.log(`ok   ran ${slug}'s starter code in Pyodide (${report.total} visible tests)`);

    const state = (await call(page, 'updates:status')) as { state: string };
    if (state.state === 'unsupported') throw new Error(`no updater: ${JSON.stringify(state)}`);
    console.log(`ok   updater present (${state.state})`);
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 1000));
    rmSync(data, { recursive: true, force: true });
  }
}

const exe = process.argv[2];
if (!exe) {
  console.error('usage: tsx packaging/smoke.ts <packaged executable>');
  process.exit(2);
}
main(exe).then(
  () => process.exit(0),
  (e: unknown) => {
    console.error(`FAIL ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
