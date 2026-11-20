/// <reference lib="dom" />
/**
 * `npm run e2e` (second part): the tutor in the real app with the fake
 * backend (`ALGOTUTOR_FAKE_TUTOR=e2e/fake-tutor.json`), over the built app.
 * A fresh data folder; nothing calls an AI provider.
 *
 * Home chat "What next?" → the tutor opens a problem → Hint twice (the level
 * climbs) → Review runs the tests and the results panel shows them →
 * Explain opens the page in the sandboxed iframe → a long reply is stopped →
 * the conversation survives a reload → New chat archives it.
 *
 *   npm run e2e [-- --shots <dir>]   (Linux without a display: xvfb-run -a npm run e2e)
 */
import { mkdtempSync, rmSync } from 'node:fs';
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
  if (shots) await page.screenshot({ path: join(shots, `tutor-${name}.png`) });
}

/** Waits until the pane is ready to send again (the reply has ended). */
async function idle(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Send' }).waitFor({ timeout: 120_000 });
}

const dataDir = mkdtempSync(join(tmpdir(), 'algotutor-e2e-tutor-'));
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
  await page.getByRole('button', { name: 'Use defaults and start' }).click();
  await page.getByRole('heading', { name: 'Practice' }).waitFor();
  check('the top bar says the tutor is on', await page.getByText('Tutor on').isVisible());

  await page.getByRole('button', { name: 'What next?' }).click();
  await page.locator('.statement-title').waitFor({ timeout: 30_000 });
  const slug = new URL(page.url()).hash.replace('#/p/', '');
  check('the tutor opened a problem', /^[a-z0-9-]+$/.test(slug), slug);
  await idle(page);
  const chips = page.getByTestId('tool-chip');
  const states = await chips.evaluateAll((els) => els.map((e) => e.getAttribute('data-state')));
  check(
    'the reply shows its tool chips',
    states.length === 3 && states.every((s) => s === 'ok'),
    await chips.allTextContents(),
  );
  check(
    'the problem pane keeps the thread the tutor opened it from',
    (await page.getByRole('button', { name: 'General', pressed: true }).count()) === 1,
  );
  await shot(page, '1-what-next');

  await page.getByRole('button', { name: 'This problem' }).click();
  await page.getByRole('button', { name: 'Hint' }).click();
  await idle(page);
  await page.getByRole('button', { name: 'Hint' }).click();
  await idle(page);
  const hints = await page.getByTestId('tool-chip').allTextContents();
  check(
    'Hint climbs one level per press',
    hints.some((c) => /1 of 4/.test(c)) && hints.some((c) => /2 of 4/.test(c)),
    hints,
  );
  check(
    'the reply is rendered Markdown',
    (await page.locator('.msg-assistant strong', { hasText: 'already seen' }).count()) === 2,
  );

  await page.getByRole('button', { name: 'Review' }).click();
  await idle(page);
  const summary = await page.getByTestId('summary').textContent({ timeout: 60_000 });
  check(
    'Review runs the tests; the results panel shows them',
    /^0\/\d+ passed$/.test(summary ?? ''),
    summary,
  );
  await shot(page, '2-review');

  await page.getByRole('button', { name: 'Explain' }).click();
  const frame = page.getByTestId('explanation-frame');
  await frame.waitFor({ timeout: 30_000 });
  check(
    'Explain opens the page in a sandboxed iframe',
    (await frame.getAttribute('sandbox')) === '',
  );
  const heading = await page
    .frameLocator('[data-testid="explanation-frame"]')
    .locator('h1')
    .textContent();
  const title = await page.locator('.statement-title').textContent();
  check('the explanation page renders inside the frame', heading === title, { heading, title });
  const styled = await page
    .frameLocator('[data-testid="explanation-frame"]')
    .locator('.badge')
    .first()
    .evaluate((el) => getComputedStyle(el).borderRadius);
  check('the page’s own styles apply in the frame', styled !== '0px', styled);
  await shot(page, '3-explanation');
  await page.getByRole('button', { name: 'Close' }).click();
  await idle(page);
  check(
    'the explanation is listed under the statement',
    await page.getByRole('heading', { name: 'Explanations' }).isVisible(),
  );

  await page.getByLabel('Message the tutor').fill('take your time');
  await page.getByLabel('Message the tutor').press('Enter');
  await page.getByText('Thinking', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Stop' }).click();
  await idle(page);
  check('Stop ends the reply', await page.getByText('Stopped.').isVisible());

  await page.reload();
  await page.getByTestId('chat-log').waitFor();
  await page.getByRole('button', { name: 'Hint' }).waitFor();
  const kept = await page.getByTestId('msg-user').count();
  check('the conversation is stored (survives a reload)', kept === 5, kept);
  check('the stopped reply is stored as stopped', await page.getByText('Stopped.').isVisible());

  page.on('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'New chat' }).click();
  await page.getByText(/Ask about this problem/).waitFor();
  check('New chat starts afresh', (await page.getByTestId('msg-user').count()) === 0);
} catch (e) {
  check('ran to the end', false, String(e));
} finally {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
}
console.log(JSON.stringify({ failures }));
process.exit(failures.length ? 1 : 0);
