// src/app/expenses/page.tsx: Session-authenticated expense submission and personal list

import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth/session";
import { isApproverRole } from "@/lib/auth/permissions";
import { listExpensesForEmployee } from "@/lib/db/queries";
import { createExpenseAction } from "./actions";

async function ExpensesContent() {
  const actor = await getCurrentEmployee();
  if (!actor) {
    redirect("/");
  }

  const items = await listExpensesForEmployee(actor.employee_id);
  const todayIso = new Date().toISOString().slice(0, 10);
  const canAccessQueue = isApproverRole(actor);

  async function handleSubmitExpense(formData: FormData) {
    "use server";
    const expenseDate = String(formData.get("expense_date") ?? "");
    const submittedDate = String(formData.get("submitted_date") ?? todayIso);
    const category = String(formData.get("category") ?? "");
    const merchant = String(formData.get("merchant") ?? "");
    const amountRaw = String(formData.get("amount_usd") ?? "0");
    const city = String(formData.get("city") ?? "");
    const receiptAttached = formData.get("receipt_attached") === "on";
    const attendeesRaw = String(formData.get("attendees") ?? "").trim();
    const description = String(formData.get("description") ?? "");

    const res = await createExpenseAction({
      expense_date: expenseDate,
      submitted_date: submittedDate,
      category,
      merchant,
      amount_usd: Number(amountRaw),
      city,
      receipt_attached: receiptAttached,
      attendees: attendeesRaw.length > 0 ? attendeesRaw : null,
      description,
    });

    if (res.ok && res.expense) {
      redirect(`/expenses/${res.expense.expense_id}`);
    }
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-2xl font-semibold">My Expenses</h1>
          <p className="text-sm text-neutral-600">
            {actor.full_name} · {actor.department} · {actor.location} · Home
            Office YTD: ${actor.home_office_spent_ytd_usd.toFixed(2)} / $500.00
          </p>
        </div>

        {canAccessQueue && (
          <Link
            href="/manager"
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-neutral-50"
          >
            Approver Queue →
          </Link>
        )}
      </header>

      <section className="space-y-4 rounded-lg border p-5">
        <h2 className="text-lg font-semibold">Submit New Expense</h2>

        <form action={handleSubmitExpense} className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium uppercase text-neutral-600">
              Category
            </label>
            <input
              type="text"
              name="category"
              required
              placeholder="Meals, Lodging, Team Meal, Home Office..."
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium uppercase text-neutral-600">
              Merchant
            </label>
            <input
              type="text"
              name="merchant"
              required
              placeholder="Marriott, Delta, Local Bistro..."
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium uppercase text-neutral-600">
              Amount (USD)
            </label>
            <input
              type="number"
              name="amount_usd"
              step="0.01"
              min="0.01"
              required
              placeholder="85.00"
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium uppercase text-neutral-600">
              City
            </label>
            <input
              type="text"
              name="city"
              required
              placeholder="New York, Chicago, Austin..."
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium uppercase text-neutral-600">
              Expense Date
            </label>
            <input
              type="date"
              name="expense_date"
              defaultValue={todayIso}
              required
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium uppercase text-neutral-600">
              Submitted Date
            </label>
            <input
              type="date"
              name="submitted_date"
              defaultValue={todayIso}
              required
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-medium uppercase text-neutral-600">
              Attendees (if meal / client event)
            </label>
            <input
              type="text"
              name="attendees"
              placeholder="Names and companies (e.g., Jane Doe - Acme Corp)"
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-medium uppercase text-neutral-600">
              Business Purpose / Description
            </label>
            <textarea
              name="description"
              rows={2}
              required
              placeholder="Describe the business context, trip/event, or pre-approval details..."
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          <div className="sm:col-span-2 flex items-center justify-between gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="receipt_attached"
                className="h-4 w-4 rounded border"
              />
              <span>Itemized receipt attached</span>
            </label>

            <button
              type="submit"
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Submit &amp; Run Policy Review
            </button>
          </div>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Submitted Expenses ({items.length})
        </h2>

        {items.length === 0 ? (
          <p className="rounded-lg border p-4 text-sm text-neutral-600">
            No expenses submitted for {actor.full_name} yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-neutral-50 text-xs uppercase text-neutral-600">
                <tr>
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">Merchant &amp; Category</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Audit Verdict</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map(({ expense, review }) => (
                  <tr key={expense.expense_id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 font-mono text-xs">
                      {expense.expense_id}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{expense.merchant}</div>
                      <div className="text-xs text-neutral-500">
                        {expense.category} · {expense.city}
                      </div>
                    </td>
                    <td className="px-4 py-3">{expense.expense_date}</td>
                    <td className="px-4 py-3 font-medium">
                      ${expense.amount_usd.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-xs uppercase">
                      {review ? review.verdict.replace("_", " ") : "Unreviewed"}
                    </td>
                    <td className="px-4 py-3 capitalize">{expense.status}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/expenses/${expense.expense_id}`}
                        className="text-sm font-medium underline hover:text-neutral-600"
                      >
                        Inspect
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default function ExpensesPage() {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <Suspense
        fallback={<p className="text-sm text-neutral-600">Loading expenses...</p>}
      >
        <ExpensesContent />
      </Suspense>
    </main>
  );
}