-- 001_init.sql: Core schema for Halcyon Logistics Expense Review Portal

CREATE TABLE IF NOT EXISTS employees (
  employee_id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  department TEXT NOT NULL,
  job_title TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('employee', 'manager', 'director', 'executive')),
  manager_id TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  location TEXT NOT NULL,
  hire_date DATE NOT NULL,
  home_office_spent_ytd_usd NUMERIC(12, 2) NOT NULL DEFAULT 0.00
);

CREATE TABLE IF NOT EXISTS expenses (
  expense_id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  expense_date DATE NOT NULL,
  submitted_date DATE NOT NULL,
  category TEXT NOT NULL,
  merchant TEXT NOT NULL,
  amount_usd NUMERIC(12, 2) NOT NULL CHECK (amount_usd >= 0),
  city TEXT NOT NULL,
  receipt_attached BOOLEAN NOT NULL DEFAULT FALSE,
  attendees TEXT,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approver_id TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  decided_date DATE,
  decision_comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expense_reviews (
  id BIGSERIAL PRIMARY KEY,
  expense_id TEXT NOT NULL UNIQUE REFERENCES expenses(expense_id) ON DELETE CASCADE,
  verdict TEXT NOT NULL CHECK (verdict IN ('compliant', 'needs_review', 'policy_violation')),
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  reimbursable_amount_usd NUMERIC(12, 2),
  summary TEXT NOT NULL,
  model_name TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employees_manager_id ON employees(manager_id);
CREATE INDEX IF NOT EXISTS idx_expenses_employee_id ON expenses(employee_id);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status);