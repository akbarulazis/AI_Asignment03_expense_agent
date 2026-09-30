import { createTool } from '@anvia/core';
import { z } from 'zod';
import type { ExpenseService } from '../services/expense-service.ts';

const categorySchema = z.enum(['food', 'transport', 'bills', 'fun', 'other']);
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an ISO date, for example 2026-09-23.')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'That date does not exist.');

export type ExpenseToolDeps = {
  service: ExpenseService;
  /**
   * Tools receive no session or user from the agent runtime, so the owning user
   * is injected here when the tools are built.
   */
  userId: string;
};

function money(amountIdr: number): string {
  return `IDR ${amountIdr.toLocaleString('id-ID')}`;
}

export function createExpenseTools(deps: ExpenseToolDeps) {
  const addExpense = createTool({
    name: 'addExpense',
    description:
      'Record one expense for the user. Amounts are whole rupiah. Use this whenever the user says they spent something.',
    inputSchema: z.object({
      description: z.string().min(1).max(200),
      amountIdr: z.number().int().positive(),
      category: categorySchema,
      spentOn: dateSchema,
    }),
    execute: async (args) => {
      const row = await deps.service.add({ userId: deps.userId, ...args });
      return `Recorded ${money(row.amountIdr)} for "${row.description}" (${row.category}) on ${row.spentOn}. Expense id: ${row.id}`;
    },
  });

  const listExpenses = createTool({
    name: 'listExpenses',
    description:
      'List the user\'s recorded expenses, newest first. Optionally filter by an inclusive date range.',
    inputSchema: z.object({
      from: dateSchema.optional(),
      to: dateSchema.optional(),
      limit: z.number().int().min(1).max(50).default(10),
    }),
    execute: async (args) => {
      const rows = await deps.service.list({
        userId: deps.userId,
        ...(args.from !== undefined ? { from: args.from } : {}),
        ...(args.to !== undefined ? { to: args.to } : {}),
        limit: args.limit,
      });
      if (rows.length === 0) return 'No expenses recorded for that range.';
      return rows
        .map((row) => `${row.spentOn} | ${money(row.amountIdr)} | ${row.category} | ${row.description} | id=${row.id}`)
        .join('\n');
    },
  });

  const summarizeSpending = createTool({
    name: 'summarizeSpending',
    description:
      'Total the user\'s spending and break it down by category, optionally within an inclusive date range.',
    inputSchema: z.object({
      from: dateSchema.optional(),
      to: dateSchema.optional(),
    }),
    execute: async (args) => {
      const summary = await deps.service.summarize({
        userId: deps.userId,
        ...(args.from !== undefined ? { from: args.from } : {}),
        ...(args.to !== undefined ? { to: args.to } : {}),
      });
      if (summary.total === 0) return 'No expenses recorded for that range.';
      const lines = summary.byCategory.map(
        (bucket) => `${bucket.category}: ${money(bucket.total)} across ${bucket.count} expense(s)`,
      );
      return [`Total: ${money(summary.total)}`, ...lines].join('\n');
    },
  });

  const deleteExpense = createTool({
    name: 'deleteExpense',
    description:
      'Delete one expense by its id. Call listExpenses first if you do not already know the id.',
    inputSchema: z.object({ id: z.string().min(1) }),
    execute: async (args) => {
      const removed = await deps.service.remove({ userId: deps.userId, id: args.id });
      return removed
        ? `Deleted expense ${args.id}.`
        : `No expense with id ${args.id} belongs to this user. Nothing was deleted.`;
    },
  });

  return [addExpense, listExpenses, summarizeSpending, deleteExpense];
}