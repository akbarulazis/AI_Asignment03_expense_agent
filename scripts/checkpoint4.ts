import { startStubModel, useStubModel } from './stub-model.ts';
import { createExpenseTools } from '../src/tools/expense-tools.ts';
import { expenseService } from '../src/services/expense-service.ts';
import { db } from '../prisma/db.ts';

const stub = await startStubModel(4310);
useStubModel(4310);
const [addExpense, listExpenses] = createExpenseTools({
  service: expenseService,
  userId: 'tutorial-user',
}) as any[];

console.log(await addExpense.call({
  description: 'nasi padang', amountIdr: 50000, category: 'food', spentOn: '2026-09-20',
}));
console.log(await listExpenses.call({ limit: 5 }));

try {
  await addExpense.call({
    description: 'bad', amountIdr: 1000, category: 'food', spentOn: '20-09-2026',
  });
  console.log('BUG: bad date accepted');
} catch {
  console.log('bad date rejected, as expected');
}

await stub.close();
await db.close();