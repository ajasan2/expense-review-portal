import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCurrentEmployee } from "@/lib/auth/session";
import {
  canDecideExpense,
  canRunExpenseReview,
  canViewExpense,
} from "@/lib/auth/permissions";
import { reviewExpenseWithAi } from "@/lib/llm";
import { evaluateDeterministicPolicy } from "@/lib/policy/rules";
import { findPotentialSplitExpenses } from "@/lib/policy/split-billing";
import {
  getExpenseWithContextById,
  insertExpense,
  listRawExpensesByEmployee,
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

  const employeeExpenses = await listRawExpensesByEmployee(actor.employee_id);
  const relatedExpenses = employeeExpenses.filter(
    (item) => item.expense_id !== expense.expense_id
  );

  const deterministic = evaluateDeterministicPolicy(expense, actor, relatedExpenses);
  const generated = await reviewExpenseWithAi({ expense, employee: actor });
  const mergedFindings = [
    ...deterministic.findings.filter((f) => f.section === "2.4"),
    ...generated.findings,
  ];
  const verdict =
    deterministic.deterministicVerdict === "policy_violation" ||
    generated.verdict === "policy_violation"
      ? "policy_violation"
      : generated.verdict;

  const review = await upsertExpenseReview({
    ...generated,
    verdict,
    findings: mergedFindings,
    reimbursable_amount_usd:
      deterministic.suggestedReimbursableAmountUsd !== null &&
      generated.reimbursable_amount_usd !== null
        ? Math.min(
            deterministic.suggestedReimbursableAmountUsd,
            generated.reimbursable_amount_usd
          )
        : (deterministic.suggestedReimbursableAmountUsd ??
          generated.reimbursable_amount_usd),
  });

  const splitMatch = findPotentialSplitExpenses(expense, relatedExpenses);
  for (const prior of splitMatch.matchedExpenses) {
    const othersForPrior = employeeExpenses.filter(
      (item) => item.expense_id !== prior.expense_id
    );
    const priorEval = evaluateDeterministicPolicy(prior, actor, othersForPrior);
    await upsertExpenseReview({
      expense_id: prior.expense_id,
      verdict: priorEval.deterministicVerdict,
      findings: priorEval.findings,
      reimbursable_amount_usd: priorEval.suggestedReimbursableAmountUsd,
      summary: `Deterministic policy check updated for potential split billing (${priorEval.findings.length} finding(s)).`,
      model_name: "deterministic-policy",
    });
    revalidatePath(`/expenses/${prior.expense_id}`);
  }

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
  if (
    !canRunExpenseReview(actor) ||
    !canViewExpense(actor, ctx.expense, submitterManagerId)
  ) {
    return {
      ok: false,
      error: "Only approvers can run or re-run policy reviews",
    };
  }

  const employeeExpenses = await listRawExpensesByEmployee(ctx.expense.employee_id);
  const relatedExpenses = employeeExpenses.filter(
    (item) => item.expense_id !== ctx.expense.expense_id
  );
  const deterministic = evaluateDeterministicPolicy(
    ctx.expense,
    ctx.employee,
    relatedExpenses
  );
  const generated = await reviewExpenseWithAi({
    expense: ctx.expense,
    employee: ctx.employee,
  });
  const mergedFindings = [
    ...deterministic.findings.filter((f) => f.section === "2.4"),
    ...generated.findings,
  ];
  const verdict =
    deterministic.deterministicVerdict === "policy_violation" ||
    generated.verdict === "policy_violation"
      ? "policy_violation"
      : generated.verdict;

  const review = await upsertExpenseReview({
    ...generated,
    verdict,
    findings: mergedFindings,
    reimbursable_amount_usd:
      deterministic.suggestedReimbursableAmountUsd !== null &&
      generated.reimbursable_amount_usd !== null
        ? Math.min(
            deterministic.suggestedReimbursableAmountUsd,
            generated.reimbursable_amount_usd
          )
        : (deterministic.suggestedReimbursableAmountUsd ??
          generated.reimbursable_amount_usd),
  });

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
  if (
    !canDecideExpense(actor, ctx.expense, submitterManagerId, ctx.employee?.role)
  ) {
    return {
      ok: false,
      error: "Not authorized to approve or reject this expense at its current stage",
    };
  }

  const normalizedComment =
    parsed.data.decision_comment && parsed.data.decision_comment.trim().length > 0
      ? parsed.data.decision_comment.trim()
      : null;

  await updateExpenseStatus({
    expense_id: parsed.data.expense_id,
    approver_id: actor.employee_id,
    actor_role: actor.role,
    decision: parsed.data.status,
    decided_date: new Date().toISOString().slice(0, 10),
    decision_comment: normalizedComment,
  });

  revalidatePath("/expenses");
  revalidatePath("/manager");
  revalidatePath(`/expenses/${parsed.data.expense_id}`);

  return { ok: true };
}