/// <reference lib="dom" />
/**
 * `npm run screenshots`: the README and docs screenshots
 * (`docs/assets/screenshots/`), taken from the built app with a scripted
 * tutor (`e2e/fake-tutor-screens.json`), a fresh data folder and a small
 * Library vault written here. Nothing calls an AI provider or the network.
 *
 *   npm run screenshots [-- --out <dir>]   (Linux without a display: xvfb-run -a npm run screenshots)
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';

const ROOT = join(import.meta.dirname, '..');
const outAt = process.argv.indexOf('--out');
const out =
  outAt > 0 ? process.argv[outAt + 1]! : join(ROOT, '..', '..', 'docs', 'assets', 'screenshots');
mkdirSync(out, { recursive: true });

const SLUG = 'longest-distinct';
/** A first attempt that passes the examples and fails a hidden case ("dvdf"). */
const ATTEMPT = `def longest_distinct(s):
    seen = set()
    best = 0
    for ch in s:
        if ch in seen:
            # a repeat: start a new window
            seen = set()
        seen.add(ch)
        best = max(best, len(seen))
    return best
`;

const PASSAGE = 'every window that still contains the earlier copy is invalid';
const ARTICLES: Record<string, string> = {
  'Patterns/Sliding windows.md': `---
title: Sliding windows
source: https://example.com/notes/sliding-windows
author: Study notes
published: 2026-03-02
tags: [sliding-window, patterns]
---
A sliding window is a range \`[start, end]\` over an array or string that
moves from left to right. Instead of recomputing an answer for every range,
you update it as one item enters on the right and another leaves on the left.

> [!tip]
> If a brute force checks every substring or subarray, ask whether the
> answer for one range tells you most of the answer for the next.

## Growing the window

Move \`end\` one step at a time and add the new item to whatever the window
tracks: a running sum, a count per character, or the last index of each
character.

## Shrinking the window

When the new item breaks the rule, ${PASSAGE}, so \`start\` moves past it.
With a map from each character to its last index, \`start\` can jump there
in one step instead of creeping forward.

\`\`\`python
for end, ch in enumerate(s):
    if ch in last and last[ch] >= start:
        start = last[ch] + 1
    last[ch] = end
\`\`\`

## Fixed or variable size

Fixed-size windows (the best total of any \`k\` days) move both ends
together. Variable-size windows (the longest stretch without repeats) grow
until the rule breaks, then shrink until it holds again.
`,
  'Patterns/Two pointers.md': `---
title: Two pointers
tags: [two-pointers, patterns]
---
# Two pointers

Two indexes walk the same array, from both ends or at different speeds.
`,
  'Graphs/Breadth-first search.md': `---
title: Breadth-first search
tags: [graphs]
---
# Breadth-first search

Visit nodes in rings of increasing distance from the start.
`,
  'Graphs/Topological order.md': `---
title: Topological order
tags: [graphs]
---
# Topological order

Order tasks so that each comes after everything it depends on.
`,
};

const base = mkdtempSync(join(tmpdir(), 'algotutor-screens-'));
const dataDir = join(base, 'data');
const vault = join(base, 'Study vault');
for (const [path, text] of Object.entries(ARTICLES)) {
  mkdirSync(join(vault, path, '..'), { recursive: true });
  writeFileSync(join(vault, path), text);
}

async function launch(
  colorScheme: 'light' | 'dark',
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(ROOT, 'out/main/index.js'), ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
    env: {
      ...process.env,
      ALGOTUTOR_DATA_DIR: dataDir,
      ALGOTUTOR_FAKE_TUTOR: join(ROOT, 'e2e/fake-tutor-screens.json'),
      ANTHROPIC_API_KEY: '',
      NODE_OPTIONS: '',
    },
    colorScheme,
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 880 });
  return { app, page };
}

async function shot(page: Page, name: string): Promise<void> {
  // Toasts are notices for the moment, not part of the picture.
  await page.addStyleTag({ content: '.toasts { display: none !important; }' });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log(`wrote ${name}.png`);
}

