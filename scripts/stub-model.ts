/**
 * A deterministic, offline stand-in for an OpenAI-compatible chat completions
 * endpoint. It exists so the agent loop, the tools and the memory store can be
 * tested without a real provider key. It is NOT a language model: it decides
 * what to do with simple rules over the last user message.
 *
 * Run it, then point OPENAI_BASE_URL at http://127.0.0.1:4310/v1
 */
import { createServer } from 'node:http';

type ToolCall = { name: string; args: Record<string, unknown> };
type Decision = { text: string; toolCalls: ToolCall[] };

const PORT = Number(process.env['STUB_PORT'] ?? 4310);

function lastUserText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== 'user') continue;
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
      return message.content.map((part: any) => part?.text ?? '').join(' ');
    }
  }
  return '';
}

function hasToolResultFor(messages: any[], name: string): boolean {
  // An OpenAI-format tool result is { role: 'tool', tool_call_id }, with no
  // tool name on it. The name lives on the assistant message that requested it.
  const ids = new Set<string>();
  for (const message of messages) {
    if (message?.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue;
    for (const call of message.tool_calls) {
      if (call?.function?.name === name && typeof call.id === 'string') ids.add(call.id);
    }
  }
  return messages.some(
    (message) => message?.role === 'tool' && ids.has(String(message.tool_call_id ?? '')),
  );
}

function decide(messages: any[]): Decision {
  const text = lastUserText(messages).toLowerCase();

  // A compaction request arrives as a summarization instruction, not a chat turn.
  const system = messages.find((m) => m?.role === 'system');
  const systemText = typeof system?.content === 'string' ? system.content.toLowerCase() : '';
  if (systemText.includes('summarize the conversation so far')) {
    return { text: `SUMMARY(stub): ${messages.length} earlier messages condensed.`, toolCalls: [] };
  }

  if (text.includes('spent') || text.includes('beli') || text.includes('bayar')) {
    if (hasToolResultFor(messages, 'addExpense')) {
      return { text: 'Recorded it.', toolCalls: [] };
    }
    const amount = Number(/(\d[\d_]*)/.exec(text.replace(/[.,]/g, ''))?.[1] ?? '0');
    const category = text.includes('grab') || text.includes('bensin')
      ? 'transport'
      : text.includes('listrik') || text.includes('bill')
        ? 'bills'
        : 'food';
    return {
      text: '',
      toolCalls: [
        {
          name: 'addExpense',
          args: {
            description: lastUserText(messages).slice(0, 60),
            amountIdr: amount,
            category,
            spentOn: process.env['STUB_DATE'] ?? '2026-09-20',
          },
        },
      ],
    };
  }

  if (text.includes('bad date')) {
    return {
      text: '',
      toolCalls: [
        {
          name: 'addExpense',
          args: { description: 'invalid', amountIdr: 1000, category: 'food', spentOn: '20-09-2026' },
        },
      ],
    };
  }

  if (text.includes('negative')) {
    return {
      text: '',
      toolCalls: [
        {
          name: 'addExpense',
          args: { description: 'negative', amountIdr: -5000, category: 'food', spentOn: '2026-09-20' },
        },
      ],
    };
  }

  if (text.includes('delete')) {
    if (hasToolResultFor(messages, 'deleteExpense')) return { text: 'Done.', toolCalls: [] };
    const id = /id[= ]([a-z0-9]+)/.exec(text)?.[1] ?? 'missing-id';
    return { text: '', toolCalls: [{ name: 'deleteExpense', args: { id } }] };
  }

  if (text.includes('total') || text.includes('summary') || text.includes('berapa')) {
    if (hasToolResultFor(messages, 'summarizeSpending')) {
      const result = [...messages].reverse().find((m) => m?.role === 'tool');
      return { text: `Here is your spending:\n${result?.content ?? ''}`, toolCalls: [] };
    }
    return { text: '', toolCalls: [{ name: 'summarizeSpending', args: {} }] };
  }

  if (text.includes('list')) {
    if (hasToolResultFor(messages, 'listExpenses')) {
      const result = [...messages].reverse().find((m) => m?.role === 'tool');
      return { text: `${result?.content ?? ''}`, toolCalls: [] };
    }
    return { text: '', toolCalls: [{ name: 'listExpenses', args: { limit: 10 } }] };
  }

  // Memory probe: echo back anything the conversation already contains.
  if (text.includes('what') || text.includes('apa') || text.includes('recall')) {
    const transcript = messages
      .filter((m) => m?.role === 'user' || m?.role === 'tool' || m?.role === 'system')
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join(' | ');
    return { text: `RECALL: ${transcript}`.slice(0, 1500), toolCalls: [] };
  }

  return { text: 'STUB_OK', toolCalls: [] };
}

function completionBody(decision: Decision) {
  const toolCalls = decision.toolCalls.map((call, index) => ({
    id: `call_${index}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'function',
    function: { name: call.name, arguments: JSON.stringify(call.args) },
  }));
  return {
    id: `chatcmpl-stub-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'stub-model',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: decision.text === '' ? null : decision.text,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  };
}

function streamChunks(decision: Decision): string[] {
  const body = completionBody(decision);
  const message = body.choices[0]!.message as any;
  const base = {
    id: body.id,
    object: 'chat.completion.chunk',
    created: body.created,
    model: body.model,
  };
  const chunks: string[] = [];
  chunks.push(JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] }));
  if (message.content) {
    for (const piece of String(message.content).match(/.{1,24}/gs) ?? []) {
      chunks.push(JSON.stringify({ ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] }));
    }
  }
  if (message.tool_calls) {
    message.tool_calls.forEach((call: any, index: number) => {
      chunks.push(
        JSON.stringify({
          ...base,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index,
                    id: call.id,
                    type: 'function',
                    function: { name: call.function.name, arguments: call.function.arguments },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        }),
      );
    });
  }
  chunks.push(
    JSON.stringify({
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: body.choices[0]!.finish_reason }],
      usage: body.usage,
    }),
  );
  return chunks;
}

