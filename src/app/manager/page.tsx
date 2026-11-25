// Pending expense review queue

import { Suspense } from "react";
import Link from "next/link";
import {
  getEmployeeById,
  listEmployees,
  listPendingExpensesForApprover,
} from "@/lib/db/queries";

async function ManagerQueueContent({
  searchParams,
}: {
  searchParams: Promise<{ approverId?: string }>;
}) {
  const { approverId } = await searchParams;
  const employees = await listEmployees();

  const approvers = employees.filter(
    (e) =>
      e.role === "manager" || e.role === "director" || e.role === "executive"
  );

  const selectedApprover =
    (approverId ? await getEmployeeById(approverId) : null) ??
    approvers[0] ??
    employees[0];

  const queue = selectedApprover
    ? await listPendingExpensesForApprover(selectedApprover)
    : [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-2xl font-semibold">Approver Review Queue</h1>
          <p className="text-sm text-neutral-600">
            Pending expenses requiring review or decision under Halcyon Policy
            v3.2
          </p>
        </div>

        <div className="flex items-center gap-3">
          <form method="GET" className="flex items-center gap-2">
            <label htmlFor="approverId" className="text-xs text-neutral-500">
              Approver:
            </label>
            <select
              id="approverId"
              name="approverId"
              defaultValue={selectedApprover?.employee_id ?? ""}
              className="rounded-md border px-2.5 py-1.5 text-sm"
            >
              {employees.map((emp) => (
                <option key={emp.employee_id} value={emp.employee_id}>
                  {emp.full_name} ({emp.role})
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-neutral-50"
            >
              Switch
            </button>
          </form>

          <Link
            href="/expenses"
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-neutral-50"
          >
            ← My Expenses
          </Link>
        </div>
      </header>

      {!selectedApprover ? (
        <p className="text-sm text-neutral-600">No employees found.</p>
      ) : queue.length === 0 ? (
        <div className="rounded-lg border p-6 text-sm text-neutral-600">
          No pending expenses in the queue for{" "}
          <strong>{selectedApprover.full_name}</strong> ({selectedApprover.role}
          ).
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-neutral-50 text-xs uppercase text-neutral-600">
              <tr>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Merchant &amp; Category</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">AI Verdict</th>
                <th className="px-4 py-3">Suggested Cap</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {queue.map(({ expense, employee, review }) => (
                <tr key={expense.expense_id} className="hover:bg-neutral-50">
                  <td className="px-4 py-3 font-mono text-xs">
                    {expense.expense_id}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{employee.full_name}</div>
                    <div className="text-xs text-neutral-500">
                      {employee.department}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{expense.merchant}</div>
                    <div className="text-xs text-neutral-500">
                      {expense.category} · {expense.city}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium">
                    ${expense.amount_usd.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-xs uppercase">
                    {review ? review.verdict.replace("_", " ") : "Unreviewed"}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {review?.reimbursable_amount_usd !== null &&
                    review?.reimbursable_amount_usd !== undefined
                      ? `$${review.reimbursable_amount_usd.toFixed(2)}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/expenses/${expense.expense_id}`}
                      className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800"
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

export default function ManagerQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ approverId?: string }>;
}) {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <Suspense
        fallback={
          <p className="text-sm text-neutral-600">Loading approver queue...</p>
        }
      >
        <ManagerQueueContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}