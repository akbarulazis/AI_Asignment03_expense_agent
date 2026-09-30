import { Agent } from '@anvia/core';
import { startStubModel } from './stub-model.ts';
import { getModel } from '../src/models.ts';
import { memoryStore, validateMemory } from '../src/memory.ts';
import { BASE_INSTRUCTIONS } from '../src/prompts.ts';
import { db } from '../prisma/db.ts';

const stub = await startStubModel(4310);
await validateMemory();

const agent = new Agent({
  id: 'expense-assistant',
  model: getModel(),
  instructions: BASE_INSTRUCTIONS,
  memory: { store: memoryStore, savePolicy: 'turn' },
});

const session = { sessionId: 'tutorial-stage-3' };
await agent.generate({ prompt: 'my project is Atlas', session });
const out = await agent.generate({ prompt: 'what did I tell you?', session });
console.log('REMEMBERED:', String((out as any).output ?? '').includes('Atlas'));

await stub.close();
await db.close();