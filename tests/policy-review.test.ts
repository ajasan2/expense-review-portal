// Unit tests for Halcyon policy evaluation and llm review service

import { afterEach, describe, expect, it, vi } from "vitest";
import { reviewExpenseWithAi, type AiClientLike } from "@/lib/llm";
import { evaluateDeterministicPolicy, getCityRates } from "@/lib/policy";
import type { Employee, Expense } from "@/types/expense";

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
    home_office_spent_ytd_usd: 150,
    ...overrides,
  };
}

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    expense_id: "EXP-100",
    employee_id: "E008",
    expense_date: "2026-04-10",
    submitted_date: "2026-04-15",
    category: "Meals",
    merchant: "Local Bistro",
    amount_usd: 20,
    city: "Chicago",
    receipt_attached: false,
    attendees: null,
    description: "Lunch with team during sprint planning",
    status: "pending",
    approver_id: "E002",
    decided_date: null,
    decision_comment: null,
    created_at: "2026-04-15T12:00:00Z",
    updated_at: "2026-04-15T12:00:00Z",
    ...overrides,
  };
}

describe("Halcyon policy rules (v3.2)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("resolves city tiers and caps accurately", () => {
    expect(getCityRates("New York")).toEqual({
      tier: "tier_1",
      mealPerDiemUsd: 85,
      lodgingCapUsd: 250,
    });
    expect(getCityRates("Chicago")).toEqual({
      tier: "tier_2",
      mealPerDiemUsd: 70,
      lodgingCapUsd: 200,
    });
    expect(getCityRates("Columbus")).toEqual({
      tier: "standard",
      mealPerDiemUsd: 55,
      lodgingCapUsd: 150,
    });
  });

  it("marks small receipt-exempt expenses with a clear business purpose as compliant", () => {
    const result = evaluateDeterministicPolicy(makeExpense(), makeEmployee());
    expect(result.deterministicVerdict).toBe("compliant");
    expect(result.suggestedReimbursableAmountUsd).toBe(20);
  });

  it("flags potential split billing and reports combined threshold requirements", () => {
    const current = makeExpense({
      expense_id: "EXP-201",
      category: "Software",
      merchant: "Acme Cloud",
      amount_usd: 750,
      receipt_attached: true,
      description: "Annual license part 1",
    });
    const prior = makeExpense({
      expense_id: "EXP-200",
      category: "Software",
      merchant: "Acme Cloud",
      amount_usd: 700,
      receipt_attached: true,
      description: "Annual license part 2",
    });

    const result = evaluateDeterministicPolicy(current, makeEmployee(), [prior]);
    expect(result.deterministicVerdict).toBe("policy_violation");
    const splitFinding = result.findings.find((f) => f.section === "2.4");
    expect(splitFinding).toBeDefined();
    expect(splitFinding?.detail).toContain("$1450.00");
    expect(splitFinding?.detail).toContain("EXP-200");
  });

  it("flags expenses >= $25 missing a receipt for review", () => {
    const result = evaluateDeterministicPolicy(
      makeExpense({ amount_usd: 45, receipt_attached: false }),
      makeEmployee()
    );
    expect(result.deterministicVerdict).toBe("needs_review");
    expect(result.findings.some((f) => f.section === "2.2")).toBe(true);
  });

  it("flags 31-60 day submissions for review and rejects >60 day submissions", () => {
    const lateReview = evaluateDeterministicPolicy(
      makeExpense({
        expense_date: "2026-03-01",
        submitted_date: "2026-04-10",
        amount_usd: 18,
      }),
      makeEmployee()
    );
    expect(lateReview.deterministicVerdict).toBe("needs_review");
    expect(lateReview.findings.some((f) => f.section === "2.1")).toBe(true);

    const expired = evaluateDeterministicPolicy(
      makeExpense({
        expense_date: "2026-01-01",
        submitted_date: "2026-04-10",
        amount_usd: 18,
      }),
      makeEmployee()
    );
    expect(expired.deterministicVerdict).toBe("policy_violation");
    expect(expired.suggestedReimbursableAmountUsd).toBe(0);
  });

  it("enforces team meal ($40/person) and client entertainment ($100/attendee) caps", () => {
    const teamMealOverCap = evaluateDeterministicPolicy(
      makeExpense({
        category: "Team Meal",
        amount_usd: 105,
        attendees: "Alice, Bob",
        receipt_attached: true,
      }),
      makeEmployee()
    );
    expect(teamMealOverCap.deterministicVerdict).toBe("policy_violation");
    expect(teamMealOverCap.suggestedReimbursableAmountUsd).toBe(80);

    const clientOverCap = evaluateDeterministicPolicy(
      makeExpense({
        category: "Client Entertainment",
        amount_usd: 350,
        attendees: "Sam Patel, Jane Doe (Acme)",
        receipt_attached: true,
      }),
      makeEmployee()
    );
    expect(clientOverCap.deterministicVerdict).toBe("policy_violation");
    expect(clientOverCap.suggestedReimbursableAmountUsd).toBe(200);
  });

  it("enforces lodging caps by city tier and home office annual allowance", () => {
    const lodgingViolation = evaluateDeterministicPolicy(
      makeExpense({
        category: "Lodging",
        city: "Chicago",
        amount_usd: 240,
        receipt_attached: true,
      }),
      makeEmployee()
    );
    expect(lodgingViolation.deterministicVerdict).toBe("policy_violation");
    expect(lodgingViolation.suggestedReimbursableAmountUsd).toBe(200);

    const homeOfficeViolation = evaluateDeterministicPolicy(
      makeExpense({
        category: "Home Office",
        amount_usd: 400,
        receipt_attached: true,
      }),
      makeEmployee({ home_office_spent_ytd_usd: 150 })
    );
    expect(homeOfficeViolation.deterministicVerdict).toBe("policy_violation");
    expect(homeOfficeViolation.suggestedReimbursableAmountUsd).toBe(350);
  });

  it("flags non-reimbursable items and premium rideshare tiers", () => {
    const giftCard = evaluateDeterministicPolicy(
      makeExpense({
        category: "Gifts",
        merchant: "Amazon",
        amount_usd: 50,
        receipt_attached: true,
        description: "Client gift card",
      }),
      makeEmployee()
    );
    expect(giftCard.deterministicVerdict).toBe("policy_violation");
    expect(giftCard.suggestedReimbursableAmountUsd).toBe(0);

    const uberBlack = evaluateDeterministicPolicy(
      makeExpense({
        category: "Ground Transport",
        merchant: "Uber Black",
        amount_usd: 75,
        receipt_attached: true,
        description: "Ride to airport",
      }),
      makeEmployee()
    );
    expect(uberBlack.deterministicVerdict).toBe("policy_violation");
    expect(uberBlack.suggestedReimbursableAmountUsd).toBe(0);
  });

  it("merges AI structured output without allowing an optimistic override of a policy violation", async () => {
    const mockClient: AiClientLike = {
      chat: {
        completions: {
          create: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    verdict: "compliant",
                    reimbursable_amount_usd: 240,
                    summary: "Looks good overall.",
                    findings: [
                      {
                        section: "6.2",
                        rule_title: "Lodging nightly cap note",
                        status: "needs_review",
                        detail: "Confirm hotel tax breakdown on receipt.",
                      },
                    ],
                  }),
                },
              },
            ],
          }),
        },
      },
    };

    const review = await reviewExpenseWithAi({
      expense: makeExpense({
        category: "Lodging",
        city: "Chicago",
        amount_usd: 240,
        receipt_attached: true,
      }),
      employee: makeEmployee(),
      client: mockClient,
    });

    expect(review.verdict).toBe("policy_violation");
    expect(review.reimbursable_amount_usd).toBe(200);
    expect(review.findings.length).toBeGreaterThanOrEqual(2);
  });

  it("escalates verdict when deterministic rules pass but AI flags a violation or review", async () => {
    const compliantExpense = makeExpense({
      expense_id: "EXP-101",
      amount_usd: 20,
      receipt_attached: false,
      description: "Team lunch during sprint planning",
    });

    const violationClient: AiClientLike = {
      chat: {
        completions: {
          create: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    verdict: "policy_violation",
                    reimbursable_amount_usd: 0,
                    summary: "Unlisted alcohol purchase found on itemized slip.",
                    findings: [
                      {
                        section: "4.3",
                        rule_title: "Alcohol prohibition",
                        status: "policy_violation",
                        detail: "Alcohol is not reimbursable under policy.",
                        reimbursable_amount_usd: 0,
                      },
                    ],
                  }),
                },
              },
            ],
          }),
        },
      },
    };

    const review = await reviewExpenseWithAi({
      expense: compliantExpense,
      employee: makeEmployee(),
      client: violationClient,
    });

    expect(review.verdict).toBe("policy_violation");
    expect(
      review.findings.some((f) => f.rule_title === "Alcohol prohibition")
    ).toBe(true);
  });

  it("deduplicates matching findings, filters empty details, and clamps reimbursable amounts", async () => {
    const mockClient: AiClientLike = {
      chat: {
        completions: {
          create: async () => ({
            choices: [
              {
                message: {
                  content: `Here is the evaluation:\n\`\`\`json\n${JSON.stringify({
                    verdict: "needs_review",
                    reimbursable_amount_usd: 999.999,
                    summary: "  Fenced JSON response with extra findings.  ",
                    findings: [
                      {
                        section: "5.1",
                        rule_title: "Airfare cabin check",
                        status: "invalid_status",
                        detail: "Economy cabin verified.",
                        reimbursable_amount_usd: Number.NaN,
                      },
                      {
                        section: "5.1",
                        rule_title: "AIRFARE CABIN CHECK",
                        status: "needs_review",
                        detail: "Duplicate LLM finding with same section and title.",
                        reimbursable_amount_usd: 20,
                      },
                      {
                        section: "5.2",
                        rule_title: "Empty detail finding",
                        status: "needs_review",
                        detail: "   ",
                      },
                    ],
                  })}\n\`\`\``,
                },
              },
            ],
          }),
        },
      },
    };

    const review = await reviewExpenseWithAi({
      expense: makeExpense({
        expense_id: "EXP-102",
        amount_usd: 45,
        receipt_attached: false,
      }),
      employee: makeEmployee(),
      client: mockClient,
    });

    const cabinFindings = review.findings.filter(
      (f) => f.section === "5.1" && f.rule_title === "Airfare cabin check"
    );
    expect(cabinFindings).toHaveLength(1);
    expect(cabinFindings[0]?.status).toBe("needs_review");
    expect(cabinFindings[0]?.reimbursable_amount_usd).toBeNull();
    expect(
      review.findings.some((f) => f.rule_title === "Empty detail finding")
    ).toBe(false);
    expect(review.reimbursable_amount_usd).toBe(45);
    expect(review.summary).toBe("Fenced JSON response with extra findings.");
  });

  it("surfaces AI errors and missing config while keeping deterministic policy results", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const badJsonClient: AiClientLike = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: "{not valid json" } }],
          }),
        },
      },
    };

    const malformedReview = await reviewExpenseWithAi({
      expense: makeExpense({ expense_id: "EXP-103", amount_usd: 20 }),
      employee: makeEmployee(),
      client: badJsonClient,
    });

    expect(malformedReview.verdict).toBe("needs_review");
    expect(malformedReview.reimbursable_amount_usd).toBe(20);
    expect(malformedReview.summary).toContain("could not be parsed as JSON");
    expect(
      malformedReview.findings.some((f) => f.rule_title === "Malformed AI Response")
    ).toBe(true);
    expect(warnSpy).toHaveBeenCalled();

    const throwingClient: AiClientLike = {
      chat: {
        completions: {
          create: async () => {
            throw new Error("Network timeout");
          },
        },
      },
    };

    const thrownReview = await reviewExpenseWithAi({
      expense: makeExpense({ expense_id: "EXP-104", amount_usd: 20 }),
      employee: makeEmployee(),
      client: throwingClient,
    });

    expect(thrownReview.model_name).toBe("deterministic-fallback");
    expect(thrownReview.verdict).toBe("needs_review");
    expect(thrownReview.reimbursable_amount_usd).toBe(20);
    expect(thrownReview.summary).toContain("Network timeout");
    expect(
      thrownReview.findings.some(
        (f) => f.rule_title === "AI Policy Review Fallback"
      )
    ).toBe(true);
    expect(errorSpy).toHaveBeenCalled();

    vi.stubEnv("GROQ_API_KEY", "");
    const missingKeyReview = await reviewExpenseWithAi({
      expense: makeExpense({ expense_id: "EXP-105", amount_usd: 20 }),
      employee: makeEmployee(),
    });

    expect(missingKeyReview.model_name).toBe("deterministic-fallback");
    expect(missingKeyReview.verdict).toBe("needs_review");
    expect(missingKeyReview.reimbursable_amount_usd).toBe(20);
    expect(missingKeyReview.summary).toContain("GROQ_API_KEY missing");
    expect(
      missingKeyReview.findings.some(
        (f) => f.rule_title === "AI Policy Review Unavailable"
      )
    ).toBe(true);
  });
});