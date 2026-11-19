/**
 * The tool registry: name, description, input schema, handler and UI event
 * per tool. Ported from `dsa-tutor/dsa_tutor/tools/registry.py`.
 *
 * One registry is the single definition of the tutor's tools (SPEC §7.1),
 * exported for the Messages API (`anthropicTools()`) and for an MCP server
 * (`mcpTools()`, T11). `call(name, args)` validates `args` against the
 * tool's schema before the handler runs and always resolves to a
 * `ToolResult`: it never rejects for a bad input or a failing tool.
 */
import { TutorError } from '../teaching/errors';
import { validateInput, type JsonSchema } from './schema';

export const UI_ACTIONS = [
  'open_problem',
  'show_results',
  'open_explanation',
  'refresh_state',
] as const;
export type UiAction = (typeof UI_ACTIONS)[number];

/** An event for the app's UI (SPEC §7.3 `ui_event`). */
export interface UiEvent {
  type: 'ui';
  action: UiAction;
  [field: string]: unknown;
}

/**
 * The compact JSON the model sees. `ok: false` outputs carry `error` (words)
 * and usually `code`.
 */
export type ToolOutput = { ok: boolean; [field: string]: unknown };

/** What a handler may return: any object with `ok` (typed results included). */
export type HandlerOutput = { ok: boolean } | ToolOutput;

export interface ToolResult {
  name: string;
  /** The model's view (`{ ok: false, error, code? }` on failure). */
  output: ToolOutput;
  /** One line for the tool chip in the chat. */
  summary: string;
  /** Events for the UI; none when the tool failed. */
  ui: UiEvent[];
}

export interface Tool<Ctx> {
  name: string;
  /** For people (MCP `title`). */
  title: string;
  /** The tool chip while it runs, e.g. "Running tests". */
  startSummary: string;
  description: string;
  inputSchema: JsonSchema;
  handler: (ctx: Ctx, args: Record<string, unknown>) => Promise<HandlerOutput> | HandlerOutput;
  /** The UI action emitted on success. */
  uiEvent?: UiAction;
  /** Extra fields for the UI event, from the arguments and output. */
  uiPayload?: (args: Record<string, unknown>, output: ToolOutput) => Record<string, unknown>;
  /** Changes state: emits `refresh_state` on success. */
  mutates?: boolean;
  /** The tool chip on success. */
  summarize?: (output: ToolOutput) => string;
}

export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: JsonSchema;
}

export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: {
    title: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
}

/** Where a crashing handler is reported (never shown to the model). */
export type ToolLogger = (message: string, error: unknown) => void;

const deepCopy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class ToolRegistry<Ctx> {
  private readonly tools = new Map<string, Tool<Ctx>>();

  constructor(
    readonly context: Ctx,
    tools: Iterable<Tool<Ctx>> = [],
    private readonly log: ToolLogger = () => {},
  ) {
    for (const t of tools) this.add(t);
  }

  add(tool: Tool<Ctx>): void {
    if (this.tools.has(tool.name)) throw new Error(`duplicate tool "${tool.name}"`);
    if (tool.inputSchema.type !== 'object')
      throw new Error(`${tool.name}: input schema must be an object schema`);
    if (tool.uiEvent !== undefined && !UI_ACTIONS.includes(tool.uiEvent))
      throw new Error(`${tool.name}: unknown ui event "${String(tool.uiEvent)}"`);
    this.tools.set(tool.name, tool);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): Tool<Ctx> | undefined {
    return this.tools.get(name);
  }

  get size(): number {
    return this.tools.size;
  }

  /** A registry with only these tools (e.g. `create_problem` for intake), sharing the context. */
  subset(names: readonly string[]): ToolRegistry<Ctx> {
    const unknown = names.filter((n) => !this.tools.has(n));
    if (unknown.length) throw new Error(`unknown tools: ${unknown.join(', ')}`);
    return new ToolRegistry(
      this.context,
      names.map((n) => this.tools.get(n)!),
      this.log,
    );
  }

  /** Client tool definitions for the Messages API `tools` parameter. */
  anthropicTools(): AnthropicToolDefinition[] {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: deepCopy(t.inputSchema),
    }));
  }

  /** Tool definitions as an MCP server lists them (`tools/list`). */
  mcpTools(): McpToolDefinition[] {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      title: t.title || t.name,
      description: t.description,
      inputSchema: deepCopy(t.inputSchema),
      annotations: {
        title: t.title || t.name,
        readOnlyHint: !t.mutates,
        destructiveHint: false,
        idempotentHint: !t.mutates,
        openWorldHint: false,
      },
    }));
  }

  startSummary(name: string): string {
    const t = this.tools.get(name);
    return t ? t.startSummary || t.title || name : `Unknown tool ${name}`;
  }

  async call(name: string, args: unknown = {}): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool)
      return fail(
        name,
        `unknown tool "${name}"; available: ${this.names().join(', ')}`,
        'unknown_tool',
      );
    const input = args ?? {};
    const problems = validateInput(input, tool.inputSchema);
    if (problems.length)
      return fail(name, `invalid input: ${problems.join('; ')}`, 'invalid_input');
    const given = input as Record<string, unknown>;
    let output: ToolOutput;
    try {
      output = (await tool.handler(this.context, structuredCopy(given))) as ToolOutput;
    } catch (e) {
      if (e instanceof TutorError) return fail(name, e.message, e.code);
      // A tool bug must not end the chat turn, nor leak details to the model.
      this.log(`tool ${name} failed`, e);
      return fail(name, `internal error in ${name}`, 'internal');
    }
    if (typeof output !== 'object' || output === null || typeof output.ok !== 'boolean') {
      this.log(`tool ${name} returned a malformed result`, output);
      return fail(name, `internal error in ${name}`, 'internal');
    }
    if (!output.ok) return { name, output, summary: firstLine(output.error) || 'Failed', ui: [] };
    const summary = tool.summarize ? tool.summarize(output) : 'Done';
    const ui: UiEvent[] = [];
    if (tool.uiEvent)
      ui.push({ type: 'ui', action: tool.uiEvent, ...(tool.uiPayload?.(given, output) ?? {}) });
    if (tool.mutates && tool.uiEvent !== 'refresh_state')
      ui.push({ type: 'ui', action: 'refresh_state' });
    return { name, output, summary, ui };
  }
}

function fail(name: string, error: string, code?: string): ToolResult {
  const output: ToolOutput = { ok: false, error };
  if (code) output.code = code;
  return { name, output, summary: firstLine(error), ui: [] };
}

/** Copy of validated JSON input (bigints kept), so a handler cannot change the caller's object. */
function structuredCopy<T>(v: T): T {
  if (Array.isArray(v)) return v.map(structuredCopy) as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = structuredCopy(x);
    return out as T;
  }
  return v;
}

export function firstLine(text: unknown, limit = 120): string {
  const s = String(text ?? '').trim();
  const line = s ? s.split('\n')[0]!.trim() : '';
  return line.length <= limit ? line : `${line.slice(0, limit - 3)}...`;
}
