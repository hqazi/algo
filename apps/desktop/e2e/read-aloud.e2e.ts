/**
 * Read aloud end to end (T38, SPEC §15.6), in the built app, with the real
 * Kokoro model: Read aloud → the offer → Download (from a local copy of the
 * Hugging Face files, through the app's own checked download) → the article
 * is spoken by the engine in its utility process and played; pause; the
 * engine's device shown in Settings → Library; Remove.
 *
 *   npm run e2e:read-aloud -w apps/desktop [-- --shots <dir>]
 *
 * The model files (340 MB) are read from `ALGOTUTOR_E2E_TTS_SOURCE`
 * (default `~/.cache/algo-e2e/kokoro-v1.0`), laid out like the repo
 * (`onnx/model.onnx`, `voices/*.bin`); missing ones are downloaded there
 * first, from the pinned revision. Not part of `npm run e2e`: it needs
 * the files and takes a minute or two on a CPU. It runs on the CPU (the
 * default); then, with "Use the GPU" on, reads again and checks the engine
 * restarted on the GPU, or says no GPU could be used.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import { FILES, fileUrl } from '../src/main/tts/model';

const ROOT = join(import.meta.dirname, '..');
const shotsAt = process.argv.indexOf('--shots');
const shots = shotsAt > 0 ? process.argv[shotsAt + 1] : undefined;

const failures: string[] = [];
function check(name: string, ok: boolean, detail?: unknown): void {
  console.log(JSON.stringify({ check: name, ok, ...(detail === undefined ? {} : { detail }) }));
  if (!ok) failures.push(name);
}
async function shot(page: Page, name: string): Promise<void> {
  if (shots) await page.screenshot({ path: join(shots, `read-aloud-${name}.png`) });
}

const source =
  process.env['ALGOTUTOR_E2E_TTS_SOURCE'] ?? join(homedir(), '.cache', 'algo-e2e', 'kokoro-v1.0');
for (const f of FILES) {
  const path = join(source, ...f.path.split('/'));
  if (existsSync(path)) continue;
  console.log(`downloading ${f.path} into ${source}`);
  const res = await fetch(fileUrl(f.path));
  if (!res.ok) throw new Error(`${f.path}: ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  if (createHash('sha256').update(body).digest('hex') !== f.sha256) {
    throw new Error(`${f.path}: checksum mismatch`);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

const ARTICLE = `---
title: Binary search
---
# Binary search

Binary search finds an item in a sorted list by halving the range on every step.

\`\`\`python
mid = (lo + hi) // 2
\`\`\`

A million items take about twenty looks.
`;

const base = mkdtempSync(join(tmpdir(), 'algotutor-e2e-read-aloud-'));
const dataDir = join(base, 'data');
const vault = join(base, 'vault');
mkdirSync(vault, { recursive: true });
writeFileSync(join(vault, 'search.md'), ARTICLE);
const requests: string[] = [];

let app: ElectronApplication | null = null;
let page: Page | null = null;
try {
  app = await electron.launch({
    args: [
      join(ROOT, 'out/main/e2e-main.js'),
      ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    ],
    env: {
      ...process.env,
      ALGOTUTOR_DATA_DIR: dataDir,
      ALGOTUTOR_E2E_TTS_DIR: source,
      ANTHROPIC_API_KEY: '',
      NODE_OPTIONS: '',
    },
    colorScheme: null,
  });
  const p = await app.firstWindow();
  page = p;
  const pg = p;
  p.on('request', (r) => requests.push(r.url()));
  await pg.setViewportSize({ width: 1400, height: 860 });
  // What Web Audio plays: each buffer's length and loudness.
  const instrument = () =>
    pg.evaluate(`(() => {
      if (window.__played) return;
      window.__played = [];
      window.__suspended = 0;
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...a) {
        const d = this.buffer.getChannelData(0);
        let peak = 0;
        for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
        window.__played.push({ seconds: this.buffer.duration, peak });
        return start.apply(this, a);
      };
      const suspend = AudioContext.prototype.suspend;
      AudioContext.prototype.suspend = function () {
        window.__suspended++;
        return suspend.call(this);
      };
    })()`);
  const played = () =>
    pg.evaluate('window.__played') as Promise<{ seconds: number; peak: number }[]>;

  await pg.getByRole('button', { name: 'Use defaults and start' }).click();
  await pg.getByRole('button', { name: 'Skip for now' }).click();
  await pg.getByRole('link', { name: 'Settings', exact: true }).waitFor();
  await app.evaluate(({ dialog }, dir) => {
    (dialog as unknown as Record<string, unknown>)['showOpenDialog'] = () =>
      Promise.resolve({ canceled: false, filePaths: [dir] });
  }, vault);
  await pg.getByRole('link', { name: 'Settings', exact: true }).click();
  await pg.getByRole('button', { name: 'Add folder…' }).click();
  await pg
    .getByText(/1 article/)
    .first()
    .waitFor();
  const before = await pg.getByTestId('read-aloud-voice').textContent();
  check(
    'Settings says the voice is not downloaded',
    /Not downloaded \(324 MB\)/.test(before ?? ''),
    before,
  );

  await pg.getByRole('link', { name: 'Library', exact: true }).click();
  await pg.getByRole('link', { name: 'Binary search' }).click();
  await pg.locator('.article-body').waitFor();
  await instrument();

  // ---- the first time: the offer, then the download
  await pg.getByRole('button', { name: 'Read aloud' }).click();
  const offer = pg.getByRole('dialog');
  await offer.waitFor();
  check(
    'the first Read aloud offers the download',
    /Kokoro/.test((await offer.textContent()) ?? ''),
  );
  await shot(pg, '1-offer');
  await pg.getByRole('button', { name: 'Download (324 MB)' }).click();
  await pg
    .getByRole('progressbar', { name: 'Voice download' })
    .waitFor({ timeout: 10_000 })
    .catch(() => undefined);
  await shot(pg, '2-downloading');
  await offer.waitFor({ state: 'detached', timeout: 180_000 });
  check(
    'the model was downloaded into the cache and checked',
    existsSync(join(dataDir, 'cache', 'kokoro-v1.0', 'ready.json')),
  );

  // ---- reading: the engine starts, audio plays
  const t0 = Date.now();
  const bar = pg.getByRole('region', { name: 'Read aloud' });
  await bar.waitFor();
  await shot(pg, '3-starting');
  let first: { seconds: number; peak: number }[] = [];
  while (Date.now() - t0 < 240_000) {
    first = await played();
    if (first.length > 0) break;
    await pg.waitForTimeout(250);
  }
  check('the first chunk is spoken and played', first.length > 0, { ms: Date.now() - t0 });
  check(
    'it is real speech: over a second long, and not silent',
    (first[0]?.seconds ?? 0) > 1 && (first[0]?.peak ?? 0) > 0.05,
    first[0],
  );
  const lit = await pg.locator('.article-body .speaking').textContent();
  check('the heading is read first and highlighted', lit === 'Binary search', lit);
  await shot(pg, '4-reading');

  // Pause, resume.
  await pg.getByRole('button', { name: 'Pause' }).click();
  check('pause suspends the audio', (await pg.evaluate('window.__suspended')) === 1);
  await pg.getByRole('button', { name: 'Resume' }).click();

  // The next chunk follows (made while the first played).
  const t1 = Date.now();
  let next = first;
  while (Date.now() - t1 < 60_000) {
    next = await played();
    if (next.length > 1) break;
    await pg.waitForTimeout(250);
  }
  const lit2 = await pg.locator('.article-body .speaking').textContent();
  check('the paragraph follows', next.length > 1 && /^Binary search finds/.test(lit2 ?? ''), {
    chunks: next,
    lit: lit2,
  });
  await pg.getByRole('button', { name: 'Stop reading aloud', pressed: true }).click();
  check('stop hides the bar', (await bar.count()) === 0);

  // ---- Settings: where it runs; Remove
  await pg.getByRole('link', { name: 'Settings', exact: true }).click();
  const after = (await pg.getByTestId('read-aloud-voice').textContent()) ?? '';
  check(
    'Settings says it is downloaded and where it runs',
    /Kokoro is downloaded \(324 MB\)\. Runs on the CPU, [\d.]+× faster than real time/.test(after),
    after,
  );
  const gpuBox = pg.getByRole('checkbox', { name: 'Use the GPU' });
  check('"Use the GPU" is off by default', !(await gpuBox.isChecked()));
  await shot(pg, '5-settings');
  // Controlled by the saved settings: it ticks once main has saved them.
  await gpuBox.click();
  await pg.getByRole('checkbox', { name: 'Use the GPU', checked: true }).waitFor();
  const saved = JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8'));
  check('"Use the GPU" is saved', saved?.library?.readAloudGpu === true, saved?.library);

  // ---- with the GPU on: the next read starts the engine again there
  await pg.getByRole('link', { name: 'Library', exact: true }).click();
  await pg.getByRole('link', { name: 'Binary search' }).click();
  await pg.locator('.article-body').waitFor();
  await instrument();
  const heard = (await played()).length;
  await pg.getByRole('button', { name: 'Read aloud' }).click();
  const t2 = Date.now();
  let again: unknown[] = [];
  while (Date.now() - t2 < 240_000) {
    // The first chunk may come from the reader's cache; the second is made
    // by the engine started again for the new setting.
    again = (await played()).slice(heard);
    if (again.length > 1) break;
    await pg.waitForTimeout(250);
  }
  check('with the GPU on, it still speaks', again.length > 1, { ms: Date.now() - t2 });
  await pg.getByRole('button', { name: 'Stop reading aloud', pressed: true }).click();
  await pg.getByRole('link', { name: 'Settings', exact: true }).click();
  await pg.getByText(/Runs on the GPU|No GPU could be used/).waitFor({ timeout: 10_000 });
  const gpuText = (await pg.getByTestId('read-aloud-voice').textContent()) ?? '';
  check(
    'the engine restarted for the GPU (or says why not)',
    /Runs on the GPU \(\w+\)|No GPU could be used, so it runs on the CPU/.test(gpuText),
    gpuText,
  );
  await pg.getByTestId('read-aloud-voice').getByRole('button', { name: 'Remove' }).click();
  await pg.getByText(/Not downloaded \(324 MB\)/).waitFor();
  check('Remove deletes the model', !existsSync(join(dataDir, 'cache', 'kokoro-v1.0')));

  const offsite = requests.filter(
    (u) => !u.startsWith('tutor-app://') && !u.startsWith('devtools://'),
  );
  check('the page itself made no network request', offsite.length === 0, offsite);
} catch (e) {
  console.error(e);
  if (page) await shot(page, 'failed').catch(() => undefined);
  failures.push(`threw: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  await app?.close().catch(() => undefined);
  rmSync(base, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`FAILED: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('read-aloud e2e: all checks passed');
