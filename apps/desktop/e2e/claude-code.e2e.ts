/// <reference lib="dom" />
/**
 * `npm run e2e:claude-code`: the Claude Code tutor backend in the real app,
 * with the real `claude` CLI, against a loopback stand-in for the Messages
 * API (no AI provider is contacted; the key is a dummy). Opt-in, because it
 * needs Claude Code installed:
 *
 *   ALGOTUTOR_TEST_CLAUDE=$(which claude) npm run e2e:claude-code
 *   (Linux without a display: xvfb-run -a …)
 *
 * Settings selects Claude Code at that path → the home chat asks a question
 * → the CLI calls `get_status` through the app's MCP server and replies →
 * every request the stand-in API saw carried the app's key (swapped in by
 * the relay) and only the tutor's tools → a second message resumes the
 * session → Settings shows where Claude Code was found.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type Page } from 'playwright-core';
import { startMockApi } from '../src/main/tutor/claude-code/fixtures/mock-messages-api';

const ROOT = join(import.meta.dirname, '..');
const claude = process.env.ALGOTUTOR_TEST_CLAUDE?.trim();
if (!claude) {
  console.log('Set ALGOTUTOR_TEST_CLAUDE to the claude executable to run this check.');
  process.exit(2);
}
const KEY = 'sk-ant-e2e-dummy-key-not-real-0000';

const failures: string[] = [];
function check(name: string, ok: boolean, detail?: unknown): void {
  console.log(JSON.stringify({ check: name, ok, ...(detail === undefined ? {} : { detail }) }));
  if (!ok) failures.push(name);
}

async function idle(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Send' }).waitFor({ timeout: 120_000 });
}

async function ask(page: Page, text: string): Promise<void> {
  await page.getByLabel('Message the tutor').fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
  await page
    .getByRole('button', { name: 'Stop' })
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
  await idle(page);
}

const api = await startMockApi('ok');
const dataDir = mkdtempSync(join(tmpdir(), 'algotutor-e2e-cc-'));
mkdirSync(dataDir, { recursive: true });
writeFileSync(
  join(dataDir, 'settings.json'),
  JSON.stringify({ tutor: { backend: 'claude-code', claudeCodePath: claude } }),
);
const app = await electron.launch({
  args: [join(ROOT, 'out/main/index.js'), ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
  env: {
    ...process.env,
    ALGOTUTOR_DATA_DIR: dataDir,
    ALGOTUTOR_FAKE_TUTOR: '',
    ANTHROPIC_API_KEY: KEY,
    ANTHROPIC_BASE_URL: api.url,
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

  await ask(page, 'How am I doing?');
  const reply = (await page.getByTestId('msg-assistant').last().textContent()) ?? '';
  check('the reply streamed in', reply.includes('You have not started yet'), reply);
  const chips = await page.getByTestId('tool-chip').allTextContents();
  check(
    'the CLI called get_status through the MCP server',
    chips.length === 1 && chips[0]!.startsWith('✓'),
    chips,
  );
  check('no error was shown', (await page.getByTestId('msg-error').count()) === 0);

  const tools = [...new Set(api.requests.flatMap((r) => r.tools))];
  check(
    'every API request carried the app’s key, swapped in by the relay',
    api.requests.length >= 2 && api.requests.every((r) => r.apiKey === KEY),
    api.requests.map((r) => r.apiKey?.slice(0, 12)),
  );
  check(
    'the model was offered only the tutor’s tools',
    tools.length > 5 && tools.every((t) => t.startsWith('mcp__tutor__')),
    tools,
  );
  check(
    'the system prompt is the tutor’s',
    api.requests.every((r) => r.system.includes('mcp__tutor__run_tests')),
  );

  const before = api.requests.length;
  await ask(page, 'And now?');
  const sessions = await page.getByTestId('msg-assistant').count();
  check(
    'a second message gets a reply (resumed session)',
    sessions === 2 && api.requests.length > before,
  );
  const resumed = api.requests[before]!;
  check(
    'the resumed request carries the earlier conversation',
    resumed.messages >= 5 && resumed.lastText.includes('And now?'),
    { messages: resumed.messages },
  );

  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Settings' }).waitFor();
  const status = (await page.getByTestId('claude-code-status').textContent()) ?? '';
  check('Settings shows where Claude Code was found', status.includes(`Found: ${claude}`), status);
} finally {
  await app.close();
  await api.close();
  rmSync(dataDir, { recursive: true, force: true });
}
console.log(JSON.stringify({ failures }));
process.exit(failures.length ? 1 : 0);