/**
 * Point the agent's model client at a running stub. Must be called before the
 * first getModel() call, and after the static imports that load `.env`.
 */
export function useStubModel(port: number = PORT): void {
  process.env['OPENAI_BASE_URL'] = `http://127.0.0.1:${port}/v1`;
  process.env['OPENAI_API'] = 'chat';
  process.env['OPENAI_API_KEY'] ??= 'stub-key';
}

export function startStubModel(port: number = PORT) {
    const server = createServer((req, res) => {
    const body: Buffer[] = [];
    req.on('data', (chunk) => body.push(chunk));
    req.on('end', () => {
      if (!req.url?.includes('/chat/completions')) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `stub has no route for ${req.url}` } }));
        return;
      }
      let payload: any = {};
      try {
        payload = JSON.parse(Buffer.concat(body).toString('utf8') || '{}');
      } catch {
        res.writeHead(400).end('{}');
        return;
      }
      if (process.env['STUB_DUMP'] === '1') {
        console.log('STUB_REQ ' + JSON.stringify((payload.messages ?? []).map((m: any) => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content.slice(0, 200) : m.content,
        }))).slice(0, 1200));
      }
      // Deliberate provider outage, for testing failed runs.
      if (lastUserText(payload.messages ?? []).includes('provider-outage')) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'stub provider outage', type: 'server_error' } }));
        return;
      }
      const decision = decide(payload.messages ?? []);
      if (payload.stream === true) {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        for (const chunk of streamChunks(decision)) res.write(`data: ${chunk}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(completionBody(decision)));
    });
  });

  return new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

if (process.argv[1]?.includes('stub-model')) {
  const handle = await startStubModel();
  console.log(`stub model listening on http://127.0.0.1:${handle.port}/v1`);
}