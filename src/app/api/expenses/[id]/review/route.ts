// Trigger policy + AI review for a single expense

import { NextResponse } from "next/server";
import { getCurrentEmployee } from "@/lib/auth/session";
import { canRunExpenseReview, canViewExpense } from "@/lib/auth/permissions";
import { reviewExpenseWithAi } from "@/lib/llm";
import { evaluateDeterministicPolicy } from "@/lib/policy/rules";
import {
  getExpenseWithContextById,
  listRawExpensesByEmployee,
  upsertExpenseReview,
} from "@/lib/db/queries";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getCurrentEmployee();
    if (!actor) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const { id } = await context.params;
    const ctx = await getExpenseWithContextById(id);

    if (!ctx) {
      return NextResponse.json({ error: "Expense not found" }, { status: 404 });
    }

    if (
      !canRunExpenseReview(actor) ||
      !canViewExpense(actor, ctx.expense, ctx.employee.manager_id)
    ) {
      return NextResponse.json(
        { error: "Only approvers can run or re-run policy reviews" },
        { status: 403 }
      );
    }

    const employeeExpenses = await listRawExpensesByEmployee(
      ctx.expense.employee_id
    );
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
    const reimbursableAmountUsd =
      deterministic.suggestedReimbursableAmountUsd !== null &&
      generated.reimbursable_amount_usd !== null
        ? Math.min(
            deterministic.suggestedReimbursableAmountUsd,
            generated.reimbursable_amount_usd
          )
        : (deterministic.suggestedReimbursableAmountUsd ??
          generated.reimbursable_amount_usd);

    const saved = await upsertExpenseReview({
      ...generated,
      verdict,
      findings: mergedFindings,
      reimbursable_amount_usd: reimbursableAmountUsd,
    });

    return NextResponse.json({ review: saved });
  } catch (err) {
    console.error("POST /api/expenses/[id]/review failed:", err);
    return NextResponse.json(
      { error: "Failed to review expense" },
      { status: 500 }
    );
  }
}