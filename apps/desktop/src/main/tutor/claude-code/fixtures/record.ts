/**
 * Re-records `turn.jsonl` and `auth.jsonl` from the installed Claude Code
 * (by hand, not in tests):
 *
 *     npx tsx apps/desktop/src/main/tutor/claude-code/fixtures/record.ts [path/to/claude]
 *
 * Runs the real CLI through `ClaudeCodeBackend`, the app's MCP server and the
 * relay, with the relay's upstream pointed at `mock-messages-api.ts` on
 * loopback: no AI provider is contacted and no real key is used. A wrapper
 * script copies the CLI's raw stdout, which is written next to this file
 * with temporary paths replaced by `/data`.
 */
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeTools, rig, turn } from './harness';
import { startMockApi } from './mock-messages-api';

const HERE = dirname(fileURLToPath(import.meta.url));

async function record(mode: 'ok' | 'auth', claude: string, work: string): Promise<string[]> {
  const raw = join(work, `${mode}.raw.jsonl`);
  const wrapper = join(work, `claude-tee-${mode}`);
  await writeFile(
    wrapper,
    `#!/bin/bash\n"${claude}" "$@" 2>/dev/null | tee -a "${raw}"\nexit \${PIPESTATUS[0]}\n`,
  );
  await chmod(wrapper, 0o755);
  const api = await startMockApi(mode);
  const r = await rig(wrapper, { upstream: api.url, home: join(work, `home-${mode}`) });
  try {
    for await (const ev of r.backend.runTurn(turn(fakeTools()), new AbortController().signal))
      console.log(mode, JSON.stringify(ev));
  } finally {
    await r.close();
    await api.close();
  }
  console.log(mode, 'API requests:', api.requests.length, 'keys seen:', [
    ...new Set(api.requests.map((q) => q.apiKey)),
  ]);
  const lines = (await readFile(raw, 'utf8')).split('\n').filter(Boolean);
  const end = lines.findIndex((l) => (JSON.parse(l) as { type?: string }).type === 'result');
  const kept = end >= 0 ? lines.slice(0, end + 1) : lines;
  return kept.map((l) => l.split(work).join('/data'));
}

async function main(): Promise<void> {
  const claude = process.argv[2] ?? 'claude';
  const work = await mkdtemp(join(tmpdir(), 'cc-record-'));
  try {
    await writeFile(join(HERE, 'turn.jsonl'), (await record('ok', claude, work)).join('\n') + '\n');
    await writeFile(
      join(HERE, 'auth.jsonl'),
      (await record('auth', claude, work)).join('\n') + '\n',
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

await main();
