import { db } from '../../prisma/db.ts';

export type Category = 'food' | 'transport' | 'bills' | 'fun' | 'other';

export type Expense = {
  id: string;
  userId: string;
  description: string;
  amountIdr: number;
  category: Category;
  spentOn: string;
};

export type ExpenseService = {
  add(input: Omit<Expense, 'id'>): Promise<Expense>;
  list(input: { userId: string; from?: string; to?: string; limit: number }): Promise<Expense[]>;
  summarize(input: { userId: string; from?: string; to?: string }): Promise<{
    total: number;
    byCategory: { category: Category; total: number; count: number }[];
  }>;
  remove(input: { userId: string; id: string }): Promise<boolean>;
};

const SELECT = ['id', 'userId', 'description', 'amountIdr', 'category', 'spentOn'] as const;

export const expenseService: ExpenseService = {
  async add(input) {
    const row = await db.orm.public.Expense.select(...SELECT).create({
      userId: input.userId,
      description: input.description,
      amountIdr: input.amountIdr,
      category: input.category,
      spentOn: input.spentOn,
    });
    return row as Expense;
  },

  async list({ userId, from, to, limit }) {
    let collection = db.orm.public.Expense.where((e) => e.userId.eq(userId));
    if (from !== undefined) collection = collection.where((e) => e.spentOn.gte(from));
    if (to !== undefined) collection = collection.where((e) => e.spentOn.lte(to));
    const rows = await collection
      .select(...SELECT)
      .orderBy((e) => e.spentOn.desc())
      .limit(limit)
      .all();
    return rows as Expense[];
  },

  async summarize({ userId, from, to }) {
    const rows = await this.list({
      userId,
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
      limit: 10_000,
    });
    const buckets = new Map<Category, { total: number; count: number }>();
    let total = 0;
    for (const row of rows) {
      total += row.amountIdr;
      const bucket = buckets.get(row.category) ?? { total: 0, count: 0 };
      bucket.total += row.amountIdr;
      bucket.count += 1;
      buckets.set(row.category, bucket);
    }
    const byCategory = [...buckets.entries()]
      .map(([category, bucket]) => ({ category, ...bucket }))
      .sort((left, right) => right.total - left.total);
    return { total, byCategory };
  },

  async remove({ userId, id }) {
    const existing = await db.orm.public.Expense
      .where({ id })
      .where((e) => e.userId.eq(userId))
      .select('id')
      .first();
    if (existing === null) return false;
    await db.orm.public.Expense.where({ id }).delete();
    return true;
  },
};