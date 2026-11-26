// Server Actions for creating expenses, running AI reviews, and recording decisions

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { reviewExpenseWithAi } from "@/lib/llm/review-expense";
import {
  getEmployeeById,
  getExpenseWithContextById,
  insertExpense,
  updateExpenseStatus,
  upsertExpenseReview,
} from "@/lib/db/queries";
import type { Expense, ExpenseReview } from "@/types/expense";

const createExpenseSchema = z.object({
  employee_id: z.string().min(1),
  expense_date: z.string().min(1),
  submitted_date: z.string().min(1),
  category: z.string().min(1),
  merchant: z.string().min(1),
  amount_usd: z.coerce.number().positive(),
  city: z.string().min(1),
  receipt_attached: z.boolean().default(false),
  attendees: z.string().nullable().optional(),
  description: z.string().min(1),
});

const decisionSchema = z.object({
  expense_id: z.string().min(1),
  approver_id: z.string().min(1),
  status: z.enum(["approved", "rejected"]),
  decision_comment: z.string().nullable().optional(),
});

export async function createExpenseAction(rawInput: unknown): Promise<{
  ok: boolean;
  expense?: Expense;
  review?: ExpenseReview;
  error?: string;
}> {
  const parsed = createExpenseSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid expense input",
    };
  }

  const employee = await getEmployeeById(parsed.data.employee_id);
  if (!employee) {
    return { ok: false, error: "Employee not found" };
  }

  const expense = await insertExpense({
    ...parsed.data,
    attendees: parsed.data.attendees ?? null,
    status: "pending",
    approver_id: employee.manager_id,
    decided_date: null,
    decision_comment: null,
  });

  // Automatically run AI + deterministic policy review on submission
  const generated = await reviewExpenseWithAi({ expense, employee });
  const review = await upsertExpenseReview(generated);

  revalidatePath("/expenses");
  revalidatePath("/manager");
  revalidatePath(`/expenses/${expense.expense_id}`);

  return { ok: true, expense, review };
}

export async function runExpenseReviewAction(expenseId: string): Promise<{
  ok: boolean;
  review?: ExpenseReview;
  error?: string;
}> {
  const ctx = await getExpenseWithContextById(expenseId);
  if (!ctx) {
    return { ok: false, error: "Expense not found" };
  }

  const generated = await reviewExpenseWithAi({
    expense: ctx.expense,
    employee: ctx.employee,
  });
  const review = await upsertExpenseReview(generated);

  revalidatePath("/expenses");
  revalidatePath("/manager");
  revalidatePath(`/expenses/${expenseId}`);

  return { ok: true, review };
}

export async function decideExpenseAction(rawInput: unknown): Promise<{
  ok: boolean;
  error?: string;
}> {
  const parsed = decisionSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid decision input",
    };
  }

  const ctx = await getExpenseWithContextById(parsed.data.expense_id);
  if (!ctx) {
    return { ok: false, error: "Expense not found" };
  }

  if (parsed.data.approver_id === ctx.expense.employee_id) {
    return {
      ok: false,
      error: "Employees cannot approve or reject their own expense",
    };
  }

  await updateExpenseStatus({
    expense_id: parsed.data.expense_id,
    approver_id: parsed.data.approver_id,
    status: parsed.data.status,
    decided_date: new Date().toISOString().slice(0, 10),
    decision_comment: parsed.data.decision_comment ?? null,
  });

  revalidatePath("/expenses");
  revalidatePath("/manager");
  revalidatePath(`/expenses/${parsed.data.expense_id}`);

  return { ok: true };
}