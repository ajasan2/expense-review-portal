// Expense detail view with policy/llm audit findings and decision controls

import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getExpenseWithContextById, listEmployees } from "@/lib/db/queries";
import { decideExpenseAction, runExpenseReviewAction } from "../actions";

async function ExpenseDetailContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getExpenseWithContextById(id);

  if (!ctx) {
    notFound();
  }

  const employees = await listEmployees();
  const approvers = employees.filter(
    (emp) =>
      emp.employee_id !== ctx.expense.employee_id &&
      (emp.role === "manager" || emp.role === "director" || emp.role === "executive")
  );
  const defaultApproverId =
    ctx.expense.approver_id ?? approvers[0]?.employee_id ?? "";

  async function handleRunReview() {
    "use server";
    await runExpenseReviewAction(id);
  }

  async function handleDecision(formData: FormData) {
    "use server";
    const approverId = String(formData.get("approver_id") ?? "");
    const status = String(formData.get("status") ?? "");
    const commentRaw = String(formData.get("decision_comment") ?? "").trim();

    if (status !== "approved" && status !== "rejected") return;

    await decideExpenseAction({
      expense_id: id,
      approver_id: approverId,
      status,
      decision_comment: commentRaw.length > 0 ? commentRaw : null,
    });
  }

  const { expense, employee, approver, review } = ctx;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link
            href="/expenses"
            className="text-sm text-neutral-500 hover:underline"
          >
            ← Back to Expenses
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">
            {expense.expense_id} — {expense.merchant}
          </h1>
          <p className="text-sm text-neutral-600">
            Submitted by {employee.full_name} ({employee.department} ·{" "}
            {employee.location}) on {expense.submitted_date}
          </p>
        </div>

        <form action={handleRunReview}>
          <button
            type="submit"
            className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-neutral-50"
          >
            Run / Re-run Policy Review
          </button>
        </form>
      </div>

      <section className="grid gap-4 rounded-lg border p-4 sm:grid-cols-3">
        <div>
          <div className="text-xs uppercase text-neutral-500">Amount</div>
          <div className="text-lg font-semibold">
            ${expense.amount_usd.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase text-neutral-500">Status</div>
          <div className="text-lg font-semibold capitalize">{expense.status}</div>
        </div>
        <div>
          <div className="text-xs uppercase text-neutral-500">
            Category &amp; City
          </div>
          <div className="text-sm font-medium">
            {expense.category} · {expense.city}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase text-neutral-500">Expense Date</div>
          <div className="text-sm">{expense.expense_date}</div>
        </div>
        <div>
          <div className="text-xs uppercase text-neutral-500">Receipt</div>
          <div className="text-sm">
            {expense.receipt_attached ? "Attached" : "Not attached"}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase text-neutral-500">Approver</div>
          <div className="text-sm">
            {approver ? `${approver.full_name} (${approver.role})` : "Unassigned"}
          </div>
        </div>
        <div className="sm:col-span-3">
          <div className="text-xs uppercase text-neutral-500">Description</div>
          <p className="mt-1 text-sm">{expense.description}</p>
        </div>
        {expense.attendees && (
          <div className="sm:col-span-3">
            <div className="text-xs uppercase text-neutral-500">Attendees</div>
            <p className="mt-1 text-sm">{expense.attendees}</p>
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">
            Policy &amp; Gemini Audit Review
          </h2>
          {review && (
            <span className="rounded bg-neutral-100 px-2.5 py-1 text-xs font-medium uppercase">
              Verdict: {review.verdict.replace("_", " ")}
            </span>
          )}
        </div>

        {!review ? (
          <p className="text-sm text-neutral-600">
            No review recorded yet. Click &ldquo;Run / Re-run Policy Review&rdquo;
            above to evaluate this expense.
          </p>
        ) : (
          <>
            <p className="text-sm text-neutral-700">{review.summary}</p>
            <div className="text-sm">
              <span className="font-medium">Suggested Reimbursable Amount: </span>
              {review.reimbursable_amount_usd !== null
                ? `$${review.reimbursable_amount_usd.toFixed(2)}`
                : "Manual determination required"}
            </div>

            <div className="space-y-2 pt-2">
              <div className="text-xs font-semibold uppercase text-neutral-500">
                Findings ({review.findings.length})
              </div>
              {review.findings.length === 0 ? (
                <p className="text-sm text-neutral-600">
                  No rule issues or flags reported.
                </p>
              ) : (
                <ul className="space-y-2">
                  {review.findings.map((finding, idx) => (
                    <li
                      key={`${finding.section}-${finding.rule_title}-${idx}`}
                      className="rounded border p-3 text-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">
                          [{finding.section}] {finding.rule_title}
                        </span>
                        <span className="text-xs uppercase text-neutral-600">
                          {finding.status.replace("_", " ")}
                        </span>
                      </div>
                      <p className="mt-1 text-neutral-700">{finding.detail}</p>
                      {typeof finding.reimbursable_amount_usd === "number" && (
                        <div className="mt-1 text-xs text-neutral-500">
                          Capped amount: ${finding.reimbursable_amount_usd.toFixed(2)}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </section>

      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="text-lg font-semibold">Record Approval Decision</h2>
        {expense.status !== "pending" && (
          <p className="text-sm text-neutral-600">
            Current status: <strong className="capitalize">{expense.status}</strong>
            {expense.decided_date ? ` on ${expense.decided_date}` : ""}
            {expense.decision_comment ? ` — "${expense.decision_comment}"` : ""}
          </p>
        )}

        <form action={handleDecision} className="space-y-3">
          <div>
            <label className="block text-xs font-medium uppercase text-neutral-600">
              Approver
            </label>
            <select
              name="approver_id"
              defaultValue={defaultApproverId}
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              required
            >
              {approvers.map((emp) => (
                <option key={emp.employee_id} value={emp.employee_id}>
                  {emp.full_name} ({emp.role} · {emp.employee_id})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium uppercase text-neutral-600">
              Decision Comment (Optional)
            </label>
            <input
              type="text"
              name="decision_comment"
              defaultValue={expense.decision_comment ?? ""}
              placeholder="Add rationale or policy note..."
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              name="status"
              value="approved"
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Approve Expense
            </button>
            <button
              type="submit"
              name="status"
              value="rejected"
              className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              Reject Expense
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default function ExpenseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <main className="mx-auto max-w-4xl p-6">
      <Suspense
        fallback={
          <p className="text-sm text-neutral-600">
            Loading expense audit details...
          </p>
        }
      >
        <ExpenseDetailContent params={params} />
      </Suspense>
    </main>
  );
}