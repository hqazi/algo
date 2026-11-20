/// <reference lib="dom" />
/**
 * `npm run e2e`: the practice flow in the real app (T08 acceptance), driven
 * with Playwright for Electron over the built app (`npm run build` first,
 * which the script does). A fresh data folder each run; no tutor.
 *
 * Welcome → answer the questions → skip the tutor step → Next problem → the starter fails Run → the file
 * is edited in "another editor" and the open editor follows → Run passes →
 * Submit records the attempt → Progress shows the solve. Also: the theme
 * setting in Settings drives prefers-color-scheme at once.
 *
 *   npm run e2e [-- --shots <dir>]   (Linux without a display: xvfb-run -a npm run e2e)
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type Page } from 'playwright-core';

const ROOT = join(import.meta.dirname, '..');
const CONTENT = join(ROOT, '../../content/problems');
const shotsAt = process.argv.indexOf('--shots');
const shots = shotsAt > 0 ? process.argv[shotsAt + 1] : undefined;

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

async function shot(page: Page, name: string): Promise<void> {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) });
}

const dataDir = mkdtempSync(join(tmpdir(), 'algotutor-e2e-'));
const app = await electron.launch({
  args: [join(ROOT, 'out/main/index.js'), ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
  env: { ...process.env, ALGOTUTOR_DATA_DIR: dataDir, NODE_OPTIONS: '' },
  // Playwright emulates a colour scheme by default; the app's theme setting must win.
  colorScheme: null,
});
try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1400, height: 860 });

  // One question per step (T33): goal, experience, comfort, hints, focus.
  const next = () => page.getByRole('button', { name: 'Continue', exact: true }).click();
  await next();
  await page.getByLabel('Intermediate').check();
  await next();
  await next();
  await page.getByLabel('Let me struggle first').check();
  await next();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByRole('heading', { name: 'Connect the tutor' }).waitFor();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('heading', { name: 'Practice' }).waitFor();
  check('welcome → questions → skip the tutor → home', true);

  await page.getByRole('button', { name: 'Next problem' }).first().click();
  await page.locator('.statement-title').waitFor();
  const slug = new URL(page.url()).hash.replace('#/p/', '');
  check('next problem opens the practice view', /^[a-z0-9-]+$/.test(slug), slug);
  check('tutor pane says not set up', await page.getByTestId('ai-unavailable').isVisible());

  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const summary = page.getByTestId('summary');
  await summary.waitFor({ timeout: 120_000 });
  const first = await summary.textContent();
  check('the starter fails Run with visible results', /^0\/\d+ passed$/.test(first ?? ''), first);
  check(
    'Run shows only visible tests',
    (await page.locator('.case').count()) > 0 &&
      (await page.getByText(/^Hidden test:/).count()) === 0,
  );
  await shot(page, '1-starter-run');

  // "Another editor" writes the solution file.
  const file = join(dataDir, 'workspace', slug, 'solution.py');
  const reference = referenceOf(slug);
  writeFileSync(file, reference);
  await page.getByText(/Loaded the changes made to the solution file/).waitFor({ timeout: 10_000 });
  const shown = await page.locator('.cm-content').innerText();
  check(
    'an edit in another editor updates the open editor',
    shown.includes(reference.split('\n').find((l) => l.startsWith('def '))!),
  );

  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() =>
    /^(\d+)\/\1 passed$/.test(document.querySelector('[data-testid="summary"]')?.textContent ?? ''),
  );
  check('Ctrl+Enter runs; the reference passes', true, await summary.textContent());

  await page.getByRole('button', { name: 'Submit' }).click();
  await page
    .getByText(/Recorded\.$/)
    .first()
    .waitFor({ timeout: 120_000 });
  check(
    'Submit records the attempt',
    (await page.getByTestId('problem-status').textContent()) === 'Solved',
    await summary.textContent(),
  );
  check(
    'hidden tests appear by category after Submit',
    (await page.getByText(/^Hidden test:/).count()) > 0,
  );
  check('the file on disk is the solution', readFileSync(file, 'utf8') === reference);
  await shot(page, '2-submitted');

  await page.getByRole('link', { name: 'Progress' }).click();
  await page.getByRole('heading', { name: 'Recent attempts' }).waitFor();
  // The topic counts refresh after the page opens; wait for them, not the first paint.
  const solved = await page
    .waitForFunction(
      (s) => {
        const counts = [...document.querySelectorAll('[data-testid="topic-counts"]')].map(
          (e) => e.textContent ?? '',
        );
        return (
          counts.some((c) => c.startsWith('1 unaided')) &&
          !!document.querySelector(`main a[href="#/p/${s}"]`)
        );
      },
      slug,
      { timeout: 10_000 },
    )
    .then(() => true)
    .catch(() => false);
  check(
    'progress shows the solve',
    solved,
    await page.getByTestId('topic-counts').allTextContents(),
  );
  await shot(page, '3-progress');

  await page.getByRole('link', { name: 'Settings' }).click();
  check('Settings shows the saved answers', await page.getByLabel('Intermediate').isChecked());
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('dark');
  await page.waitForFunction(() => matchMedia('(prefers-color-scheme: dark)').matches, null, {
    timeout: 5_000,
  });
  await page.getByRole('link', { name: 'Progress' }).click();
  // Progress lists problems by title; find the link by where it goes.
  await page.locator(`main a[href="#/p/${slug}"]`).first().click();
  await page.locator('.cm-editor').waitFor();
  check(
    'dark theme',
    await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches),
  );
  await shot(page, '4-dark');
  const settings = JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8')) as {
    ui?: { theme?: string };
  };
  check('theme saved in settings.json', settings.ui?.theme === 'dark');
} catch (e) {
  check('ran to the end', false, String(e));
} finally {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
}
console.log(JSON.stringify({ failures }));
process.exit(failures.length ? 1 : 0);
