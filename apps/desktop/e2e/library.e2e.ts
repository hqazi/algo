/// <reference lib="dom" />
/**
 * `npm run e2e` (last part): the Library (T26, SPEC §15) in the built app,
 * started from `out/main/e2e-main.js` (the app with linked images fetched
 * from a local HTTPS stand-in for a public image host instead of the
 * internet) and the fake tutor (`e2e/fake-tutor-library.json`). Nothing
 * calls an AI provider or the network.
 *
 * Add a folder (Settings → Library) → read an article: the vault image and
 * the linked image are drawn, the linked one downloaded once → select a
 * passage, **Ask about this**, the provider notice, a reply (its image is
 * not rendered) → a second thread on another passage → two margin markers
 * beside their passages → restart with the image host gone: the linked
 * image shows from the cache, both threads and markers are back, a thread
 * reopens with its conversation. Every request the page made is
 * `tutor-app://`.
 *
 *   npm run e2e [-- --shots <dir>]   (Linux without a display: xvfb-run -a npm run e2e)
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import { makeCert, solidPng, startStandin } from '../src/main/testing/standin';

const ROOT = join(import.meta.dirname, '..');
const shotsAt = process.argv.indexOf('--shots');
const shots = shotsAt > 0 ? process.argv[shotsAt + 1] : undefined;

const failures: string[] = [];
function check(name: string, ok: boolean, detail?: unknown): void {
  console.log(JSON.stringify({ check: name, ok, ...(detail === undefined ? {} : { detail }) }));
  if (!ok) failures.push(name);
}

async function shot(page: Page, name: string): Promise<void> {
  if (shots) await page.screenshot({ path: join(shots, `library-${name}.png`) });
}

const FIRST = 'A binary heap keeps the smallest item at the root';
const SECOND = 'Removing the root moves the last item to the top';
const ARTICLE = `---
title: Heaps by hand
tags: [heaps]
---
# Heaps

${FIRST}, so reading it is one step.

![[local.png]]

## Adding

Adding an item puts it at the end and lets it rise past larger parents.

![a linked picture](https://images.example.com/blue.png)

## Removing

${SECOND} and lets it sink until both children are larger.
`;

const base = mkdtempSync(join(tmpdir(), 'algotutor-e2e-library-'));
const dataDir = join(base, 'data');
const vault = join(base, 'vault');
mkdirSync(vault, { recursive: true });
writeFileSync(join(vault, 'heaps.md'), ARTICLE);
writeFileSync(join(vault, 'local.png'), solidPng(64, 20, [20, 160, 60]));
const cert = makeCert();
const caFile = join(base, 'ca.pem');
writeFileSync(caFile, cert.cert);
const standin = await startStandin(cert);
const standinRequests = standin.requests;
let standinUp = true;

/** Files the app sent to the trash (a folder here stands in for the OS trash). */
const trashed: string[] = [];
const trashDir = join(base, 'trash');
mkdirSync(trashDir);

/** Every request a page made, as Chromium saw it. */
const requests: string[] = [];

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [
      join(ROOT, 'out/main/e2e-main.js'),
      ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    ],
    env: {
      ...process.env,
      ALGOTUTOR_DATA_DIR: dataDir,
      ALGOTUTOR_FAKE_TUTOR: join(ROOT, 'e2e/fake-tutor-library.json'),
      ALGOTUTOR_E2E_IMAGE_PORT: String(standin.port),
      ALGOTUTOR_E2E_IMAGE_CA: caFile,
      ANTHROPIC_API_KEY: '',
      NODE_OPTIONS: '',
    },
    colorScheme: null,
  });
  // The OS trash may not exist on a CI machine: the app's `shell.trashItem`
  // moves into a folder instead, and says what it moved.
  await app.evaluate(({ shell }, dir) => {
    const s = shell as unknown as Record<string, unknown>;
    s['trashItem'] = async (p: string) => {
      const fs = process.getBuiltinModule('node:fs');
      const path = process.getBuiltinModule('node:path');
      fs.renameSync(p, path.join(dir, path.basename(p)));
      console.log(`TRASHED ${p}`);
    };
  }, trashDir);
  app.process().stdout?.on('data', (b: Buffer) => {
    for (const m of b.toString().matchAll(/TRASHED (.+)/g)) trashed.push(m[1]!);
  });
  const page = await app.firstWindow();
  page.on('request', (r) => requests.push(r.url()));
  await page.setViewportSize({ width: 1500, height: 900 });
  return { app, page };
}

