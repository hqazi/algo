/// <reference lib="dom" />
/**
 * `npm run e2e` (first part): the v1 flow of SPEC §13 in one run of the real
 * app with the fake tutor (`ALGOTUTOR_FAKE_TUTOR=e2e/fake-tutor.json`), over
 * the built app. A fresh data folder; nothing calls an AI provider.
 *
 * Onboarding (answer the questions) → Next problem → Run (the starter fails)
 * → Hint from the tutor → edit the solution → Run passes → Submit records it
 * → Progress shows the attempt, with the hint counted.
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
  if (shots) await page.screenshot({ path: join(shots, `v1-${name}.png`) });
}

const dataDir = mkdtempSync(join(tmpdir(), 'algotutor-e2e-v1-'));
const app = await electron.launch({
  args: [join(ROOT, 'out/main/index.js'), ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
  env: {
    ...process.env,
    ALGOTUTOR_DATA_DIR: dataDir,
    ALGOTUTOR_FAKE_TUTOR: join(ROOT, 'e2e/fake-tutor.json'),
    ANTHROPIC_API_KEY: '',
    NODE_OPTIONS: '',
  },
  colorScheme: null,
});
try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1400, height: 860 });

  // Onboarding: answer the questions.
  await page.getByLabel('Intermediate').check();
  await page.getByLabel('Let me struggle first').check();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  const practice = page.getByRole('heading', { name: 'Practice' });
  const connect = page.getByRole('heading', { name: 'Connect the tutor' });
  await practice.or(connect).waitFor();
  if (await connect.isVisible()) {
    await page
      .getByRole('button', { name: /Skip for now|Continue|Done/ })
      .first()
      .click();
    await practice.waitFor();
  }
  check('onboarding: questions answered, home shown', true);
  check('the tutor is on (fake backend)', await page.getByText('Tutor on').isVisible());

  // Next problem.
  await page.getByRole('button', { name: 'Next problem' }).first().click();
  await page.locator('.statement-title').waitFor();
  const slug = new URL(page.url()).hash.replace('#/p/', '');
  check('next problem opens the practice view', /^[a-z0-9-]+$/.test(slug), slug);

  // Run the starter.
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const summary = page.getByTestId('summary');
  await summary.waitFor({ timeout: 120_000 });
  const first = await summary.textContent();
  check('the starter fails Run', /^0\/\d+ passed$/.test(first ?? ''), first);
  await shot(page, '1-starter-run');

  // Hint.
  const thisProblem = page.getByRole('button', { name: 'This problem' });
  if (await thisProblem.isVisible()) await thisProblem.click();
  await page.getByRole('button', { name: 'Hint' }).click();
  await page.getByRole('button', { name: 'Send' }).waitFor({ timeout: 120_000 });
  const chips = await page.getByTestId('tool-chip').allTextContents();
  check(
    'Hint gives level 1',
    chips.some((c) => /1 of 4/.test(c)),
    chips,
  );
  await shot(page, '2-hint');

  // Edit: the solution file changes and the open editor follows.
  const file = join(dataDir, 'workspace', slug, 'solution.py');
  const reference = referenceOf(slug);
  writeFileSync(file, reference);
  await page.getByText(/Loaded the changes made to the solution file/).waitFor({ timeout: 10_000 });
  const shown = await page.locator('.cm-content').innerText();
  check(
    'the edit shows in the editor',
    shown.includes(reference.split('\n').find((l) => l.startsWith('def '))!),
  );

  // Run passes.
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.waitForFunction(
    () =>
      /^(\d+)\/\1 passed$/.test(
        document.querySelector('[data-testid="summary"]')?.textContent ?? '',
      ),
    null,
    { timeout: 120_000 },
  );
  check('Run passes with the edit', true, await summary.textContent());

  // Submit.
  await page.getByRole('button', { name: 'Submit' }).click();
  await page
    .getByText(/Recorded\.$/)
    .first()
    .waitFor({ timeout: 120_000 });
  check(
    'Submit records the attempt',
    (await page.getByTestId('problem-status').textContent()) === 'Solved',
  );
  await shot(page, '3-submitted');

  // Progress.
  await page.getByRole('link', { name: 'Progress' }).click();
  await page.getByRole('heading', { name: 'Recent attempts' }).waitFor();
  // The topic counts refresh after the page opens; wait for them, not the first paint.
  const counted = await page
    .waitForFunction(
      (s) => {
        const t = document.querySelector('main')?.textContent ?? '';
        const counts = [...document.querySelectorAll('[data-testid="topic-counts"]')].map(
          (e) => e.textContent ?? '',
        );
        return counts.includes('1 with help') && t.includes(s);
      },
      slug,
      { timeout: 10_000 },
    )
    .then(() => true)
    .catch(() => false);
  check(
    'progress lists the attempt as solved with help (the hint counts)',
    counted,
    await page.getByTestId('topic-counts').allTextContents(),
  );
  await shot(page, '4-progress');
} catch (e) {
  check('ran to the end', false, String(e));
} finally {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
}
console.log(JSON.stringify({ failures }));
process.exit(failures.length ? 1 : 0);
