
import { startStubModel, useStubModel } from './stub-model.ts';
import { db } from '../prisma/db.ts';
import { memoryStore, validateMemory } from '../src/memory.ts';
import { createExpenseAgent } from '../src/agents.ts';
import { createExpenseTools } from '../src/tools/expense-tools.ts';
import { expenseService } from '../src/services/expense-service.ts';

const results: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`);
}

function textOf(outcome: any): string {
  if (typeof outcome?.output === 'string') return outcome.output;
  return JSON.stringify(outcome?.output ?? outcome?.type ?? outcome);
}

const stub = await startStubModel(4310);
useStubModel(4310);
await validateMemory();

const userId = `test-${Date.now()}`;
const agent = createExpenseAgent({ userId });
const tools = createExpenseTools({ service: expenseService, userId });
const [addExpense, listExpenses, , deleteExpense] = tools as any[];

// ---------------------------------------------------------------- 1. happy path
const mainSession = { sessionId: `suite-main-${Date.now()}` };
const add = await agent.generate({ prompt: 'I spent 50000 on nasi padang', session: mainSession });
const stored = await expenseService.list({ userId, limit: 10 });
check(
  '1. Happy path: model calls addExpense and the row lands in Postgres',
  stored.length === 1 && stored[0]!.amountIdr === 50000,
  `rows=${stored.length} first=${JSON.stringify(stored[0] ?? null)} answer=${textOf(add).slice(0, 80)}`,
);

// ---------------------------------------------------- 2. memory within a session
const recall = await agent.generate({ prompt: 'what did I tell you?', session: mainSession });
check(
  '2. Same session: earlier turn is replayed into the next run',
  textOf(recall).includes('nasi padang'),
  `answer=${textOf(recall).slice(0, 140)}`,
);

// ------------------------------------------------------------- 3. invalid input
let invalidDetail = '';
let invalidRejected = false;
try {
  await addExpense.call({ description: 'x', amountIdr: 1000, category: 'food', spentOn: '20-09-2026' });
} catch (error) {
  invalidRejected = true;
  invalidDetail = (error as Error).message.slice(0, 120);
}
check('3a. Invalid input: bad date shape is rejected by the tool schema', invalidRejected, invalidDetail);

let badCategory = false;
let badCategoryDetail = '';
try {
  await addExpense.call({ description: 'x', amountIdr: 1000, category: 'groceries', spentOn: '2026-09-20' });
} catch (error) {
  badCategory = true;
  badCategoryDetail = (error as Error).message.slice(0, 120);
}
check('3b. Invalid input: unknown category is rejected', badCategory, badCategoryDetail);

// ---------------------------------------------------------- 4. the not-found case
const missing = await deleteExpense.call({ id: 'does-not-exist' });
check(
  '4. Not found: deleting an unknown id reports it instead of throwing',
  String(missing).includes('No expense with id'),
  String(missing),
);

const otherOwner = await expenseService.add({
  userId: 'someone-else',
  description: 'not yours',
  amountIdr: 1000,
  category: 'fun',
  spentOn: '2026-09-20',
});
const crossUser = await deleteExpense.call({ id: otherOwner.id });
const stillThere = await expenseService.list({ userId: 'someone-else', limit: 5 });
check(
  '4b. Not found: another user\'s expense is not deletable through this agent',
  String(crossUser).includes('No expense with id') && stillThere.length === 1,
  `${String(crossUser).slice(0, 80)} | survivors=${stillThere.length}`,
);
await expenseService.remove({ userId: 'someone-else', id: otherOwner.id });

// ------------------------------------------------------- 5. deliberate failure
// 5a. A tool whose runtime call throws does NOT abort the run: the runtime
// hands the model a `ToolCallError` tool message and the loop continues.
const brokenService = {
  ...expenseService,
  add: async () => {
    throw new Error('simulated database outage');
  },
} as typeof expenseService;
const brokenAgent = createExpenseAgent({
  userId,
  tools: createExpenseTools({ service: brokenService, userId }),
});
const brokenSession = { sessionId: `suite-broken-${Date.now()}` };
const brokenOutcome = await brokenAgent.generate({
  prompt: 'I spent 12000 on kopi',
  session: brokenSession,
});
const rowsAfterBroken = await expenseService.list({ userId, limit: 50 });
const brokenTranscript = await memoryStore.load({ scope: brokenSession });
const sawToolError = JSON.stringify(brokenTranscript).includes('simulated database outage');
check(
  '5a. Deliberate failure: a throwing tool is reported to the model, run continues',
  (brokenOutcome as any).type === 'response' && sawToolError,
  `outcome=${(brokenOutcome as any).type} toolErrorInTranscript=${sawToolError}`,
);
check(
  '5a-risk. Deliberate failure: nothing was written despite the failed tool call',
  rowsAfterBroken.every((row) => row.description !== 'I spent 12000 on kopi'),
  `answer=${textOf(brokenOutcome).slice(0, 60)} | rows for this user=${rowsAfterBroken.length}`,
);

// 5b. A genuine run failure (provider outage) is recorded in AgentMemoryError.
const outageSession = { sessionId: `suite-outage-${Date.now()}` };
let outageFailed = false;
let outageDetail = '';
try {
  await agent.generate({ prompt: 'provider-outage please fail', session: outageSession });
} catch (error) {
  outageFailed = true;
  outageDetail = (error as Error).message.slice(0, 120);
}
const outageRow = await db.orm.public.AgentMemorySession
  .where((s) => s.sessionId.eq(outageSession.sessionId))
  .select('id')
  .first();
const outageErrors = outageRow === null
  ? []
  : await db.orm.public.AgentMemoryError
      .where((e) => e.memorySessionId.eq(outageRow.id))
      .select('id', 'runId')
      .all();
check(
  '5b. Deliberate failure: a provider outage fails the run',
  outageFailed,
  outageDetail || 'run did not throw',
);
check(
  '5b-2. Deliberate failure: the failed run is stored in AgentMemoryError',
  outageErrors.length > 0,
  `AgentMemoryError rows=${outageErrors.length} for that session`,
);

// 5c. Schema-invalid arguments behave differently: they are returned to the
// model, which may retry until the turn limit. This is a cost trap, not a crash.
const retrySession = { sessionId: `suite-retry-${Date.now()}` };
let retryDetail = '';
try {
  await agent.generate({ prompt: 'record a negative expense', session: retrySession });
} catch (error) {
  retryDetail = (error as Error).message.slice(0, 140);
}
check(
  '5c. Deliberate failure: invalid tool args are retried, not aborted (burns turns)',
  retryDetail.includes('max turn limit'),
  retryDetail || 'run unexpectedly succeeded',
);

// 5d. The database constraint is the last line of defence below the schema.
let constraintHeld = false;
let constraintDetail = '';
try {
  await expenseService.add({
    userId, description: 'direct negative', amountIdr: -1, category: 'food', spentOn: '2026-09-20',
  });
} catch (error) {
  constraintHeld = true;
  constraintDetail = (error as Error).message.slice(0, 120);
}
check(
  '5d. Deliberate failure: the DB check constraint rejects a negative amount',
  constraintHeld,
  constraintDetail,
);

// ------------------------------------------------------------- 6. session isolation
const otherSession = { sessionId: `suite-other-${Date.now()}` };
const isolated = await agent.generate({ prompt: 'what did I tell you?', session: otherSession });
check(
  '6. Isolation: a different sessionId cannot see the first conversation',
  !textOf(isolated).includes('nasi padang'),
  `answer=${textOf(isolated).slice(0, 120)}`,
);

// ------------------------------------------------------------------ 7. compaction
const compactSession = { sessionId: `suite-compact-${Date.now()}` };
const compactingAgent = createExpenseAgent({
  userId,
  compactAfterTokens: 50,
  retainRecentTokens: 20,
});
for (let i = 0; i < 4; i += 1) {
  await compactingAgent.generate({ prompt: `note number ${i}: remember this line`, session: compactSession });
}
const compactSnapshot = await memoryStore.compaction!.snapshot({ scope: compactSession });
const sessionRow = await db.orm.public.AgentMemorySession
  .where((s) => s.sessionId.eq(compactSession.sessionId))
  .select('sessionId', 'compactionState')
  .first();
const allMessages = await memoryStore.load({ scope: compactSession });
const compacted = sessionRow?.compactionState != null;
check(
  '7. Compaction: a summary checkpoint replaces the older prefix',
  compacted,
  `compactionState=${JSON.stringify(sessionRow?.compactionState ?? null).slice(0, 160)} projected=${compactSnapshot.messages.length} canonical=${allMessages.length}`,
);

// -------------------------------------------------------------------- summary
console.log('\n---');
const failed = results.filter((result) => !result.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) console.log('failed:', failed.map((f) => f.name).join('; '));

await stub.close();
await db.close();
process.exitCode = failed.length === 0 ? 0 : 1;