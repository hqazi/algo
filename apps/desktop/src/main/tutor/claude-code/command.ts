/**
 * The Claude Code command line and environment for one turn (T11). Flags
 * checked against Claude Code 2.1.328 (`claude --help`, the CLI reference
 * and headless docs, and runs of that CLI through this backend against a
 * loopback stand-in for the Messages API; DECISIONS D-25):
 *
 *     claude --bare                         no hooks, plugins, CLAUDE.md, auto memory,
 *                                           skills or subagents; never reads OAuth or the keychain:
 *                                           auth is ANTHROPIC_API_KEY only
 *       -p --input-format text              headless; the prompt arrives on stdin
 *       --output-format stream-json --verbose --include-partial-messages
 *       --system-prompt-file <file>         replaces the default system prompt
 *       --tools ""                          no built-in tools at all
 *       --mcp-config <file> --strict-mcp-config   only the tutor's MCP server
 *       --allowedTools mcp__tutor__a,…      the tutor tools, pre-approved
 *       --permission-mode dontAsk           anything not pre-approved is denied, never asked
 *       --setting-sources ""                no user, project or local settings
 *       --disable-slash-commands            no skills or commands
 *       --max-turns <n> --model <m> --effort <e> [--resume <session id>]
 *
 * The environment is built from nothing: the search path and the few
 * variables a process needs to start on each OS, `HOME` (and `USERPROFILE`,
 * `CLAUDE_CONFIG_DIR`) set to the app's own agent home, the relay's URL and
 * turn token as the API base URL and key, and switches that turn off the
 * auto-updater, telemetry, error reporting and other non-essential traffic.
 * No proxy variables: the CLI talks only to loopback.
 */
import { join } from 'node:path';

export const TOOL_PREFIX = 'mcp__tutor__';
/** Model requests per user turn, as in the Anthropic backend. */
export const MAX_TURNS = 24;

export const PROMPT_SUFFIX =
  '\n\nIn this app the tools above are provided by the `tutor` MCP server, so their names ' +
  `carry the prefix \`${TOOL_PREFIX}\` (for example \`${TOOL_PREFIX}run_tests\`). They are the only ` +
  'tools you have.\n';

export const FIXED_ENV: Readonly<Record<string, string>> = {
  DISABLE_AUTOUPDATER: '1',
  DISABLE_TELEMETRY: '1',
  DISABLE_ERROR_REPORTING: '1',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  NO_PROXY: '127.0.0.1,localhost,::1',
};

/** Passed through when set: what a process needs to start, never a credential. */
const BASE_ENV = [
  'PATH',
  'Path',
  'LANG',
  'LC_ALL',
  'TZ',
  'SystemRoot',
  'SYSTEMROOT',
  'windir',
  'ComSpec',
  'PATHEXT',
] as const;

export interface Invocation {
  systemPromptFile: string;
  mcpConfigFile: string;
  tools: string[];
  model: string;
  effort: string | null;
  sessionId: string | null;
  maxTurns?: number;
}

export function buildArgs(inv: Invocation): string[] {
  const args = [
    '--bare',
    '-p',
    '--input-format',
    'text',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--system-prompt-file',
    inv.systemPromptFile,
    '--tools',
    '',
    '--mcp-config',
    inv.mcpConfigFile,
    '--strict-mcp-config',
    '--allowedTools',
    inv.tools.map((t) => TOOL_PREFIX + t).join(','),
    '--permission-mode',
    'dontAsk',
    '--setting-sources',
    '',
    '--disable-slash-commands',
    '--max-turns',
    String(inv.maxTurns ?? MAX_TURNS),
    '--model',
    inv.model,
  ];
  if (inv.effort) args.push('--effort', inv.effort);
  if (inv.sessionId) args.push('--resume', inv.sessionId);
  return args;
}

export function mcpConfig(url: string, token: string): Record<string, unknown> {
  return {
    mcpServers: {
      tutor: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } },
    },
  };
}

export interface EnvInput {
  parent: Record<string, string | undefined>;
  home: string;
  tmp: string;
  relayUrl: string;
  relayToken: string;
  /** Tests only (e.g. a fake CLI's own switches). */
  extra?: Record<string, string>;
}

export function childEnv(input: EnvInput): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of BASE_ENV) {
    const v = input.parent[name];
    if (v) env[name] = v;
  }
  Object.assign(env, FIXED_ENV);
  env.HOME = input.home;
  env.USERPROFILE = input.home;
  env.CLAUDE_CONFIG_DIR = join(input.home, '.claude');
  env.TMPDIR = input.tmp;
  env.TEMP = input.tmp;
  env.TMP = input.tmp;
  env.ANTHROPIC_BASE_URL = input.relayUrl;
  env.ANTHROPIC_API_KEY = input.relayToken;
  if (input.extra) Object.assign(env, input.extra);
  return env;
}
