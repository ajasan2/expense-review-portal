// Server-side access control checks

import type { Employee, Expense } from "@/types/expense";

export function isApproverRole(employee: Employee): boolean {
  return (
    employee.role === "manager" ||
    employee.role === "director" ||
    employee.role === "executive"
  );
}

export function canRunExpenseReview(actor: Employee): boolean {
  return isApproverRole(actor);
}

// Employees can view their own expenses; assigned/reporting approvers can view items in their queue
export function canViewExpense(
  actor: Employee,
  expense: Pick<Expense, "employee_id" | "approver_id">,
  submitterManagerId: string | null
): boolean {
  if (actor.employee_id === expense.employee_id) return true;
  if (!isApproverRole(actor)) return false;

  return (
    expense.approver_id === actor.employee_id ||
    submitterManagerId === actor.employee_id ||
    actor.role === "director" ||
    actor.role === "executive"
  );
}

// Approvers cannot approve their own expenses
export function canDecideExpense(
  actor: Employee,
  expense: Pick<Expense, "employee_id" | "approver_id" | "status">,
  submitterManagerId: string | null
): boolean {
  if (expense.status !== "pending") return false;
  if (actor.employee_id === expense.employee_id) return false;
  if (!isApproverRole(actor)) return false;

  return (
    expense.approver_id === actor.employee_id ||
    submitterManagerId === actor.employee_id ||
    actor.role === "director" ||
    actor.role === "executive"
  );
}