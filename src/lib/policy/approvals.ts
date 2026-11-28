// Tiered approval routing and stage transition helpers for Policy Sections 3.1-3.3

import type { Employee, EmployeeRole, ExpenseStatus } from "@/types/expense";

export type ApprovalStage = "manager" | "director" | "cfo";

export function isActiveApprovalStatus(status: ExpenseStatus): boolean {
  return (
    status === "pending" ||
    status === "pending_director" ||
    status === "pending_cfo"
  );
}

export function getRequiredApprovalStages(
  amountUsd: number,
  submitterRole: EmployeeRole,
  directManagerRole?: EmployeeRole | null
): ApprovalStage[] {
  // Policy 3.3: Executive/director self-submission routing
  if (submitterRole === "executive") {
    return ["director"];
  }
  if (submitterRole === "director") {
    return ["cfo"];
  }

  // Policy 3.1: Amount-based required approvals
  const stages: ApprovalStage[] = ["manager"];
  if (amountUsd > 1000) {
    stages.push("director");
  }
  if (amountUsd > 5000) {
    stages.push("cfo");
  }

  // Policy 3.2: Direct manager who is director or executive satisfies manager + director
  if (
    stages.includes("manager") &&
    stages.includes("director") &&
    (directManagerRole === "director" || directManagerRole === "executive")
  ) {
    return stages.filter((stage) => stage !== "director");
  }

  return stages;
}

export function getCurrentApprovalStage(status: ExpenseStatus): ApprovalStage | null {
  if (status === "pending") return "manager";
  if (status === "pending_director") return "director";
  if (status === "pending_cfo") return "cfo";
  return null;
}

export function formatApprovalStageLabel(stage: ApprovalStage | null): string {
  if (stage === "manager") return "Direct Manager";
  if (stage === "director") return "Director (VP)";
  if (stage === "cfo") return "CFO / Executive";
  return "Completed";
}

export function getNextExpenseStatusOnApproval(input: {
  amountUsd: number;
  currentStatus: ExpenseStatus;
  submitterRole: EmployeeRole;
  directManagerRole?: EmployeeRole | null;
  actorRole: EmployeeRole;
}): ExpenseStatus {
  const currentStage = getCurrentApprovalStage(input.currentStatus);
  if (!currentStage) {
    return input.currentStatus === "rejected" ? "rejected" : "approved";
  }

  const requiredStages = getRequiredApprovalStages(
    input.amountUsd,
    input.submitterRole,
    input.directManagerRole
  );

  // If actor is a director/executive approving at the initial manager step on a multi-tier
  // expense where director is required, satisfy both manager and director stages.
  if (
    currentStage === "manager" &&
    (input.actorRole === "director" || input.actorRole === "executive") &&
    requiredStages.includes("director")
  ) {
    return requiredStages.includes("cfo") ? "pending_cfo" : "approved";
  }

  const currentIdx = requiredStages.indexOf(currentStage);
  if (currentIdx === -1) {
    if (currentStage === "director" && requiredStages.includes("cfo")) {
      return "pending_cfo";
    }
    return "approved";
  }

  const nextStage = requiredStages[currentIdx + 1];
  if (!nextStage) return "approved";
  if (nextStage === "director") return "pending_director";
  if (nextStage === "cfo") return "pending_cfo";
  return "approved";
}

export function isActorAuthorizedForStage(
  actor: Pick<Employee, "employee_id" | "role">,
  stage: ApprovalStage,
  expense: {
    employee_id: string;
    approver_id: string | null;
    manager_approved_by?: string | null;
  },
  submitterManagerId: string | null,
  submitterRole?: EmployeeRole
): boolean {
  // Policy 3.3: No self-approval
  if (actor.employee_id === expense.employee_id) return false;
  // Prevent the same approver from double-approving a subsequent stage on the same expense
  if (stage !== "manager" && expense.manager_approved_by === actor.employee_id) {
    return false;
  }

  if (stage === "manager") {
    if (actor.role === "director" || actor.role === "executive") return true;
    if (actor.role === "manager") {
      return (
        expense.approver_id === actor.employee_id ||
        submitterManagerId === actor.employee_id
      );
    }
    return false;
  }

  if (stage === "director") {
    // Policy 3.3: Executives' expenses are approved by director/CFO tier; directors' expenses go to CEO/CFO
    if (submitterRole === "director") return actor.role === "executive";
    return actor.role === "director" || actor.role === "executive";
  }

  if (stage === "cfo") {
    return actor.role === "executive";
  }

  return false;
}