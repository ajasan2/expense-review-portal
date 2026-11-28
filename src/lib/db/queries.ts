// Server-side database query helpers for employees, expenses, and reviews

import { sql } from "@/lib/db/client";
import {
  getCurrentApprovalStage,
  getNextExpenseStatusOnApproval,
  isActorAuthorizedForStage,
} from "@/lib/policy/approvals";
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
  managerApprover: Employee | null;
  directorApprover: Employee | null;
  cfoApprover: Employee | null;
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
  manager_approved_by?: string | null;
  manager_approved_at?: string | null;
  director_approved_by?: string | null;
  director_approved_at?: string | null;
  cfo_approved_by?: string | null;
  cfo_approved_at?: string | null;
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

// Fetch raw expense rows for an employee (used for split-billing checks)
export async function listRawExpensesByEmployee(
  employeeId: string
): Promise<Expense[]> {
  const rows = await sql<ExpenseDbRow[]>`
    SELECT
      expense_id,
      employee_id,
      expense_date::text AS expense_date,
      submitted_date::text AS submitted_date,
      category,
      merchant,
      amount_usd,
      city,
      receipt_attached,
      attendees,
      description,
      status,
      approver_id,
      decided_date::text AS decided_date,
      decision_comment,
      manager_approved_by,
      manager_approved_at::text AS manager_approved_at,
      director_approved_by,
      director_approved_at::text AS director_approved_at,
      cfo_approved_by,
      cfo_approved_at::text AS cfo_approved_at,
      created_at::text AS created_at,
      updated_at::text AS updated_at
    FROM expenses
    WHERE employee_id = ${employeeId}
    ORDER BY expense_date DESC, expense_id DESC
  `;

  return rows.map(mapExpense);
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
    managerApprover: null,
    directorApprover: null,
    cfoApprover: null,
    review: r.review ? mapReview(r.review) : null,
  }));
}

