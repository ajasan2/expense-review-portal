// src/app/page.tsx: Employee sign-in screen setting the signed session cookie

import { Suspense } from "react";
import Link from "next/link";
import { listEmployees } from "@/lib/db/queries";
import { getCurrentEmployee } from "@/lib/auth/session";
import { signInAsEmployeeAction } from "@/app/auth/actions";

async function SignInContent() {
  const [employees, currentUser] = await Promise.all([
    listEmployees(),
    getCurrentEmployee(),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center p-6">
      <div className="space-y-6 rounded-xl border p-6 shadow-sm">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Halcyon Expense Portal
          </p>
          <h1 className="text-2xl font-semibold">Sign In</h1>
          <p className="text-sm text-neutral-600">
            Select an employee profile to start a signed session.
          </p>
        </div>

        {currentUser && (
          <div className="flex items-center justify-between rounded-lg bg-neutral-50 p-3 text-sm">
            <div>
              Signed in as <strong>{currentUser.full_name}</strong> (
              {currentUser.role})
            </div>
            <Link
              href="/expenses"
              className="font-medium underline hover:text-neutral-600"
            >
              Continue →
            </Link>
          </div>
        )}

        {employees.length === 0 ? (
          <p className="text-sm text-neutral-600">
            No employees found. Run your database seed script first.
          </p>
        ) : (
          <form action={signInAsEmployeeAction} className="space-y-4">
            <div>
              <label
                htmlFor="employee_id"
                className="block text-xs font-medium uppercase text-neutral-600"
              >
                Employee Account
              </label>
              <select
                id="employee_id"
                name="employee_id"
                defaultValue={currentUser?.employee_id ?? employees[0].employee_id}
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                required
              >
                {employees.map((emp) => (
                  <option key={emp.employee_id} value={emp.employee_id}>
                    {emp.full_name} — {emp.role} ({emp.department})
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Sign In &amp; Continue
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-neutral-600">Loading sign-in...</div>}>
      <SignInContent />
    </Suspense>
  );
}