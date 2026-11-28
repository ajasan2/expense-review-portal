-- 002_tiered_approvals.sql: Multi-stage approval states and per-stage audit fields (Policy 3.1-3.3)

ALTER TABLE expenses
  DROP CONSTRAINT IF EXISTS expenses_status_check;

ALTER TABLE expenses
  ADD CONSTRAINT expenses_status_check
  CHECK (status IN ('pending', 'pending_director', 'pending_cfo', 'approved', 'rejected'));

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS manager_approved_by TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manager_approved_at DATE,
  ADD COLUMN IF NOT EXISTS director_approved_by TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS director_approved_at DATE,
  ADD COLUMN IF NOT EXISTS cfo_approved_by TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cfo_approved_at DATE;

CREATE INDEX IF NOT EXISTS idx_expenses_manager_approved_by ON expenses(manager_approved_by);
CREATE INDEX IF NOT EXISTS idx_expenses_director_approved_by ON expenses(director_approved_by);
CREATE INDEX IF NOT EXISTS idx_expenses_cfo_approved_by ON expenses(cfo_approved_by);