/** Images in the reader: source, drawn width. */
const readerImages = (page: Page) =>
  page.locator('.article-body img').evaluateAll((els) =>
    (els as HTMLImageElement[]).map((i) => ({
      src: i.getAttribute('src') ?? '',
      width: i.complete ? i.naturalWidth : 0,
    })),
  );

async function waitDrawn(page: Page, widths: number[]): Promise<boolean> {
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    const drawn = (await readerImages(page)).map((i) => i.width);
    if (widths.every((w) => drawn.includes(w))) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

async function openArticle(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await page.getByRole('link', { name: 'Heaps by hand' }).click();
  await page.locator('article.reader[aria-label="Heaps by hand"] .article-body').waitFor();
}

/** Selects `text` inside the reader's body, as a mouse drag would, and lets the reader see it. */
async function select(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => {
    const body = document.querySelector('.article-body')!;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const at = n.textContent!.indexOf(t);
      if (at < 0) continue;
      const r = document.createRange();
      r.setStart(n, at);
      r.setEnd(n, at + t.length);
      const sel = getSelection()!;
      sel.removeAllRanges();
      sel.addRange(r);
      body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return;
    }
    throw new Error(`text not found: ${t}`);
  }, text);
}

async function ask(page: Page, passage: string, message: string): Promise<void> {
  await select(page, passage);
  await page.getByRole('button', { name: 'Ask about this' }).click();
  const quote = await page.getByTestId('passage-quote').textContent();
  check(
    `the chat pane shows the chosen passage (${passage.slice(0, 20)}…)`,
    !!quote?.includes(passage),
    quote,
  );
  await page.getByLabel('Message the tutor').fill(message);
  await page.getByLabel('Message the tutor').press('Enter');
}

/** Where each marker sits next to where its passage sits (top, px, in the page). */
const positions = (page: Page) =>
  page.evaluate(
    (texts) => {
      // No named inner functions: the page cannot see the bundler's helpers.
      const [first, second] = texts.map((t) => {
        const p = [...document.querySelectorAll('.article-body p')].find((e) =>
          e.textContent?.includes(t),
        );
        return p ? p.getBoundingClientRect().top : null;
      });
      return {
        markers: [...document.querySelectorAll('[data-testid="passage-marker"]')].map((m) => ({
          label: m.getAttribute('aria-label'),
          top: m.getBoundingClientRect().top,
        })),
        first: first ?? null,
        second: second ?? null,
      };
    },
    [FIRST, SECOND],
  );

function markersBeside(p: Awaited<ReturnType<typeof positions>>): boolean {
  if (p.markers.length !== 2 || p.first === null || p.second === null) return false;
  const [m1, m2] = [...p.markers].sort((x, y) => x.top - y.top);
  // Each marker within a line or so of its passage's first line, in order.
  return Math.abs(m1!.top - p.first) < 30 && Math.abs(m2!.top - p.second) < 30 && m1!.top < m2!.top;
}

