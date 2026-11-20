/// <reference lib="dom" />
/**
 * `npm run e2e` (T09 acceptance in the real app): onboarding's "Connect the
 * tutor" stores a key in the OS keychain (Electron safeStorage), Settings
 * changes apply at once, and export → reset progress → import round-trips
 * progress, settings and workspace files across a restart.
 *
 * No AI provider is called: `ANTHROPIC_BASE_URL` points the SDK at a local
 * stand-in that answers only `GET /v1/models/<id>` (the connection test).
 * Native dialogs are replaced in the main process with Playwright's
 * `app.evaluate`.
 *
 * The key check: after storing a known fake key and exercising the app,
 * the key appears in no file under the data folder, nor under Electron's
 * `userData` folder (Chromium's own storage, which is elsewhere when
 * `ALGOTUTOR_DATA_DIR` is set), not in the export, not in the app's
 * stdout/stderr, and not in the page.
 *
 *   npm run e2e   (Linux without a display: xvfb-run -a npm run e2e)
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';

const ROOT = join(import.meta.dirname, '..');
const CONTENT = join(ROOT, '../../content/problems');
/** Made up, in the API's shape. */
const FAKE_KEY = 'sk-ant-api03-E2E-fake-key-do-not-use-0123456789-QxZ7';

const failures: string[] = [];
function check(name: string, ok: boolean, detail?: unknown): void {
  console.log(JSON.stringify({ check: name, ok, ...(detail === undefined ? {} : { detail }) }));
  if (!ok) failures.push(name);
}

function referenceOf(slug: string): string {
  for (const topic of readdirSync(CONTENT))
    for (const s of readdirSync(join(CONTENT, topic)))
      if (s === slug) return readFileSync(join(CONTENT, topic, s, 'reference.py'), 'utf8');
  throw new Error(`no reference for ${slug}`);
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    const st = statSync(p, { throwIfNoEntry: false });
    if (!st) return [];
    return st.isDirectory() ? filesUnder(p) : st.isFile() ? [p] : [];
  });
}

// ---- the stand-in API: GET /v1/models/<id> only
const seen: { path: string; key: string | undefined }[] = [];
const server = createServer((req: IncomingMessage, res) => {
  // SDK 1.5 sends the key as a bearer token; older ones as x-api-key.
  const key =
    (req.headers['x-api-key'] as string | undefined) ??
    req.headers.authorization?.replace(/^Bearer /, '');
  seen.push({ path: req.url ?? '', key });
  const m = /^\/v1\/models\/([\w.-]+)$/.exec(req.url ?? '');
  if (req.method === 'GET' && m && key === FAKE_KEY) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        type: 'model',
        id: m[1],
        display_name: m[1],
        created_at: '2026-01-01T00:00:00Z',
      }),
    );
    return;
  }
  res.writeHead(401, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'no' } }),
  );
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const dataDir = mkdtempSync(join(tmpdir(), 'algotutor-e2e-settings-'));
const exportPath = join(mkdtempSync(join(tmpdir(), 'algotutor-e2e-export-')), 'export.zip');
let output = '';

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && k !== 'ANTHROPIC_API_KEY') env[k] = v;
  const app = await electron.launch({
    args: [join(ROOT, 'out/main/index.js'), ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
    env: { ...env, ALGOTUTOR_DATA_DIR: dataDir, ANTHROPIC_BASE_URL: baseUrl, NODE_OPTIONS: '' },
    colorScheme: null,
  });
  app.process().stdout?.on('data', (d: Buffer) => (output += d.toString()));
  app.process().stderr?.on('data', (d: Buffer) => (output += d.toString()));
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1400, height: 900 });
  return { app, page };
}

async function stubDialogs(app: ElectronApplication, opts: { open?: string; save?: string }) {
  await app.evaluate(({ app: a, dialog }, o) => {
    const d = dialog as unknown as Record<string, unknown>;
    d.showMessageBox = () => Promise.resolve({ response: 1, checkboxChecked: false });
    if (o.save) d.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: o.save });
    if (o.open) d.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [o.open] });
    // Playwright cannot follow a relaunch; the test starts the app again itself.
    (a as unknown as { relaunch: () => void }).relaunch = () => {};
  }, opts);
}

async function settings(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Settings' }).waitFor();
}

