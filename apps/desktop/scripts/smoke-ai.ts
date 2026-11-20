/**
 * `npm run smoke:ai`: one real hint turn against the Anthropic API (SPEC §13),
 * by hand only, never in CI. Needs `ANTHROPIC_API_KEY`; `ALGOTUTOR_SMOKE_MODEL`
 * overrides the model. Uses the app's own tutor wiring over the real content,
 * an in-memory store and a temporary workspace; code execution is off (the
 * hint turn needs none), so the tutor's `run_tests` would report it missing.
 *
 * Prints each chat event as one JSON line, then the request's outcome.
 * Exit code 0 only if the turn ends with `done` and a `take_hint` call ran.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, isoNow, MemoryStorage, type ChatEvent } from '@algo/core';
import { FileCatalog } from '../src/main/practice/catalog';
import { FileWorkspace } from '../src/main/practice/file-workspace';
import { Practice } from '../src/main/practice/service';
import { openTutor } from '../src/main/tutor';

const key = process.env['ANTHROPIC_API_KEY']?.trim();
if (!key) {
  console.error('smoke:ai needs ANTHROPIC_API_KEY in the environment.');
  process.exit(2);
}

const CONTENT = join(import.meta.dirname, '../../../content');
const SLUG = 'pair-with-target';
const dataDir = mkdtempSync(join(tmpdir(), 'algotutor-smoke-'));
let code: number;
try {
  const storage = new MemoryStorage();
  const catalog = await FileCatalog.open({ content: CONTENT, dataDir }, isoNow, storage);
  const practice = new Practice({
    storage,
    catalog,
    workspace: new FileWorkspace(join(dataDir, 'workspace')),
    executorFor: () => null,
    timeScale: () => 1,
    now: isoNow,
  });
  await practice.teaching.profileDefaults();
  await practice.teaching.start(SLUG);
  const settings = structuredClone(DEFAULT_SETTINGS);
  const model = process.env['ALGOTUTOR_SMOKE_MODEL']?.trim();
  if (model) settings.tutor.model = model;
  const tutor = await openTutor({
    practice,
    settings: () => settings,
    apiKey: () => key,
    contentDir: CONTENT,
    explanationsDir: join(dataDir, 'explanations'),
    agentHome: join(dataDir, 'agent-home'),
    appVersion: '0.0.0',
    env: {},
    now: isoNow,
  });
  console.log(JSON.stringify({ status: await tutor.status() }));
  const events: ChatEvent[] = [];
  const started = Date.now();
  await tutor.chat.send(
    { thread: SLUG, action: 'hint', code: 'def find_pair(amounts, target):\n    pass\n' },
    new AbortController().signal,
    (e) => {
      events.push(e);
      console.log(JSON.stringify(e));
    },
  );
  const last = events.at(-1);
  const hinted = events.some((e) => e.type === 'tool_end' && e.ok && /hint/i.test(e.summary));
  console.log(
    JSON.stringify({ ended: last?.type, hinted, seconds: (Date.now() - started) / 1000 }),
  );
  code = last?.type === 'done' && hinted ? 0 : 1;
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(code);
