import { Studio, createSqliteSessionStore } from '@anvia/studio';
import { createExpenseAgent } from './agents.ts';
import { validateMemory } from './memory.ts';
import { db } from '../prisma/db.ts';

await validateMemory();

const agent = createExpenseAgent();

await new Studio([agent], {
  stores: {
    sessions: createSqliteSessionStore({ path: '.anvia/studio.sqlite' }),
  },
}).serve({
  port: Number(process.env['RUNNER_PORT'] ?? 4021),
  onShutdown: async () => {
    await db.close();
  },
});