let slug = '';
let solution = '';
let first = await launch();
try {
  const { app, page } = first;

  // ---- onboarding: defaults, then connect the tutor with a key
  await page.getByRole('button', { name: 'Use defaults and start' }).click();
  await page.getByRole('heading', { name: 'Connect the tutor' }).waitFor();
  await page.getByLabel('Anthropic API key').fill(FAKE_KEY);
  await page.getByRole('button', { name: 'Save and test' }).click();
  await page.getByRole('heading', { name: 'Practice' }).waitFor({ timeout: 20_000 });
  check('connect the tutor: key saved, tested, home', true);
  check(
    'the connection test reached the stand-in API with the key',
    seen.some((r) => r.path === '/v1/models/claude-opus-5-5' && r.key === FAKE_KEY),
    seen.map((r) => r.path),
  );
  await page.getByText('Tutor on').waitFor();
  check('the top bar says the tutor is on', true);

  // ---- Settings: the key shows only its end; model and effort apply at once
  await settings(page);
  const keyStatus = await page.getByTestId('key-status').textContent();
  check(
    'Settings shows the key as stored, by its last four',
    keyStatus?.includes('Stored, ends in …QxZ7') ?? false,
    keyStatus,
  );
  if (process.platform === 'linux') {
    // Recorded, not required: depends on whether the machine has a keyring.
    const weak = await page.getByTestId('weak-storage').isVisible();
    console.log(JSON.stringify({ note: 'linux weak storage warning shown', weak }));
  }
  await page.getByRole('textbox', { name: 'Model' }).fill('claude-sonnet-5-5');
  await page.getByRole('button', { name: 'Save model' }).click();
  await page.getByRole('combobox', { name: 'Effort' }).selectOption('high');
  await page
    .getByTestId('tutor-status-line')
    .getByText(/claude-sonnet-5-5/)
    .waitFor();
  check('the new model shows in the tutor status at once', true);
  await page.getByRole('button', { name: 'Test connection' }).click();
  await page
    .getByTestId('test-result')
    .getByText(/claude-sonnet-5-5/)
    .waitFor();
  check(
    'the next request uses the new model (no restart)',
    seen.at(-1)?.path === '/v1/models/claude-sonnet-5-5',
    seen.at(-1),
  );
  await page.getByRole('spinbutton', { name: 'Editor font size' }).fill('18');
  await page.getByRole('combobox', { name: 'Editor keys' }).selectOption('vim');

  // ---- Code execution (T18): real detection; whatever is found here, only
  // running runtimes are selectable, a missing one links to the README.
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { opened: string[] };
    g.opened = [];
    shell.openExternal = (url: string) => {
      g.opened.push(url);
      return Promise.resolve();
    };
  });
  const rustGo = page.getByTestId('rust-go');
  await rustGo.getByRole('radio', { name: /Local toolchains/ }).waitFor();
  for (const runtime of ['podman', 'docker']) {
    const row = page.getByTestId(`runtime-${runtime}`);
    const state = (await page.getByTestId(`runtime-state-${runtime}`).textContent()) ?? '';
    const running = state.startsWith('(Running');
    const radio = row.getByRole('radio');
    check(
      `${runtime}: shown with its state, selectable only when running`,
      /^\((Running|Installed, not running|Not found)/.test(state) &&
        (await radio.isDisabled()) === !running,
      state,
    );
    if (state === '(Not found)') {
      await row.getByRole('button', { name: 'How to install →' }).click();
      const opened = await app.evaluate(
        () => (globalThis as unknown as { opened: string[] }).opened,
      );
      check(
        `${runtime}: How to install opens the README section`,
        opened.at(-1) === 'https://github.com/hqazi/algorithm-tutor#optional-a-container-sandbox',
        opened,
      );
    }
    if (running) {
      // The choice is saved in main first (it detects again), then the radio follows.
      await radio.click();
      await row.locator('input[type=radio]:checked').waitFor({ timeout: 30_000 });
      check(`${runtime}: choosing a running runtime saves it`, await radio.isChecked());
      check(
        `${runtime}: pull and test sandbox are offered`,
        (await row.getByRole('button', { name: /^(Pull|Update) image/ }).count()) === 1 &&
          (await row.getByRole('button', { name: /^Test sandbox/ }).count()) === 1,
      );
      await rustGo.getByRole('radio', { name: /Local toolchains/ }).click();
      await page
        .getByTestId('runtime-local')
        .locator('input[type=radio]:checked')
        .waitFor({ timeout: 30_000 });
    }
  }
  await page.getByRole('button', { name: 'Recheck runtimes' }).click();
  await page.getByRole('button', { name: 'Recheck runtimes' }).waitFor();
  check(
    'Recheck detects again and local stays chosen',
    await rustGo.getByRole('radio', { name: /Local toolchains/ }).isChecked(),
  );

  // ---- a solve to round-trip
  await page.getByRole('button', { name: 'Next problem' }).first().click();
  await page.locator('.statement-title').waitFor();
  slug = new URL(page.url()).hash.replace('#/p/', '');
  check(
    'the editor uses the new keymap and font size',
    (await page.locator('.editor').getAttribute('data-keymap')) === 'vim' &&
      (await page.locator('.cm-editor').evaluate((e) => getComputedStyle(e).fontSize)) === '18px',
  );
  solution = `${referenceOf(slug)}\n# e2e marker\n`;
  writeFileSync(join(dataDir, 'workspace', slug, 'solution.py'), solution);
  await page.getByText(/Loaded the changes made to the solution file/).waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Submit' }).click();
  await page
    .getByText(/Recorded\.$/)
    .first()
    .waitFor({ timeout: 120_000 });
  check(
    'a solve is recorded',
    (await page.getByTestId('problem-status').textContent()) === 'Solved',
  );
  check('the page never holds the key', !(await page.content()).includes(FAKE_KEY));

  // ---- export, reset progress, import (restart)
  await stubDialogs(app, { save: exportPath, open: exportPath });
  await settings(page);
  await page.getByRole('button', { name: 'Export…' }).click();
  await page.getByText(/^Exported to /).waitFor({ timeout: 30_000 });
  const entries = Object.keys(unzipSync(readFileSync(exportPath)));
  check(
    'the export holds the database, settings and the solution',
    ['tutor.db', 'settings.json', `workspace/${slug}/solution.py`].every((e) =>
      entries.includes(e),
    ),
    entries,
  );
  check('the export has no secrets', !entries.some((e) => e.includes('secrets')));

  await page.getByRole('button', { name: 'Reset progress…' }).click();
  await page.getByText(/^Progress reset\./).waitFor({ timeout: 30_000 });
  await page.getByRole('link', { name: 'Progress' }).click();
  await page.getByRole('heading', { name: 'Recent attempts' }).waitFor();
  check(
    'reset progress clears the solve',
    !(await page.locator('main').innerText()).includes(slug),
  );

  await settings(page);
  const closed = new Promise<void>((r) => app.once('close', () => r()));
  await page.getByRole('button', { name: 'Import…' }).click();
  await closed;
  check('import stages the data and the app quits to restart', true);
} catch (e) {
  check('first run ran to the end', false, String(e));
  console.log(
    await first.page
      .locator('body')
      .innerText()
      .catch(() => ''),
  );
  console.log(output.slice(-3000), JSON.stringify(seen));
  await first.app.close().catch(() => undefined);
}

