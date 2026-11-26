// Trigger policy + AI review for a single expense

import { NextResponse } from "next/server";
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
    const { id } = await context.params;
    const ctx = await getExpenseWithContextById(id);

    if (!ctx) {
      return NextResponse.json({ error: "Expense not found" }, { status: 404 });
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