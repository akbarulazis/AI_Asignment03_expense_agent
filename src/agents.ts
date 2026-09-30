import { Agent, type AnyTool } from '@anvia/core';
import { createSummaryMemoryCompactor } from '@anvia/core/memory';
import { getModel } from './models.ts';
import { BASE_INSTRUCTIONS } from './prompts.ts';
import { memoryStore } from './memory.ts';
import { expenseService } from './services/expense-service.ts';
import { createExpenseTools } from './tools/expense-tools.ts';

export type CreateAgentOptions = {
  userId?: string;
  tools?: AnyTool[];
  /** Compaction trigger in tokens. Low values make compaction easy to observe. */
  compactAfterTokens?: number;
  retainRecentTokens?: number;
};

export function createExpenseAgent(options: CreateAgentOptions = {}) {
  const userId = options.userId ?? 'demo-user';
  const tools = options.tools ?? createExpenseTools({ service: expenseService, userId });

  const compactor = createSummaryMemoryCompactor({
    model: getModel(),
    instructions:
      'Summarize the conversation so far. Keep every expense amount, date, category and id that was mentioned, plus any stated user preference. Drop small talk.',
    maxTokens: 1024,
    temperature: 0,
  });

  return new Agent({
    id: 'expense-assistant',
    name: 'Expense Assistant',
    description: 'Tracks expenses in rupiah and answers questions about them.',
    model: getModel(),
    instructions: BASE_INSTRUCTIONS,
    tools,
    memory: {
      store: memoryStore,
      savePolicy: 'turn',
      compaction: {
        trigger: { afterTokens: options.compactAfterTokens ?? 32_000 },
        retention: { recentTokens: options.retainRecentTokens ?? 8_000 },
        compactor,
      },
    },
  });
}
