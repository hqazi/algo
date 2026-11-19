/**
 * A loopback stand-in for the Messages API, used to record Claude Code's
 * stream (`record.ts`) and by the opt-in real-CLI test. No model, no network:
 * canned SSE replies. Ported from `dsa-tutor/tests/fixtures/claude_code/mock_messages_api.py`.
 *
 * - A request that offers `mcp__tutor__get_status` and carries no tool
 *   result gets text plus a `tool_use` of it.
 * - A request carrying a tool result gets a closing text.
 * - Anything else gets a short text.
 * - Mode `auth` answers every request 401.
 *
 * Every request is logged (path, model, tool names, auth header names and the
 * key's value, so tests can check the relay swapped it).
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockRequest {
  path: string;
  model: unknown;
  tools: string[];
  system: string;
  apiKey: string | null;
  authorization: string | null;
  hasResult: boolean;
  lastText: string;
  /** User and assistant messages in the request. */
  messages: number;
}

export interface MockApi {
  url: string;
  requests: MockRequest[];
  close(): Promise<void>;
}

type Obj = Record<string, unknown>;

function sse(events: Obj[]): string {
  return events.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

export async function startMockApi(mode: 'ok' | 'auth' = 'ok'): Promise<MockApi> {
  let ids = 1;
  const requests: MockRequest[] = [];

  const message = (
    model: unknown,
    blocks: ({ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string })[],
    stop: string,
  ): string => {
    const id = `msg_mock${ids++}`;
    const ev: Obj[] = [
      {
        type: 'message_start',
        message: {
          id,
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 1 },
        },
      },
    ];
    blocks.forEach((b, index) => {
      if (b.type === 'text') {
        ev.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
        for (const part of [b.text.slice(0, 6), b.text.slice(6)])
          ev.push({
            type: 'content_block_delta',
            index,
            delta: { type: 'text_delta', text: part },
          });
      } else {
        ev.push({
          type: 'content_block_start',
          index,
          content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} },
        });
        ev.push({
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json_delta', partial_json: '{}' },
        });
      }
      ev.push({ type: 'content_block_stop', index });
    });
    ev.push({
      type: 'message_delta',
      delta: { stop_reason: stop, stop_sequence: null },
      usage: { output_tokens: 5 },
    });
    ev.push({ type: 'message_stop' });
    return sse(ev);
  };

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      let body: Obj = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Obj;
      } catch {
        // keep {}
      }
      const tools = Array.isArray(body.tools) ? body.tools.map((t) => String((t as Obj).name)) : [];
      const sys = body.system;
      const system =
        typeof sys === 'string'
          ? sys
          : Array.isArray(sys)
            ? sys.map((b) => String((b as Obj).text ?? '')).join('\n')
            : '';
      const msgs = Array.isArray(body.messages) ? (body.messages as Obj[]) : [];
      const users = msgs.filter((m) => m.role === 'user');
      const last = users.at(-1)?.content;
      const hasResult = Array.isArray(last) && last.some((b) => (b as Obj).type === 'tool_result');
      const lastText = Array.isArray(last)
        ? last.map((b) => String((b as Obj).text ?? '')).join('')
        : String(last ?? '');
      const header = (n: string): string | null => {
        const v = req.headers[n];
        return typeof v === 'string' ? v : null;
      };
      requests.push({
        path: req.url ?? '',
        model: body.model,
        tools,
        system,
        apiKey: header('x-api-key'),
        authorization: header('authorization'),
        hasResult,
        lastText,
        messages: msgs.filter((m) => m.role === 'user' || m.role === 'assistant').length,
      });
      const json = (status: number, obj: Obj): void => {
        const b = JSON.stringify(obj);
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(b);
      };
      if (mode === 'auth')
        return json(401, {
          type: 'error',
          error: { type: 'authentication_error', message: 'invalid x-api-key' },
        });
      if ((req.url ?? '').includes('count_tokens')) return json(200, { input_tokens: 10 });
      const model = body.model ?? 'm';
      let out: string;
      if (tools.includes('mcp__tutor__get_status') && !hasResult)
        out = message(
          model,
          [
            { type: 'text', text: 'Let me check.' },
            { type: 'tool_use', id: `toolu_${ids++}`, name: 'mcp__tutor__get_status' },
          ],
          'tool_use',
        );
      else if (hasResult)
        out = message(
          model,
          [{ type: 'text', text: 'You have not started yet. Shall we begin?' }],
          'end_turn',
        );
      else out = message(model, [{ type: 'text', text: 'Side reply.' }], 'end_turn');
      if (!body.stream)
        return json(200, {
          id: 'msg_x',
          type: 'message',
          role: 'assistant',
          model,
          content: [{ type: 'text', text: 'Side reply.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(out);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
