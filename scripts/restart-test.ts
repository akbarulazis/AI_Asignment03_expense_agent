/**
 * Proves memory survives a process restart. Run as two separate processes:
 *   tsx scripts/restart-test.ts write <sessionId>
 *   tsx scripts/restart-test.ts read  <sessionId>
 * The second invocation is a brand new process with no in-memory state.
 */
import { startStubModel, useStubModel } from './stub-model.ts';
import { db } from '../prisma/db.ts';
import { createExpenseAgent } from '../src/agents.ts';
import { validateMemory } from '../src/memory.ts';

const [, , mode, sessionId] = process.argv;
if (mode !== 'write' && mode !== 'read') throw new Error('usage: restart-test.ts write|read <sessionId>');
if (!sessionId) throw new Error('missing sessionId');

const stub = await startStubModel(4310);
useStubModel(4310);
await validateMemory();
const agent = createExpenseAgent({ userId: 'restart-user' });
const session = { sessionId };

if (mode === 'write') {
  await agent.generate({ prompt: 'My budget codename is Operation Rendang', session });
  console.log(`WROTE pid=${process.pid} session=${sessionId}`);
} else {
  const outcome = await agent.generate({ prompt: 'what did I tell you?', session });
  const text = typeof (outcome as any).output === 'string'
    ? (outcome as any).output
    : JSON.stringify(outcome);
  const remembered = text.includes('Operation Rendang');
  console.log(`READ pid=${process.pid} remembered=${remembered}`);
  console.log(remembered ? 'PASS 8. Memory survives a full process restart' : 'FAIL 8. Memory lost across restart');
  process.exitCode = remembered ? 0 : 1;
}

await stub.close();
await db.close();