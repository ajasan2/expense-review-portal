// Unit tests for server-side expense view, review, and approval permissions

import { describe, expect, it } from "vitest";
import {
  canDecideExpense,
  canRunExpenseReview,
  canViewExpense,
  isApproverRole,
} from "@/lib/auth/permissions";
import type { Employee, ExpenseStatus } from "@/types/expense";

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    employee_id: "E008",
    full_name: "Sam Patel",
    email: "sam@halcyon.io",
    department: "Engineering",
    job_title: "Software Engineer",
    role: "employee",
    manager_id: "E002",
    location: "New York",
    hire_date: "2024-01-15",
    home_office_spent_ytd_usd: 0,
    ...overrides,
  };
}

describe("permissions", () => {
  const employee = makeEmployee({
    employee_id: "E008",
    role: "employee",
    manager_id: "E002",
  });
  const peer = makeEmployee({
    employee_id: "E009",
    role: "employee",
    manager_id: "E002",
  });
  const manager = makeEmployee({
    employee_id: "E002",
    role: "manager",
    manager_id: "E001",
  });
  const otherManager = makeEmployee({
    employee_id: "E003",
    role: "manager",
    manager_id: "E001",
  });
  const director = makeEmployee({
    employee_id: "E001",
    role: "director",
    manager_id: "E000",
  });
  const executive = makeEmployee({
    employee_id: "E000",
    role: "executive",
    manager_id: null,
  });

  const sampleExpense = {
    employee_id: "E008",
    approver_id: "E002",
    status: "pending" as const,
  };

  it("identifies approver roles accurately", () => {
    expect(isApproverRole(employee)).toBe(false);
    expect(isApproverRole(manager)).toBe(true);
    expect(isApproverRole(director)).toBe(true);
    expect(isApproverRole(executive)).toBe(true);
  });

  it("restricts manual/on-demand AI policy review triggers to approver roles", () => {
    expect(canRunExpenseReview(employee)).toBe(false);
    expect(canRunExpenseReview(peer)).toBe(false);
    expect(canRunExpenseReview(manager)).toBe(true);
    expect(canRunExpenseReview(director)).toBe(true);
    expect(canRunExpenseReview(executive)).toBe(true);
  });

  it("allows owners, assigned/reporting managers, directors, and executives to view an expense", () => {
    expect(canViewExpense(employee, sampleExpense, "E002")).toBe(true);
    expect(canViewExpense(manager, sampleExpense, "E002")).toBe(true);
    expect(
      canViewExpense(
        manager,
        { employee_id: "E008", approver_id: null },
        "E002"
      )
    ).toBe(true);
    expect(
      canViewExpense(
        manager,
        { employee_id: "E008", approver_id: "E002" },
        null
      )
    ).toBe(true);
    expect(canViewExpense(director, sampleExpense, "E002")).toBe(true);
    expect(canViewExpense(executive, sampleExpense, "E002")).toBe(true);
  });

  it("blocks peers and unrelated managers from viewing an expense", () => {
    expect(canViewExpense(peer, sampleExpense, "E002")).toBe(false);
    expect(canViewExpense(otherManager, sampleExpense, "E002")).toBe(false);
    expect(
      canViewExpense(
        otherManager,
        { employee_id: "E008", approver_id: null },
        null
      )
    ).toBe(false);
  });

  it("allows viewing expenses regardless of approval status when authorized", () => {
    const statuses: ExpenseStatus[] = ["pending", "approved", "rejected"];
    for (const status of statuses) {
      const expenseWithStatus = { ...sampleExpense, status };
      expect(canViewExpense(employee, expenseWithStatus, "E002")).toBe(true);
      expect(canViewExpense(manager, expenseWithStatus, "E002")).toBe(true);
      expect(canViewExpense(peer, expenseWithStatus, "E002")).toBe(false);
    }
  });

  it("blocks self-approval even for managers, directors, and executives", () => {
    expect(
      canDecideExpense(
        manager,
        { employee_id: "E002", approver_id: "E002", status: "pending" },
        "E001"
      )
    ).toBe(false);
    expect(
      canDecideExpense(
        director,
        { employee_id: "E001", approver_id: "E000", status: "pending" },
        "E000"
      )
    ).toBe(false);
    expect(
      canDecideExpense(
        executive,
        { employee_id: "E000", approver_id: null, status: "pending" },
        null
      )
    ).toBe(false);
  });

  it("blocks non-approvers and unrelated managers from deciding expenses", () => {
    expect(canDecideExpense(employee, sampleExpense, "E002")).toBe(false);
    expect(canDecideExpense(peer, sampleExpense, "E002")).toBe(false);
    expect(canDecideExpense(otherManager, sampleExpense, "E002")).toBe(false);
  });

  it("allows authorized approvers to decide only pending expenses", () => {
    expect(canDecideExpense(manager, sampleExpense, "E002")).toBe(true);
    expect(canDecideExpense(director, sampleExpense, "E002")).toBe(true);
    expect(canDecideExpense(executive, sampleExpense, "E002")).toBe(true);

    for (const status of ["approved", "rejected"] as const) {
      expect(
        canDecideExpense(manager, { ...sampleExpense, status }, "E002")
      ).toBe(false);
      expect(
        canDecideExpense(director, { ...sampleExpense, status }, "E002")
      ).toBe(false);
    }
  });
});