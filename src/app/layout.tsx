// src/app/layout.tsx: Root layout with session status and production-gated demo switcher

import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { getCurrentEmployee } from "@/lib/auth/session";
import { listEmployees } from "@/lib/db/queries";
import {
  isDemoUserSwitcherEnabled,
  signOutAction,
  switchDemoUserAction,
} from "@/app/auth/actions";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Halcyon Expense Review Portal",
  description: "Expense submission, policy auditing, and approval workflow",
};

async function SessionBar() {
  const currentUser = await getCurrentEmployee();
  const showSwitcher = await isDemoUserSwitcherEnabled();
  const employees = showSwitcher ? await listEmployees() : [];

  if (!currentUser && !showSwitcher) {
    return null;
  }

  return (
    <header className="border-b bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-2.5 text-sm">
        <div className="flex items-center gap-4">
          <Link href="/" className="font-semibold">
            Halcyon Portal
          </Link>
          {currentUser && (
            <span className="text-xs text-neutral-600">
              {currentUser.full_name} ({currentUser.role})
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {showSwitcher && employees.length > 0 && (
            <form action={switchDemoUserAction} className="flex items-center gap-2">
              <label htmlFor="layout-demo-user" className="text-xs text-neutral-500">
                Demo Switch:
              </label>
              <select
                id="layout-demo-user"
                name="employee_id"
                defaultValue={currentUser?.employee_id ?? employees[0].employee_id}
                className="rounded-md border px-2 py-1 text-xs"
              >
                {employees.map((emp) => (
                  <option key={emp.employee_id} value={emp.employee_id}>
                    {emp.full_name} ({emp.role})
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-neutral-50"
              >
                Switch
              </button>
            </form>
          )}

          {currentUser && (
            <form action={signOutAction}>
              <button
                type="submit"
                className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-neutral-50"
              >
                Sign Out
              </button>
            </form>
          )}
        </div>
      </div>
    </header>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <Suspense fallback={null}>
          <SessionBar />
        </Suspense>
        <div className="flex flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}