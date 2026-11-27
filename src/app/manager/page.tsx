// Pending expense review queue guarded by session and approver role

import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth/session";
import { isApproverRole } from "@/lib/auth/permissions";
import { listPendingExpensesForApprover } from "@/lib/db/queries";

async function ManagerQueueContent() {
  const actor = await getCurrentEmployee();
  if (!actor) {
    redirect("/");
  }

  if (!isApproverRole(actor)) {
    return (
      <div className="w-full space-y-4 rounded-lg border p-6">
        <h1 className="text-xl font-semibold">Not Authorized</h1>
        <p className="text-sm text-neutral-600">
          Your role ({actor.role}) does not have access to the approver queue.
        </p>
        <Link
          href="/expenses"
          className="inline-block rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-neutral-50"
        >
          ← Back to My Expenses
        </Link>
      </div>
    );
  }

  const queue = await listPendingExpensesForApprover(actor);

  return (
    <div className="w-full min-w-0 space-y-6">
      <header className="flex min-w-0 flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Approver Review Queue</h1>
          <p className="break-words text-sm text-neutral-600">
            Signed in as <strong>{actor.full_name}</strong> ({actor.role}) ·
            Halcyon Policy v3.2
          </p>
        </div>

        <Link
          href="/expenses"
          className="shrink-0 whitespace-nowrap rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-neutral-50"
        >
          ← My Expenses
        </Link>
      </header>

      {queue.length === 0 ? (
        <div className="w-full rounded-lg border p-6 text-sm text-neutral-600">
          No pending expenses in the queue for <strong>{actor.full_name}</strong>{" "}
          ({actor.role}).
        </div>
      ) : (
        <div className="w-full overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b bg-neutral-50 text-xs uppercase text-neutral-600">
              <tr>
                <th className="px-3 py-3 whitespace-nowrap">ID</th>
                <th className="px-3 py-3">Employee</th>
                <th className="px-3 py-3">Merchant &amp; Category</th>
                <th className="px-3 py-3 whitespace-nowrap">Amount</th>
                <th className="px-3 py-3 whitespace-nowrap">AI Verdict</th>
                <th className="px-3 py-3 whitespace-nowrap">Suggested Cap</th>
                <th className="px-3 py-3 text-right whitespace-nowrap">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {queue.map(({ expense, employee, review }) => (
                <tr key={expense.expense_id} className="hover:bg-neutral-50">
                  <td className="px-3 py-3 font-mono text-xs whitespace-nowrap">
                    {expense.expense_id}
                  </td>
                  <td className="px-3 py-3">
                    <div className="break-words font-medium">
                      {employee.full_name}
                    </div>
                    <div className="break-words text-xs text-neutral-500">
                      {employee.department}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="break-words font-medium">
                      {expense.merchant}
                    </div>
                    <div className="break-words text-xs text-neutral-500">
                      {expense.category} · {expense.city}
                    </div>
                  </td>
                  <td className="px-3 py-3 font-medium whitespace-nowrap">
                    ${expense.amount_usd.toFixed(2)}
                  </td>
                  <td className="px-3 py-3 text-xs uppercase whitespace-nowrap">
                    {review ? review.verdict.replace("_", " ") : "Unreviewed"}
                  </td>
                  <td className="px-3 py-3 text-sm whitespace-nowrap">
                    {review?.reimbursable_amount_usd !== null &&
                    review?.reimbursable_amount_usd !== undefined
                      ? `$${review.reimbursable_amount_usd.toFixed(2)}`
                      : "—"}
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <Link
                      href={`/expenses/${expense.expense_id}`}
                      className="inline-block whitespace-nowrap rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800"
                    >
                      Review &amp; Decide
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ManagerQueuePage() {
  return (
    <main className="mx-auto w-full max-w-5xl p-6">
      <Suspense
        fallback={
          <p className="text-sm text-neutral-600">Loading approver queue...</p>
        }
      >
        <ManagerQueueContent />
      </Suspense>
    </main>
  );
}