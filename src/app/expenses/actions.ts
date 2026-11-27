import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { canDecideExpense, canRunExpenseReview, canViewExpense } from "@/lib/auth/permissions";
import { reviewExpenseWithAi } from "@/lib/llm";
import {
  getExpenseWithContextById,
  insertExpense,
  updateExpenseStatus,
  upsertExpenseReview,
} from "@/lib/db/queries";
import type { Expense, ExpenseReview } from "@/types/expense";

const createExpenseSchema = z.object({
  expense_date: z.string().min(1),
  submitted_date: z.string().optional(),
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
  status: z.enum(["approved", "rejected"]),
  decision_comment: z.string().nullable().optional(),
});

export async function createExpenseAction(rawInput: unknown): Promise<{
  ok: boolean;
  expense?: Expense;
  review?: ExpenseReview;
  error?: string;
}> {
  let actor;
  try {
    actor = await requireCurrentEmployee();
  } catch {
    return { ok: false, error: "Authentication required" };
  }

  const parsed = createExpenseSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid expense input",
    };
  }

  const submittedDate = new Date().toISOString().slice(0, 10);

  const expense = await insertExpense({
    ...parsed.data,
    submitted_date: submittedDate,
    employee_id: actor.employee_id,
    attendees: parsed.data.attendees ?? null,
    status: "pending",
    approver_id: actor.manager_id,
    decided_date: null,
    decision_comment: null,
  });

  const generated = await reviewExpenseWithAi({ expense, employee: actor });
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
  let actor;
  try {
    actor = await requireCurrentEmployee();
  } catch {
    return { ok: false, error: "Authentication required" };
  }

  const ctx = await getExpenseWithContextById(expenseId);
  if (!ctx) {
    return { ok: false, error: "Expense not found" };
  }

  const submitterManagerId = ctx.employee?.manager_id ?? null;
  if (!canRunExpenseReview(actor) || !canViewExpense(actor, ctx.expense, submitterManagerId)) {
    return { ok: false, error: "Only approvers can run or re-run policy reviews" };
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
  let actor;
  try {
    actor = await requireCurrentEmployee();
  } catch {
    return { ok: false, error: "Authentication required" };
  }

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

  const submitterManagerId = ctx.employee?.manager_id ?? null;
  if (!canDecideExpense(actor, ctx.expense, submitterManagerId)) {
    return {
      ok: false,
      error: "Not authorized to approve or reject this expense",
    };
  }

  const normalizedComment =
    parsed.data.decision_comment && parsed.data.decision_comment.trim().length > 0
      ? parsed.data.decision_comment.trim()
      : null;

  await updateExpenseStatus({
    expense_id: parsed.data.expense_id,
    approver_id: actor.employee_id,
    status: parsed.data.status,
    decided_date: new Date().toISOString().slice(0, 10),
    decision_comment: normalizedComment,
  });

  revalidatePath("/expenses");
  revalidatePath("/manager");
  revalidatePath(`/expenses/${parsed.data.expense_id}`);

  return { ok: true };
}