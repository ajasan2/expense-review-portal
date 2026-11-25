// src/lib/db/queries.ts: Server-side database query helpers for employees, expenses, and reviews

import { sql } from "@/lib/db/client";
import type {
  Employee,
  EmployeeRole,
  Expense,
  ExpenseReview,
  ExpenseStatus,
  PolicyFinding,
  ReviewVerdict,
} from "@/types/expense";

export interface ExpenseWithContext {
  expense: Expense;
  employee: Employee;
  approver: Employee | null;
  review: ExpenseReview | null;
}

// Raw row shapes returned from Postgres before numeric/JSON normalization
interface EmployeeDbRow {
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
}

interface ExpenseDbRow {
  expense_id: string;
  employee_id: string;
  expense_date: string;
  submitted_date: string;
  category: string;
  merchant: string;
  amount_usd: string;
  city: string;
  receipt_attached: boolean;
  attendees: string | null;
  description: string;
  status: ExpenseStatus;
  approver_id: string | null;
  decided_date: string | null;
  decision_comment: string | null;
  created_at: string;
  updated_at: string;
}

interface ReviewDbRow {
  id: number;
  expense_id: string;
  verdict: ReviewVerdict;
  findings: unknown;
  reimbursable_amount_usd: string | null;
  summary: string;
  model_name: string;
  reviewed_at: string;
}

function mapEmployee(row: EmployeeDbRow): Employee {
  return {
    ...row,
    home_office_spent_ytd_usd: Number(row.home_office_spent_ytd_usd),
  };
}

function mapExpense(row: ExpenseDbRow): Expense {
  return {
    ...row,
    amount_usd: Number(row.amount_usd),
  };
}

function parseFindings(raw: unknown): PolicyFinding[] {
  // Handle JSONB returned either as an already-parsed array or a JSON string
  if (Array.isArray(raw)) return raw as PolicyFinding[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as PolicyFinding[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mapReview(row: ReviewDbRow): ExpenseReview {
  return {
    ...row,
    findings: parseFindings(row.findings),
    reimbursable_amount_usd:
      row.reimbursable_amount_usd === null
        ? null
        : Number(row.reimbursable_amount_usd),
  };
}

// Fetch all seeded employees for the user switcher / login picker
export async function listEmployees(): Promise<Employee[]> {
  const rows = await sql<EmployeeDbRow[]>`
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
    ORDER BY employee_id ASC
  `;

  return rows.map(mapEmployee);
}

// Fetch a single employee by ID
export async function getEmployeeById(
  employeeId: string
): Promise<Employee | null> {
  const rows = await sql<EmployeeDbRow[]>`
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

  return rows[0] ? mapEmployee(rows[0]) : null;
}

// Fetch expenses owned by a specific employee (enforcing ownership at query level)
export async function listExpensesForEmployee(
  employeeId: string
): Promise<ExpenseWithContext[]> {
  const rows = await sql<
    Array<{
      expense: ExpenseDbRow;
      employee: EmployeeDbRow;
      approver: EmployeeDbRow | null;
      review: ReviewDbRow | null;
    }>
  >`
    SELECT
      to_jsonb(e) AS expense,
      to_jsonb(emp) AS employee,
      CASE WHEN app.employee_id IS NOT NULL THEN to_jsonb(app) ELSE NULL END AS approver,
      CASE WHEN rev.id IS NOT NULL THEN to_jsonb(rev) ELSE NULL END AS review
    FROM expenses e
    JOIN employees emp ON emp.employee_id = e.employee_id
    LEFT JOIN employees app ON app.employee_id = e.approver_id
    LEFT JOIN expense_reviews rev ON rev.expense_id = e.expense_id
    WHERE e.employee_id = ${employeeId}
    ORDER BY e.submitted_date DESC, e.expense_id DESC
  `;

  return rows.map((r) => ({
    expense: mapExpense(r.expense),
    employee: mapEmployee(r.employee),
    approver: r.approver ? mapEmployee(r.approver) : null,
    review: r.review ? mapReview(r.review) : null,
  }));
}

// Fetch pending expenses for manager/approver review queue
export async function listPendingExpensesForApprover(
  approver: Employee
): Promise<ExpenseWithContext[]> {
  // Non-approvers never receive queue items
  if (
    approver.role !== "manager" &&
    approver.role !== "director" &&
    approver.role !== "executive"
  ) {
    return [];
  }

  // Directors and executives see all pending expenses; managers see direct/assigned pending items
  const isBroadApprover =
    approver.role === "director" || approver.role === "executive";

  const rows = await sql<
    Array<{
      expense: ExpenseDbRow;
      employee: EmployeeDbRow;
      approver: EmployeeDbRow | null;
      review: ReviewDbRow | null;
    }>
  >`
    SELECT
      to_jsonb(e) AS expense,
      to_jsonb(emp) AS employee,
      CASE WHEN app.employee_id IS NOT NULL THEN to_jsonb(app) ELSE NULL END AS approver,
      CASE WHEN rev.id IS NOT NULL THEN to_jsonb(rev) ELSE NULL END AS review
    FROM expenses e
    JOIN employees emp ON emp.employee_id = e.employee_id
    LEFT JOIN employees app ON app.employee_id = e.approver_id
    LEFT JOIN expense_reviews rev ON rev.expense_id = e.expense_id
    WHERE e.status = 'pending'
      AND e.employee_id <> ${approver.employee_id}
      AND (
        ${isBroadApprover}
        OR e.approver_id = ${approver.employee_id}
        OR emp.manager_id = ${approver.employee_id}
      )
    ORDER BY e.amount_usd DESC, e.submitted_date ASC
  `;

  return rows.map((r) => ({
    expense: mapExpense(r.expense),
    employee: mapEmployee(r.employee),
    approver: r.approver ? mapEmployee(r.approver) : null,
    review: r.review ? mapReview(r.review) : null,
  }));
}

// Upsert a persisted AI review result for an expense
export async function upsertExpenseReview(input: {
  expense_id: string;
  verdict: ReviewVerdict;
  findings: PolicyFinding[];
  reimbursable_amount_usd: number | null;
  summary: string;
  model_name: string;
}): Promise<ExpenseReview> {
  const rows = await sql<ReviewDbRow[]>`
    INSERT INTO expense_reviews (
      expense_id,
      verdict,
      findings,
      reimbursable_amount_usd,
      summary,
      model_name,
      reviewed_at
    ) VALUES (
      ${input.expense_id},
      ${input.verdict},
      ${sql.json(JSON.parse(JSON.stringify(input.findings)))}::jsonb,
      ${input.reimbursable_amount_usd},
      ${input.summary},
      ${input.model_name},
      NOW()
    )
    ON CONFLICT (expense_id) DO UPDATE SET
      verdict = EXCLUDED.verdict,
      findings = EXCLUDED.findings,
      reimbursable_amount_usd = EXCLUDED.reimbursable_amount_usd,
      summary = EXCLUDED.summary,
      model_name = EXCLUDED.model_name,
      reviewed_at = NOW()
    RETURNING
      id,
      expense_id,
      verdict,
      findings,
      reimbursable_amount_usd,
      summary,
      model_name,
      reviewed_at::text AS reviewed_at
  `;

  return mapReview(rows[0]);
}