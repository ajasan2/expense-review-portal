// Approve or reject an expense

import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentEmployee } from "@/lib/auth/session";
import { canDecideExpense } from "@/lib/auth/permissions";
import {
  getExpenseWithContextById,
  updateExpenseStatus,
} from "@/lib/db/queries";

const decisionBodySchema = z.object({
  status: z.enum(["approved", "rejected"]),
  decision_comment: z.string().nullable().optional().default(null),
});

export async function POST(
  request: Request,
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
      !canDecideExpense(
        actor,
        ctx.expense,
        ctx.employee.manager_id,
        ctx.employee.role
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Not authorized to approve or reject this expense at its current stage",
        },
        { status: 403 }
      );
    }

    const body = await request.json();
    const parsed = decisionBodySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid decision payload", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const normalizedComment =
      parsed.data.decision_comment && parsed.data.decision_comment.trim().length > 0
        ? parsed.data.decision_comment.trim()
        : null;

    const updated = await updateExpenseStatus({
      expense_id: id,
      approver_id: actor.employee_id,
      actor_role: actor.role,
      decision: parsed.data.status,
      decided_date: new Date().toISOString().slice(0, 10),
      decision_comment: normalizedComment,
    });

    revalidatePath("/expenses");
    revalidatePath("/manager");
    revalidatePath(`/expenses/${id}`);

    return NextResponse.json({ expense: updated });
  } catch (err) {
    console.error("POST /api/expenses/[id]/decision failed:", err);
    return NextResponse.json(
      { error: "Failed to update expense decision" },
      { status: 500 }
    );
  }
}