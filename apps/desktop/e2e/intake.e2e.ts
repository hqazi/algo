/// <reference lib="dom" />
/**
 * `npm run e2e` (last part): new problems in the real app with the fake
 * backend (`ALGOTUTOR_FAKE_TUTOR=e2e/fake-intake.json`), over the built app.
 * A fresh data folder; nothing calls an AI provider or fetches anything.
 *
 * New problem → Generate: the fake tutor's first spec fails the self-check
 * in the real execution host (Pyodide), its repair passes → the problem
 * opens, is listed as generated and its starter fails Run → Paste: text that
 * is not a problem is refused with the tutor's reason.
 *
 *   npm run e2e [-- --shots <dir>]   (Linux without a display: xvfb-run -a npm run e2e)
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type Page } from 'playwright-core';

const ROOT = join(import.meta.dirname, '..');
const shotsAt = process.argv.indexOf('--shots');
const shots = shotsAt > 0 ? process.argv[shotsAt + 1] : undefined;

const failures: string[] = [];
function check(name: string, ok: boolean, detail?: unknown): void {
  console.log(JSON.stringify({ check: name, ok, ...(detail === undefined ? {} : { detail }) }));
  if (!ok) failures.push(name);
}

async function shot(page: Page, name: string): Promise<void> {
  if (shots) await page.screenshot({ path: join(shots, `intake-${name}.png`) });
}

const dataDir = mkdtempSync(join(tmpdir(), 'algotutor-e2e-intake-'));
const app = await electron.launch({
  args: [join(ROOT, 'out/main/index.js'), ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
  env: {
    ...process.env,
    ALGOTUTOR_DATA_DIR: dataDir,
    ALGOTUTOR_FAKE_TUTOR: join(ROOT, 'e2e/fake-intake.json'),
    ANTHROPIC_API_KEY: '',
    NODE_OPTIONS: '',
  },
  colorScheme: null,
});
try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1400, height: 860 });
  await page.getByRole('button', { name: 'Use defaults and start' }).click();
  await page.getByRole('heading', { name: 'Practice' }).waitFor();

  await page.getByRole('button', { name: 'New problem' }).click();
  const dialog = page.getByRole('dialog', { name: 'New problem' });
  await dialog.getByLabel('Topic').selectOption('arrays-strings');
  await dialog.getByRole('button', { name: 'Generate' }).click();
  await page.locator('.statement-title').waitFor({ timeout: 180_000 });
  const slug = new URL(page.url()).hash.replace('#/p/', '');
  check('the generated problem opens after its self-check', slug === 'count-even-readings', slug);
  check(
    'it is saved under problems/generated',
    existsSync(join(dataDir, 'problems', 'generated', slug, 'meta.json')),
  );
  check(
    'its statement shows the examples from the visible tests',
    await page.getByText('Input:  readings = [1, 2, 3, 4]').isVisible(),
  );
  await shot(page, '1-generated');

  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const summary = page.getByTestId('summary');
  await summary.waitFor({ timeout: 120_000 });
  const first = await summary.textContent();
  check('its starter fails Run (2 visible tests)', first === '0/2 passed', first);

  await page.getByRole('button', { name: 'New problem' }).click();
  await dialog.getByRole('tab', { name: 'Paste' }).click();
  await dialog
    .getByLabel('Problem statement')
    .fill('Hello there, this is my shopping list: eggs, milk and bread.');
  await dialog.getByRole('button', { name: 'Convert' }).click();
  const alert = dialog.getByRole('alert');
  await alert.waitFor({ timeout: 60_000 });
  const text = await alert.textContent();
  check(
    'pasted text that is not a problem is refused with the reason',
    (text ?? '').includes('could not be turned into a problem: it describes no inputs or outputs.'),
    text,
  );
  check('nothing was written for it', !existsSync(join(dataDir, 'problems', 'imported')));
  await shot(page, '2-not-a-problem');
} catch (e) {
  check('ran to the end', false, String(e));
} finally {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
}
console.log(JSON.stringify({ failures }));
process.exit(failures.length ? 1 : 0);