try {
  first = await launch();
  const { app, page } = first;
  await page.getByRole('heading', { name: 'Practice' }).waitFor({ timeout: 20_000 });
  await page.getByRole('link', { name: 'Progress' }).click();
  await page.getByRole('heading', { name: 'Recent attempts' }).waitFor();
  // The lists refresh after the page opens; wait for them, not the first paint.
  check(
    'after import, progress shows the solve again',
    await page
      .waitForFunction((s) => document.querySelector('main')?.textContent?.includes(s), slug, {
        timeout: 10_000,
      })
      .then(() => true)
      .catch(() => false),
  );
  check(
    'after import, the solution file is back',
    readFileSync(join(dataDir, 'workspace', slug, 'solution.py'), 'utf8') === solution,
  );
  const saved = JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8')) as {
    tutor?: { model?: string; effort?: string };
    editor?: { fontSize?: number; keymap?: string };
  };
  check(
    'after import, the settings are back',
    saved.tutor?.model === 'claude-sonnet-5-5' &&
      saved.tutor.effort === 'high' &&
      saved.editor?.keymap === 'vim',
    saved,
  );
  await settings(page);
  check(
    'the stored key survives the import',
    (await page.getByTestId('key-status').textContent())?.includes('…QxZ7') ?? false,
  );
  check(
    'a backup was made before the import',
    readdirSync(join(dataDir, 'backups')).some((f) => f.endsWith('-before-import.zip')),
  );
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
  await app.close();

  // ---- the key is nowhere
  const needles = [FAKE_KEY, FAKE_KEY.slice(12, -4)];
  const hits: string[] = [];
  const files = [...filesUnder(dataDir), ...filesUnder(userData)];
  for (const f of files) {
    const text = readFileSync(f).toString('latin1');
    if (needles.some((n) => text.includes(n))) hits.push(f);
  }
  for (const [name, data] of Object.entries(unzipSync(readFileSync(exportPath))))
    if (needles.some((n) => Buffer.from(data).toString('latin1').includes(n)))
      hits.push(`export:${name}`);
  if (needles.some((n) => output.includes(n))) hits.push('stdout/stderr');
  check(
    `the key is in none of ${files.length} files (data folder and userData), the export or the output`,
    hits.length === 0 && files.some((f) => f.endsWith('secrets.bin')),
    hits,
  );
} catch (e) {
  check('second run ran to the end', false, String(e));
  await first.app.close().catch(() => undefined);
} finally {
  server.close();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(exportPath, { force: true });
}
console.log(JSON.stringify({ failures }));
process.exit(failures.length ? 1 : 0);
