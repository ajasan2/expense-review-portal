// Unit tests for server-side expense view and approval permissions

import { describe, expect, it } from "vitest";
import {
  canDecideExpense,
  canViewExpense,
  isApproverRole,
} from "@/lib/auth/permissions";
import type { Employee } from "@/types/expense";

function makeEmployee(overrides: Partial<Employee>): Employee {
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
  });

  it("allows owners, assigned managers, and directors to view an expense, but blocks peers and unrelated managers", () => {
    expect(canViewExpense(employee, sampleExpense, "E002")).toBe(true);
    expect(canViewExpense(manager, sampleExpense, "E002")).toBe(true);
    expect(canViewExpense(director, sampleExpense, "E002")).toBe(true);
    expect(canViewExpense(peer, sampleExpense, "E002")).toBe(false);
    expect(canViewExpense(otherManager, sampleExpense, "E002")).toBe(false);
  });

  it("blocks self-approval even if the submitter has a manager or director role", () => {
    const managerSelfExpense = {
      employee_id: "E002",
      approver_id: "E002",
      status: "pending" as const,
    };
    expect(canDecideExpense(manager, managerSelfExpense, "E001")).toBe(false);
  });

  it("allows valid approvers to decide only pending expenses", () => {
    expect(canDecideExpense(manager, sampleExpense, "E002")).toBe(true);
    expect(canDecideExpense(employee, sampleExpense, "E002")).toBe(false);
    expect(
      canDecideExpense(
        manager,
        { ...sampleExpense, status: "approved" },
        "E002"
      )
    ).toBe(false);
  });
});