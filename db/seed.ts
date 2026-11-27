import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { Pool } from "pg";
import { config } from "dotenv";
import type { Employee, Expense } from "../src/types/expense";

config({ path: ".env.local" });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Missing DATABASE_URL in environment");
}

const pool = new Pool({
  connectionString,
  // Supabase Postgres requires SSL connections
  ssl: { rejectUnauthorized: false },
});

type EmployeeRow = {
  employee_id: string;
  full_name: string;
  email: string;
  department: string;
  job_title: string;
  role: string;
  manager_id: string;
  location: string;
  hire_date: string;
  home_office_spent_ytd_usd: string;
};

type ExpenseRow = {
  expense_id: string;
  employee_id: string;
  expense_date: string;
  submitted_date: string;
  category: string;
  merchant: string;
  amount_usd: string;
  city: string;
  receipt_attached: string;
  attendees: string;
  description: string;
  status: string;
  approver_id: string;
  decided_date: string;
};

function readCsv<T>(filePath: string): T[] {
  const content = fs.readFileSync(filePath, "utf8");
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as T[];
}

function toNullableString(value?: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed === "" || trimmed.toLowerCase() === "null" ? null : trimmed;
}

function toBoolean(value?: string): boolean {
  if (!value) return false;
  return ["true", "1", "yes"].includes(value.trim().toLowerCase());
}

async function seedEmployees(rows: EmployeeRow[]) {
  // Pass 1: Insert employees without manager_id so foreign keys never fail on ordering
  for (const row of rows) {
    await pool.query(
      `INSERT INTO employees (
         employee_id, full_name, email, department, job_title,
         role, manager_id, location, hire_date, home_office_spent_ytd_usd
       ) VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9)
       ON CONFLICT (employee_id) DO UPDATE SET
         full_name = EXCLUDED.full_name,
         email = EXCLUDED.email,
         department = EXCLUDED.department,
         job_title = EXCLUDED.job_title,
         role = EXCLUDED.role,
         location = EXCLUDED.location,
         hire_date = EXCLUDED.hire_date,
         home_office_spent_ytd_usd = EXCLUDED.home_office_spent_ytd_usd`,
      [
        row.employee_id,
        row.full_name,
        row.email,
        row.department,
        row.job_title,
        row.role,
        row.location,
        row.hire_date,
        Number(row.home_office_spent_ytd_usd || 0),
      ]
    );
  }

  // Pass 2: Link manager_id once all employee rows exist
  for (const row of rows) {
    await pool.query(
      `UPDATE employees SET manager_id = $2 WHERE employee_id = $1`,
      [row.employee_id, toNullableString(row.manager_id)]
    );
  }
}

async function seedExpenses(rows: ExpenseRow[]) {
  for (const row of rows) {
    await pool.query(
      `INSERT INTO expenses (
         expense_id, employee_id, expense_date, submitted_date, category,
         merchant, amount_usd, city, receipt_attached, attendees,
         description, status, approver_id, decided_date
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (expense_id) DO UPDATE SET
         employee_id = EXCLUDED.employee_id,
         expense_date = EXCLUDED.expense_date,
         submitted_date = EXCLUDED.submitted_date,
         category = EXCLUDED.category,
         merchant = EXCLUDED.merchant,
         amount_usd = EXCLUDED.amount_usd,
         city = EXCLUDED.city,
         receipt_attached = EXCLUDED.receipt_attached,
         attendees = EXCLUDED.attendees,
         description = EXCLUDED.description,
         status = EXCLUDED.status,
         approver_id = EXCLUDED.approver_id,
         decided_date = EXCLUDED.decided_date,
         updated_at = NOW()`,
      [
        row.expense_id,
        row.employee_id,
        row.expense_date,
        row.submitted_date,
        row.category,
        row.merchant,
        Number(row.amount_usd),
        row.city,
        toBoolean(row.receipt_attached),
        toNullableString(row.attendees),
        row.description,
        row.status || "pending",
        toNullableString(row.approver_id),
        toNullableString(row.decided_date),
      ]
    );
  }
}

async function seedPendingReviews() {
  if (process.argv.includes("--skip-ai")) {
    console.log("Skipping AI review generation (--skip-ai passed).");
    return;
  }

  const { reviewExpenseWithAi } = await import("../src/lib/llm");
  const { upsertExpenseReview } = await import("../src/lib/db/queries");

  const { rows: employees } = await pool.query<Employee>(
    `SELECT
       employee_id, full_name, email, department, job_title,
       role, manager_id, location, hire_date::text AS hire_date,
       home_office_spent_ytd_usd::float8 AS home_office_spent_ytd_usd
     FROM employees`
  );

  const employeeById = new Map<string, Employee>(
    employees.map((emp) => [emp.employee_id, emp])
  );

  const { rows: pendingExpenses } = await pool.query<Expense>(
    `SELECT
       expense_id, employee_id,
       expense_date::text AS expense_date,
       submitted_date::text AS submitted_date,
       category, merchant,
       amount_usd::float8 AS amount_usd,
       city, receipt_attached, attendees, description,
       status, approver_id,
       decided_date::text AS decided_date,
       decision_comment,
       created_at::text AS created_at,
       updated_at::text AS updated_at
     FROM expenses
     WHERE status = 'pending'
     ORDER BY expense_id ASC`
  );

  let reviewedCount = 0;

  for (const expense of pendingExpenses) {
    const employee = employeeById.get(expense.employee_id);
    if (!employee) {
      console.warn(
        `Skipping review for ${expense.expense_id}: missing employee ${expense.employee_id}`
      );
      continue;
    }

    const generated = await reviewExpenseWithAi({ expense, employee });
    await upsertExpenseReview({
      ...generated,
      expense_id: expense.expense_id,
    });
    reviewedCount += 1;
  }

  console.log(
    `Generated and stored AI policy reviews for ${reviewedCount}/${pendingExpenses.length} pending expenses.`
  );
}

async function main() {
  const dataDir = path.resolve(process.cwd(), "data");
  const employees = readCsv<EmployeeRow>(path.join(dataDir, "employees.csv"));
  const expenses = readCsv<ExpenseRow>(path.join(dataDir, "expenses.csv"));

  await seedEmployees(employees);
  await seedExpenses(expenses);
  await seedPendingReviews();

  console.log(
    `Seeded ${employees.length} employees and ${expenses.length} expenses.`
  );
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
    const { sql } = await import("../src/lib/db/client");
    await sql.end();
  });