let app: ElectronApplication | null = null;
try {
  let page: Page;
  ({ app, page } = await launch());
  await page.getByRole('button', { name: 'Use defaults and start' }).click();
  await page.getByRole('heading', { name: 'Practice' }).waitFor();

  // ---- add the folder (the OS picker answers with the vault)
  await app.evaluate(({ dialog }, dir) => {
    (dialog as unknown as Record<string, unknown>)['showOpenDialog'] = () =>
      Promise.resolve({ canceled: false, filePaths: [dir] });
  }, vault);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Add folder…' }).click();
  await page
    .getByText(/1 article/)
    .first()
    .waitFor();
  check('the folder is added in Settings → Library', true);

  // ---- read: the vault image and the linked image are drawn
  await openArticle(page);
  const drawn = await waitDrawn(page, [64, 32]);
  const imgs = await readerImages(page);
  check(
    'the vault image and the linked image are drawn, from asset URLs',
    drawn &&
      imgs.length === 2 &&
      imgs.every((i) => i.src.startsWith('tutor-app://app/library-asset/')),
    imgs,
  );
  check(
    'the linked image was downloaded once, by the main process',
    standinRequests.filter((r) => r === 'images.example.com /blue.png').length === 1,
    standinRequests,
  );
  await shot(page, '1-read');

  // ---- ask about a passage
  await ask(page, FIRST, 'Explain the first passage');
  const notice = page.getByTestId('provider-notice');
  await notice.waitFor();
  check('the provider notice comes before the first message', await notice.isVisible());
  await notice.getByRole('button', { name: 'Send' }).click();
  const chat = page.getByTestId('article-chats');
  await chat.getByTestId('msg-assistant').getByText('smallest').waitFor({ timeout: 30_000 });
  const chips = await chat
    .getByTestId('tool-chip')
    .evaluateAll((els) => els.map((e) => `${e.getAttribute('data-state')}: ${e.textContent}`));
  check('the reply used an article tool', chips.length === 1 && chips[0]!.startsWith('ok:'), chips);
  check(
    'chat never renders images (the reply’s image is not shown or requested)',
    (await chat.locator('img').count()) === 0 && !requests.some((u) => u.includes('exfil')),
  );
  await reopenReady(page);

  // ---- a second thread on another passage
  await ask(page, SECOND, 'And the second passage?');
  await chat.getByTestId('msg-assistant').getByText('log n').waitFor({ timeout: 30_000 });
  check('the notice is shown only once', (await page.getByTestId('provider-notice').count()) === 0);
  const p1 = await positions(page);
  check('two markers, each beside its passage', markersBeside(p1), p1);
  await shot(page, '2-two-threads');

  // ---- restart with the image host gone
  await app.close();
  app = null;
  await standin.close();
  standinUp = false;
  const before = standinRequests.length;
  ({ app, page } = await launch());
  await page.getByRole('heading', { name: 'Practice' }).waitFor();
  await openArticle(page);
  check(
    'offline: both images are drawn again (the linked one from the cache)',
    (await waitDrawn(page, [64, 32])) && standinRequests.length === before,
    await readerImages(page),
  );
  await page.locator('.thread-item').nth(1).waitFor();
  const titles = await page.locator('.thread-item .thread-title').allTextContents();
  check(
    'both threads are listed after a restart',
    titles.length === 2 &&
      titles.some((t) => /first passage/.test(t)) &&
      titles.some((t) => /second passage/.test(t)),
    titles,
  );
  const p2 = await positions(page);
  check('the markers are back beside their passages', markersBeside(p2), p2);
  await page.getByRole('button', { name: /Open chat: Explain the first passage/ }).click();
  await page.getByTestId('msg-assistant').getByText('smallest').waitFor();
  check(
    'a marker reopens its thread with the conversation',
    (await page.getByTestId('passage-quote').textContent())?.includes(FIRST) === true,
  );
  await shot(page, '3-reopened');

  // ---- T42: new folder, drag the article into it, delete it to the trash
  const tree = page.getByRole('list', { name: 'Library folders' });
  await tree.getByRole('button', { name: 'vault', exact: true }).hover();
  await page.getByRole('button', { name: 'Actions for vault' }).click();
  await page.getByRole('menuitem', { name: 'New folder' }).click();
  await page.getByRole('dialog', { name: 'New folder' }).getByLabel('Name').fill('Read');
  await page.getByRole('button', { name: 'Create' }).click();
  const read = tree.getByRole('button', { name: 'Read', exact: true });
  await read.waitFor();
  check('a new, empty folder shows in the tree', existsSync(join(vault, 'Read')));
  await tree.getByRole('link', { name: 'Heaps by hand' }).dragTo(read);
  const moved = join(vault, 'Read', 'heaps.md');
  for (let i = 0; i < 50 && !existsSync(moved); i++) await page.waitForTimeout(100);
  check(
    'dragging the article onto the folder moves its file',
    existsSync(moved) && !existsSync(join(vault, 'heaps.md')),
  );
  await page.getByRole('link', { name: 'Heaps by hand' }).click();
  await page.locator('.thread-item').nth(1).waitFor();
  check('its chats moved with it', (await page.locator('.thread-item').count()) === 2);
  await shot(page, '4-moved');
  await tree.getByRole('link', { name: 'Heaps by hand' }).hover();
  await page.getByRole('button', { name: 'Actions for Heaps by hand' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Move to trash' }).click();
  await tree.getByText('(file missing)').waitFor();
  check(
    'Delete sends the file to the trash; with chats it stays as file missing',
    !existsSync(moved) && trashed.length === 1 && trashed[0]!.endsWith('heaps.md'),
    trashed,
  );

  const others = requests.filter((u) => !u.startsWith('tutor-app://'));
  check(
    'every request the page made was tutor-app://',
    requests.length > 0 && others.length === 0,
    others,
  );
} catch (e) {
  check('ran to the end', false, String(e));
} finally {
  await app?.close();
  if (standinUp) await standin.close();
  rmSync(base, { recursive: true, force: true });
}

/** After a reply: the pane is ready to send again. */
async function reopenReady(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Send' }).last().waitFor({ timeout: 60_000 });
}

console.log(JSON.stringify({ failures }));
process.exit(failures.length ? 1 : 0);