async function idle(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Send' }).waitFor({ timeout: 120_000 });
}

async function openProblem(page: Page): Promise<void> {
  await page.evaluate((slug) => (location.hash = `#/p/${slug}`), SLUG);
  await page.locator('.statement-title').waitFor({ timeout: 30_000 });
}

let app: ElectronApplication | undefined;
try {
  let page: Page;
  ({ app, page } = await launch('light'));
  await page.getByRole('button', { name: 'Use defaults and start' }).click();
  await page.getByRole('heading', { name: 'Practice' }).waitFor();

  // ---- practice: a first attempt, Submit fails a hidden case, then a hint
  await openProblem(page);
  // Write once the editor follows the file (it says "Saved").
  await page.getByText('Saved', { exact: true }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
  writeFileSync(join(dataDir, 'workspace', SLUG, 'solution.py'), ATTEMPT);
  await page.getByText(/Loaded the changes made to the solution file/).waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.getByTestId('summary').waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: 'This problem' }).click();
  await page.getByRole('button', { name: 'Hint' }).click();
  await idle(page);
  await shot(page, 'practice');

  // ---- an explanation page
  await page.getByRole('button', { name: 'Explain' }).click();
  await page.getByTestId('explanation-frame').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
  await shot(page, 'explanation');
  await page.getByRole('button', { name: 'Close' }).click();
  await idle(page);

  // ---- progress
  await page.getByRole('link', { name: 'Progress', exact: true }).click();
  await page.getByRole('heading', { name: 'Progress' }).waitFor();
  await shot(page, 'progress');

  // ---- the Library: add the vault, read an article, ask about a passage
  await app.evaluate(({ dialog }, dir) => {
    (dialog as unknown as Record<string, unknown>)['showOpenDialog'] = () =>
      Promise.resolve({ canceled: false, filePaths: [dir] });
  }, vault);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Add folder…' }).click();
  await page
    .getByText(/4 articles/)
    .first()
    .waitFor();
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await page.getByRole('link', { name: 'Sliding windows' }).click();
  await page.locator('article.reader[aria-label="Sliding windows"] .article-body').waitFor();
  await page.evaluate((t) => {
    const body = document.querySelector('.article-body')!;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const at = n.textContent!.indexOf(t);
      if (at < 0) continue;
      const r = document.createRange();
      r.setStart(n, at);
      r.setEnd(n, at + t.length);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
      body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return;
    }
    throw new Error(`text not found: ${t}`);
  }, PASSAGE);
  await page.getByRole('button', { name: 'Ask about this' }).click();
  await page.getByLabel('Message the tutor').fill('Why does this keep the sliding window O(n)?');
  await page.getByLabel('Message the tutor').press('Enter');
  const notice = page.getByTestId('provider-notice');
  await notice.waitFor();
  await notice.getByRole('button', { name: 'Send' }).click();
  const chat = page.getByTestId('article-chats');
  await chat.getByTestId('msg-assistant').getByText('at most once').waitFor({ timeout: 30_000 });
  await page.evaluate(() => {
    getSelection()?.removeAllRanges();
    // Show the question as well as the reply.
    document
      .querySelector('[data-testid="article-chats"] [data-testid="chat-log"]')
      ?.scrollTo(0, 0);
  });
  await shot(page, 'library');
  await app.close();

  // ---- dark mode: the same problem after a restart
  ({ app, page } = await launch('dark'));
  await page.getByRole('heading', { name: 'Practice' }).waitFor();
  await openProblem(page);
  await page.getByRole('button', { name: 'This problem' }).click();
  await page.getByRole('button', { name: 'Hint' }).waitFor();
  await page.getByRole('button', { name: 'Run' }).click();
  await page.getByTestId('summary').waitFor({ timeout: 60_000 });
  await shot(page, 'practice-dark');
} finally {
  await app?.close();
  rmSync(base, { recursive: true, force: true });
}
