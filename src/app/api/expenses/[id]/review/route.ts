// Trigger policy + AI review for a single expense

import { NextResponse } from "next/server";
import { getCurrentEmployee } from "@/lib/auth/session";
import { canRunExpenseReview, canViewExpense } from "@/lib/auth/permissions";
import { reviewExpenseWithAi } from "@/lib/llm";
import {
  getExpenseWithContextById,
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

    const generated = await reviewExpenseWithAi({
      expense: ctx.expense,
      employee: ctx.employee,
    });
    const saved = await upsertExpenseReview(generated);

    return NextResponse.json({ review: saved });
  } catch (err) {
    console.error("POST /api/expenses/[id]/review failed:", err);
    return NextResponse.json(
      { error: "Failed to review expense" },
      { status: 500 }
    );
  }
}