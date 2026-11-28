// Core domain and review types

export type EmployeeRole = "employee" | "manager" | "director" | "executive";

export type ExpenseStatus =
  | "pending"
  | "pending_director"
  | "pending_cfo"
  | "approved"
  | "rejected";

export type ReviewVerdict = "compliant" | "needs_review" | "policy_violation";

export interface Employee {
  employee_id: string;
  full_name: string;
  email: string;
  department: string;
  job_title: string;
  role: EmployeeRole;
  manager_id: string | null;
  location: string;
  hire_date: string;
  home_office_spent_ytd_usd: number;
}

export interface Expense {
  expense_id: string;
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
  manager_approved_by?: string | null;
  manager_approved_at?: string | null;
  director_approved_by?: string | null;
  director_approved_at?: string | null;
  cfo_approved_by?: string | null;
  cfo_approved_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PolicyFinding {
  section: string;
  rule_title: string;
  status: ReviewVerdict;
  detail: string;
  reimbursable_amount_usd?: number | null;
}

export interface ExpenseReview {
  id: number;
  expense_id: string;
  verdict: ReviewVerdict;
  findings: PolicyFinding[];
  reimbursable_amount_usd: number | null;
  summary: string;
  model_name: string;
  reviewed_at: string;
}