/* global process, fetch, setInterval */
// A stand-in for the Claude Code CLI in tests, run as `node fake-claude.mjs <claude args>`.
// It replays a recorded stream-json fixture and makes the tool calls the
// fixture's assistant messages ask for through the app's real MCP server.
//
// FAKE_CLAUDE_MODE:  replay (default) | hang | slow-tool | resume-fail
// FAKE_CLAUDE_FIXTURE: the .jsonl to replay
// FAKE_CLAUDE_DUMP: a file to write { argv, env, prompt, mcp } to
import { readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const mode = process.env.FAKE_CLAUDE_MODE ?? 'replay';

let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;

const mcp = JSON.parse(readFileSync(flag('--mcp-config'), 'utf8')).mcpServers.tutor;
if (process.env.FAKE_CLAUDE_DUMP)
  writeFileSync(
    process.env.FAKE_CLAUDE_DUMP,
    JSON.stringify({ argv, env: process.env, prompt, mcp, cwd: process.cwd() }),
  );

let rpcId = 1;
async function rpc(method, params) {
  const res = await fetch(mcp.url, {
    method: 'POST',
    headers: {
      ...mcp.headers,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
  });
  return res.json();
}

const out = (line) =>
  new Promise((resolve) => process.stdout.write(line.endsWith('\n') ? line : line + '\n', resolve));
const init = (sessionId) =>
  out(
    JSON.stringify({
      type: 'system',
      subtype: 'init',
      session_id: sessionId,
      tools: ['mcp__tutor__get_status', 'mcp__tutor__slow_tool'],
    }),
  );

if (mode === 'hang') {
  await init('hang-session');
  setInterval(() => undefined, 1000);
} else if (mode === 'slow-tool') {
  await init('slow-session');
  await rpc('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'fake', version: '0' },
  });
  await rpc('tools/call', { name: 'slow_tool', arguments: {} });
  setInterval(() => undefined, 1000);
} else if (mode === 'resume-fail' && argv.includes('--resume')) {
  await out(
    JSON.stringify({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      result: 'No conversation found with session ID',
    }),
  );
  process.exit(1);
} else {
  const lines = readFileSync(process.env.FAKE_CLAUDE_FIXTURE, 'utf8').split('\n').filter(Boolean);
  let initialized = false;
  for (const line of lines) {
    await out(line);
    const ev = JSON.parse(line);
    if (ev.type !== 'assistant') continue;
    for (const block of ev.message?.content ?? []) {
      if (block.type !== 'tool_use' || !block.name.startsWith('mcp__tutor__')) continue;
      if (!initialized) {
        await rpc('initialize', {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'fake', version: '0' },
        });
        initialized = true;
      }
      await rpc('tools/call', {
        name: block.name.slice('mcp__tutor__'.length),
        arguments: block.input ?? {},
      });
    }
  }
  const last = JSON.parse(lines.at(-1));
  process.exit(last.type === 'result' && !last.is_error ? 0 : 1);
}
