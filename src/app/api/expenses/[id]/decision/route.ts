// src/app/api/expenses/[id]/decision/route.ts: Approve or reject an expense

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getExpenseWithContextById,
  updateExpenseStatus,
} from "@/lib/db/queries";

const decisionBodySchema = z.object({
  approver_id: z.string().min(1),
  status: z.enum(["approved", "rejected"]),
  decision_comment: z.string().nullable().optional().default(null),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const ctx = await getExpenseWithContextById(id);

    if (!ctx) {
      return NextResponse.json({ error: "Expense not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = decisionBodySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid decision payload", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    if (parsed.data.approver_id === ctx.expense.employee_id) {
      return NextResponse.json(
        { error: "Employees cannot approve or reject their own expense" },
        { status: 403 }
      );
    }

    const updated = await updateExpenseStatus({
      expense_id: id,
      approver_id: parsed.data.approver_id,
      status: parsed.data.status,
      decided_date: new Date().toISOString().slice(0, 10),
      decision_comment: parsed.data.decision_comment,
    });

    return NextResponse.json({ expense: updated });
  } catch (err) {
    console.error("POST /api/expenses/[id]/decision failed:", err);
    return NextResponse.json(
      { error: "Failed to update expense decision" },
      { status: 500 }
    );
  }
}