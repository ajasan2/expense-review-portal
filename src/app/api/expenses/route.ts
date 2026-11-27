// Create expenses and trigger initial policy + AI review

import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentEmployee } from "@/lib/auth/session";
import { reviewExpenseWithAi } from "@/lib/llm";
import { insertExpense, upsertExpenseReview } from "@/lib/db/queries";

const postExpenseSchema = z.object({
  expense_date: z.string().min(1),
  submitted_date: z.string().optional(),
  category: z.string().min(1),
  merchant: z.string().min(1),
  amount_usd: z.coerce.number().positive(),
  city: z.string().min(1),
  receipt_attached: z.boolean().optional().default(false),
  attendees: z.string().nullable().optional().default(null),
  description: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const actor = await getCurrentEmployee();
    if (!actor) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const parsed = postExpenseSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const submittedDate = new Date().toISOString().slice(0, 10);

    const expense = await insertExpense({
      ...parsed.data,
      submitted_date: submittedDate,
      employee_id: actor.employee_id,
      status: "pending",
      approver_id: actor.manager_id,
      decided_date: null,
      decision_comment: null,
    });

    const generated = await reviewExpenseWithAi({ expense, employee: actor });
    const review = await upsertExpenseReview(generated);

    return NextResponse.json({ expense, review }, { status: 201 });
  } catch (err) {
    console.error("POST /api/expenses failed:", err);
    return NextResponse.json(
      { error: "Failed to create expense" },
      { status: 500 }
    );
  }
}