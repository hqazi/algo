/**
 * An older packaged build updates itself to a newer one (T13 acceptance),
 * on Linux with AppImages, from a local HTTP feed instead of GitHub:
 *
 *   tsx packaging/package.ts --target AppImage --version 0.0.1 --feed http://127.0.0.1:47613/
 *   (keep the AppImage, then the same with --version 0.0.2; keep it and latest-linux.yml)
 *   xvfb-run -a tsx packaging/update-check.ts <old.AppImage> <folder with the new AppImage and latest-linux.yml>
 *
 * Starts the old build with a DevTools port, presses "Check now" and
 * "Restart to update" through the same IPC the Settings page uses, and checks
 * that the AppImage on disk was replaced by the new one and the relaunched
 * app reports the new version. Runs with APPIMAGE_EXTRACT_AND_RUN=1 (no FUSE
 * needed). The GitHub provider itself is not exercised here.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createReadStream,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';

const FEED_PORT = 47613;
const MARKER = `ALGOTUTOR_UPDATE_CHECK=${process.pid}`;

const sha512 = (file: string): string =>
  createHash('sha512').update(readFileSync(file)).digest('base64');

function serve(dir: string): Promise<() => void> {
  const server = createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? '/').split('?')[0]!.slice(1));
    console.log(`feed GET ${req.url} ${req.headers.range ?? ''}`);
    const file = join(dir, basename(name));
    if (!name || !readdirSync(dir).includes(basename(name))) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Length': statSync(file).size });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) =>
    server.listen(FEED_PORT, '127.0.0.1', () => resolve(() => server.close())),
  );
}

function start(exe: string, port: number, data: string): ChildProcess {
  const [k, v] = MARKER.split('=') as [string, string];
  return spawn(exe, [`--remote-debugging-port=${port}`, '--no-sandbox'], {
    env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: '1', ALGOTUTOR_DATA_DIR: data, [k]: v },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

async function connect(port: number): Promise<{ browser: Browser; page: Page }> {
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      for (;;) {
        const page = browser
          .contexts()
          .flatMap((c) => c.pages())
          .find((p) => p.url().startsWith('tutor-app:'));
        if (page) return { browser, page };
        if (Date.now() > deadline) throw new Error('the main window never opened');
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch (e) {
      if (Date.now() > deadline) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

async function call(page: Page, channel: string): Promise<Record<string, unknown>> {
  const r = (await page.evaluate(
    (c) =>
      (
        window as unknown as { tutor: { invoke(c: string, r: unknown): Promise<unknown> } }
      ).tutor.invoke(c, undefined),
    channel,
  )) as { ok: boolean; value?: Record<string, unknown>; error?: { message: string } };
  if (!r.ok) throw new Error(`${channel}: ${r.error?.message}`);
  return r.value!;
}

/** Every process started by this check (the relaunched app is not our child). */
function killMarked(): void {
  for (const pid of readdirSync('/proc').filter((p) => /^\d+$/.test(p))) {
    try {
      if (readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').includes(MARKER)) {
        process.kill(Number(pid), 'SIGKILL');
      }
    } catch {
      // gone, or not ours
    }
  }
}

async function main(oldImage: string, feedDir: string): Promise<void> {
  const newImage = readdirSync(feedDir).find((f) => f.endsWith('.AppImage'));
  if (!newImage) throw new Error(`no AppImage in ${feedDir}`);
  const work = mkdtempSync(join(tmpdir(), 'algotutor-update-'));
  // No version in the name: electron-updater replaces the file in place.
  const installed = join(work, 'algorithm-tutor.AppImage');
  copyFileSync(oldImage, installed);
  const stop = await serve(feedDir);
  try {
    start(installed, 9333, join(work, 'data'));
    const { browser, page } = await connect(9333);
    const before = (await call(page, 'app:version'))['app'];
    console.log(`ok   old build running: ${String(before)}`);
    // Automatic updates are on by default; the background check waits 30 s,
    // so press "Check now".
    await call(page, 'updates:check');
    const deadline = Date.now() + 180_000;
    let state: Record<string, unknown> = {};
    while (Date.now() < deadline) {
      state = await call(page, 'updates:status');
      if (state['state'] === 'downloaded' || state['state'] === 'error') break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (state['state'] !== 'downloaded')
      throw new Error(`not downloaded: ${JSON.stringify(state)}`);
    console.log(`ok   downloaded ${String(state['version'])}`);
    const restart = await call(page, 'updates:restart').catch(() => ({ restarting: true }));
    if (!restart['restarting']) throw new Error('restart refused');
    await browser.close().catch(() => undefined);
    // Wait for the file to be replaced.
    const want = sha512(join(feedDir, newImage));
    const until = Date.now() + 60_000;
    while (Date.now() < until) {
      try {
        if (sha512(installed) === want) break;
      } catch {
        // between unlink and move
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (sha512(installed) !== want) throw new Error('the AppImage on disk was not replaced');
    console.log('ok   the AppImage on disk is the new build');
    // Let the relaunched app come up, then stop it and start the new file ourselves.
    await new Promise((r) => setTimeout(r, 5000));
    killMarked();
    await new Promise((r) => setTimeout(r, 1000));
    start(installed, 9334, join(work, 'data'));
    const second = await connect(9334);
    const after = (await call(second.page, 'app:version'))['app'];
    await second.browser.close().catch(() => undefined);
    if (after === before) throw new Error(`still ${String(after)} after the update`);
    console.log(`ok   updated: ${String(before)} -> ${String(after)}`);
  } finally {
    killMarked();
    stop();
    await new Promise((r) => setTimeout(r, 1000));
    rmSync(work, { recursive: true, force: true });
  }
}

const [oldImage, feedDir] = process.argv.slice(2);
if (!oldImage || !feedDir) {
  console.error('usage: tsx packaging/update-check.ts <old.AppImage> <feed folder>');
  process.exit(2);
}
main(oldImage, feedDir).then(
  () => process.exit(0),
  (e: unknown) => {
    console.error(`FAIL ${e instanceof Error ? e.message : String(e)}`);
    killMarked();
    process.exit(1);
  },
);
