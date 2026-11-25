// Server-side cookie session and current user lookup

import crypto from "node:crypto";
import { cookies } from "next/headers";
import { sql } from "@/lib/db/client";
import type { Employee, EmployeeRole } from "@/types/expense";

const SESSION_COOKIE_NAME = "halcyon_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getAuthSecret(): string {
  return process.env.AUTH_SECRET ?? "dev-only-fallback-secret-change-in-prod";
}

function signValue(value: string): string {
  const signature = crypto
    .createHmac("sha256", getAuthSecret())
    .update(value)
    .digest("hex");
  return `${value}.${signature}`;
}

function verifySignedValue(signed: string): string | null {
  const dotIndex = signed.lastIndexOf(".");
  if (dotIndex === -1) return null;

  const value = signed.slice(0, dotIndex);
  const expected = signValue(value);

  const a = Buffer.from(signed);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  return value;
}

export async function setSessionEmployeeId(employeeId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, signValue(employeeId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

// Read the verified employee_id from the incoming request cookie
export async function getSessionEmployeeId(): Promise<string | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!raw) return null;
  return verifySignedValue(raw);
}

export async function getCurrentEmployee(): Promise<Employee | null> {
  const employeeId = await getSessionEmployeeId();
  if (!employeeId) return null;

  const rows = await sql<
    Array<{
      employee_id: string;
      full_name: string;
      email: string;
      department: string;
      job_title: string;
      role: EmployeeRole;
      manager_id: string | null;
      location: string;
      hire_date: string;
      home_office_spent_ytd_usd: string;
    }>
  >`
    SELECT
      employee_id,
      full_name,
      email,
      department,
      job_title,
      role,
      manager_id,
      location,
      hire_date::text AS hire_date,
      home_office_spent_ytd_usd
    FROM employees
    WHERE employee_id = ${employeeId}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return null;

  return {
    ...row,
    home_office_spent_ytd_usd: Number(row.home_office_spent_ytd_usd),
  };
}


export async function requireCurrentEmployee(): Promise<Employee> {
  const employee = await getCurrentEmployee();
  if (!employee) {
    throw new Error("UNAUTHORIZED");
  }
  return employee;
}