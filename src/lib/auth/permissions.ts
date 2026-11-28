// Server-side access control checks

import {
  getCurrentApprovalStage,
  isActorAuthorizedForStage,
} from "@/lib/policy/approvals";
import type { Employee, EmployeeRole, Expense } from "@/types/expense";

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

// Stage-aware approval check enforcing no self-approval and required tier role
export function canDecideExpense(
  actor: Employee,
  expense: Pick<
    Expense,
    "employee_id" | "approver_id" | "status" | "manager_approved_by"
  >,
  submitterManagerId: string | null,
  submitterRole?: EmployeeRole
): boolean {
  const stage = getCurrentApprovalStage(expense.status);
  if (!stage) return false;
  if (!isApproverRole(actor)) return false;

  return isActorAuthorizedForStage(
    actor,
    stage,
    expense,
    submitterManagerId,
    submitterRole
  );
}