import { PrismaMemoryStore } from '@anvia/memory-prisma/v8';
import { db } from '../prisma/db.ts';

export const memoryStore = new PrismaMemoryStore({
  client: db,
  scopeKey: { includeUserId: false },
});

export async function validateMemory(): Promise<void> {
  await memoryStore.validate();
}