// Create expenses and trigger initial policy + Gemini review

import { NextResponse } from "next/server";
import { z } from "zod";
import { reviewExpenseWithGemini } from "@/lib/llm";
import {
  getEmployeeById,
  insertExpense,
  upsertExpenseReview,
} from "@/lib/db/queries";

const postExpenseSchema = z.object({
  employee_id: z.string().min(1),
  expense_date: z.string().min(1),
  submitted_date: z.string().min(1),
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
    const body = await request.json();
    const parsed = postExpenseSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const employee = await getEmployeeById(parsed.data.employee_id);
    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    const expense = await insertExpense({
      ...parsed.data,
      status: "pending",
      approver_id: employee.manager_id,
      decided_date: null,
      decision_comment: null,
    });

    const generated = await reviewExpenseWithGemini({ expense, employee });
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