// Fetch expenses currently awaiting approval for the given approver
export async function listPendingExpensesForApprover(
  approver: Employee
): Promise<ExpenseWithContext[]> {
  if (
    approver.role !== "manager" &&
    approver.role !== "director" &&
    approver.role !== "executive"
  ) {
    return [];
  }

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
    WHERE e.status IN ('pending', 'pending_director', 'pending_cfo')
      AND e.employee_id <> ${approver.employee_id}
      AND (
        ${isBroadApprover}
        OR (
          e.status = 'pending'
          AND (
            e.approver_id = ${approver.employee_id}
            OR emp.manager_id = ${approver.employee_id}
          )
        )
      )
    ORDER BY e.amount_usd DESC, e.submitted_date ASC
  `;

  return rows
    .map((r) => {
      const mappedExpense = mapExpense(r.expense);
      const mappedEmployee = mapEmployee(r.employee);
      return {
        expense: mappedExpense,
        employee: mappedEmployee,
        approver: r.approver ? mapEmployee(r.approver) : null,
        managerApprover: null,
        directorApprover: null,
        cfoApprover: null,
        review: r.review ? mapReview(r.review) : null,
      };
    })
    .filter(({ expense, employee }) => {
      const stage = getCurrentApprovalStage(expense.status);
      if (!stage) return false;
      return isActorAuthorizedForStage(
        approver,
        stage,
        expense,
        employee.manager_id,
        employee.role
      );
    });
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

// Fetch a single expense with employee, approver, and review context
export async function getExpenseWithContextById(
  expenseId: string
): Promise<ExpenseWithContext | null> {
  const rows = await sql<
    Array<{
      expense: ExpenseDbRow;
      employee: EmployeeDbRow;
      approver: EmployeeDbRow | null;
      manager_approver: EmployeeDbRow | null;
      director_approver: EmployeeDbRow | null;
      cfo_approver: EmployeeDbRow | null;
      review: ReviewDbRow | null;
    }>
  >`
    SELECT
      to_jsonb(e) AS expense,
      to_jsonb(emp) AS employee,
      CASE WHEN app.employee_id IS NOT NULL THEN to_jsonb(app) ELSE NULL END AS approver,
      CASE WHEN mgr_app.employee_id IS NOT NULL THEN to_jsonb(mgr_app) ELSE NULL END AS manager_approver,
      CASE WHEN dir_app.employee_id IS NOT NULL THEN to_jsonb(dir_app) ELSE NULL END AS director_approver,
      CASE WHEN cfo_app.employee_id IS NOT NULL THEN to_jsonb(cfo_app) ELSE NULL END AS cfo_approver,
      CASE WHEN rev.id IS NOT NULL THEN to_jsonb(rev) ELSE NULL END AS review
    FROM expenses e
    JOIN employees emp ON emp.employee_id = e.employee_id
    LEFT JOIN employees app ON app.employee_id = e.approver_id
    LEFT JOIN employees mgr_app ON mgr_app.employee_id = e.manager_approved_by
    LEFT JOIN employees dir_app ON dir_app.employee_id = e.director_approved_by
    LEFT JOIN employees cfo_app ON cfo_app.employee_id = e.cfo_approved_by
    LEFT JOIN expense_reviews rev ON rev.expense_id = e.expense_id
    WHERE e.expense_id = ${expenseId}
    LIMIT 1
  `;

  const r = rows[0];
  if (!r) return null;

  return {
    expense: mapExpense(r.expense),
    employee: mapEmployee(r.employee),
    approver: r.approver ? mapEmployee(r.approver) : null,
    managerApprover: r.manager_approver ? mapEmployee(r.manager_approver) : null,
    directorApprover: r.director_approver ? mapEmployee(r.director_approver) : null,
    cfoApprover: r.cfo_approver ? mapEmployee(r.cfo_approver) : null,
    review: r.review ? mapReview(r.review) : null,
  };
}

// Insert a new expense record and return the normalized Expense row
export async function insertExpense(input: {
  expense_id?: string;
  employee_id: string;
  expense_date: string;
  submitted_date: string;
  category: string;
  merchant: string;
  amount_usd: number;
  city: string;
  receipt_attached: boolean;
  attendees: string | null;
  description: string;
  status: ExpenseStatus;
  approver_id: string | null;
  decided_date: string | null;
  decision_comment: string | null;
}): Promise<Expense> {
  const expenseId =
    input.expense_id ??
    `EXP-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`;

  const rows = await sql<ExpenseDbRow[]>`
    INSERT INTO expenses (
      expense_id,
      employee_id,
      expense_date,
      submitted_date,
      category,
      merchant,
      amount_usd,
      city,
      receipt_attached,
      attendees,
      description,
      status,
      approver_id,
      decided_date,
      decision_comment
    ) VALUES (
      ${expenseId},
      ${input.employee_id},
      ${input.expense_date},
      ${input.submitted_date},
      ${input.category},
      ${input.merchant},
      ${input.amount_usd},
      ${input.city},
      ${input.receipt_attached},
      ${input.attendees},
      ${input.description},
      ${input.status},
      ${input.approver_id},
      ${input.decided_date},
      ${input.decision_comment}
    )
    RETURNING
      expense_id,
      employee_id,
      expense_date::text AS expense_date,
      submitted_date::text AS submitted_date,
      category,
      merchant,
      amount_usd,
      city,
      receipt_attached,
      attendees,
      description,
      status,
      approver_id,
      decided_date::text AS decided_date,
      decision_comment,
      manager_approved_by,
      manager_approved_at::text AS manager_approved_at,
      director_approved_by,
      director_approved_at::text AS director_approved_at,
      cfo_approved_by,
      cfo_approved_at::text AS cfo_approved_at,
      created_at::text AS created_at,
      updated_at::text AS updated_at
  `;

  return mapExpense(rows[0]);
}

// Advance or reject approval stage and record stage-specific approval metadata
export async function updateExpenseStatus(input: {
  expense_id: string;
  approver_id: string;
  actor_role?: EmployeeRole;
  decision: "approved" | "rejected";
  decided_date: string;
  decision_comment: string | null;
}): Promise<Expense | null> {
  const existingRows = await sql<
    Array<{
      expense: ExpenseDbRow;
      submitter_role: EmployeeRole;
      manager_role: EmployeeRole | null;
      actor_role_db: EmployeeRole | null;
    }>
  >`
    SELECT
      to_jsonb(e) AS expense,
      emp.role AS submitter_role,
      mgr.role AS manager_role,
      act.role AS actor_role_db
    FROM expenses e
    JOIN employees emp ON emp.employee_id = e.employee_id
    LEFT JOIN employees mgr ON mgr.employee_id = emp.manager_id
    LEFT JOIN employees act ON act.employee_id = ${input.approver_id}
    WHERE e.expense_id = ${input.expense_id}
    LIMIT 1
  `;

  const row = existingRows[0];
  if (!row) return null;

  const currentExpense = mapExpense(row.expense);
  const currentStage = getCurrentApprovalStage(currentExpense.status);
  if (!currentStage) return currentExpense;

  const actorRole = input.actor_role ?? row.actor_role_db ?? "manager";

  let nextStatus: ExpenseStatus = "rejected";
  let setManagerApproval = false;
  let setDirectorApproval = false;
  let setCfoApproval = false;

  if (input.decision === "approved") {
    nextStatus = getNextExpenseStatusOnApproval({
      amountUsd: currentExpense.amount_usd,
      currentStatus: currentExpense.status,
      submitterRole: row.submitter_role,
      directManagerRole: row.manager_role,
      actorRole,
    });

    if (currentStage === "manager") {
      setManagerApproval = true;
      if (
        (actorRole === "director" || actorRole === "executive") &&
        nextStatus !== "pending_director"
      ) {
        setDirectorApproval = true;
      }
    } else if (currentStage === "director") {
      setDirectorApproval = true;
    } else if (currentStage === "cfo") {
      setCfoApproval = true;
    }
  }

  const rows = await sql<ExpenseDbRow[]>`
    UPDATE expenses
    SET
      status = ${nextStatus},
      approver_id = ${input.approver_id},
      decided_date = ${input.decided_date},
      decision_comment = ${input.decision_comment},
      manager_approved_by = CASE
        WHEN ${setManagerApproval} THEN ${input.approver_id}
        ELSE manager_approved_by
      END,
      manager_approved_at = CASE
        WHEN ${setManagerApproval} THEN ${input.decided_date}::date
        ELSE manager_approved_at
      END,
      director_approved_by = CASE
        WHEN ${setDirectorApproval} THEN ${input.approver_id}
        ELSE director_approved_by
      END,
      director_approved_at = CASE
        WHEN ${setDirectorApproval} THEN ${input.decided_date}::date
        ELSE director_approved_at
      END,
      cfo_approved_by = CASE
        WHEN ${setCfoApproval} THEN ${input.approver_id}
        ELSE cfo_approved_by
      END,
      cfo_approved_at = CASE
        WHEN ${setCfoApproval} THEN ${input.decided_date}::date
        ELSE cfo_approved_at
      END,
      updated_at = NOW()
    WHERE expense_id = ${input.expense_id}
    RETURNING
      expense_id,
      employee_id,
      expense_date::text AS expense_date,
      submitted_date::text AS submitted_date,
      category,
      merchant,
      amount_usd,
      city,
      receipt_attached,
      attendees,
      description,
      status,
      approver_id,
      decided_date::text AS decided_date,
      decision_comment,
      manager_approved_by,
      manager_approved_at::text AS manager_approved_at,
      director_approved_by,
      director_approved_at::text AS director_approved_at,
      cfo_approved_by,
      cfo_approved_at::text AS cfo_approved_at,
      created_at::text AS created_at,
      updated_at::text AS updated_at
  `;

  return rows[0] ? mapExpense(rows[0]) : null;
}