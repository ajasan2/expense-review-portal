// Deterministic policy checks for Halcyon Expense & Reimbursement Policy v3.2

import type {
  Employee,
  Expense,
  PolicyFinding,
  ReviewVerdict,
} from "@/types/expense";

export type CityTier = "tier_1" | "tier_2" | "standard";

export interface CityRates {
  tier: CityTier;
  mealPerDiemUsd: number;
  lodgingCapUsd: number;
}

export interface PolicyEvaluationResult {
  findings: PolicyFinding[];
  deterministicVerdict: ReviewVerdict;
  suggestedReimbursableAmountUsd: number | null;
}

const TIER_1_CITIES = new Set([
  "new york",
  "nyc",
  "san francisco",
  "sf",
  "boston",
  "seattle",
  "washington dc",
  "washington, dc",
  "dc",
]);

const TIER_2_CITIES = new Set([
  "chicago",
  "los angeles",
  "la",
  "austin",
  "denver",
  "atlanta",
  "miami",
]);

export function getCityRates(city: string): CityRates {
  const normalized = city.trim().toLowerCase();
  if (TIER_1_CITIES.has(normalized)) {
    return { tier: "tier_1", mealPerDiemUsd: 85, lodgingCapUsd: 250 };
  }
  if (TIER_2_CITIES.has(normalized)) {
    return { tier: "tier_2", mealPerDiemUsd: 70, lodgingCapUsd: 200 };
  }
  return { tier: "standard", mealPerDiemUsd: 55, lodgingCapUsd: 150 };
}

function daysBetween(startIso: string, endIso: string): number | null {
  const start = Date.parse(`${startIso}T00:00:00Z`);
  const end = Date.parse(`${endIso}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.round((end - start) / (1000 * 60 * 60 * 24));
}

function parseAttendeeCount(attendees: string | null): number {
  if (!attendees || !attendees.trim()) return 0;
  return attendees
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

export function evaluateDeterministicPolicy(
  expense: Expense,
  employee: Employee
): PolicyEvaluationResult {
  const findings: PolicyFinding[] = [];
  let maxReimbursable: number | null = expense.amount_usd;

  const capReimbursable = (cap: number | null) => {
    if (cap === null) {
      maxReimbursable = null;
      return;
    }
    const clamped = Math.max(0, Number(cap.toFixed(2)));
    maxReimbursable =
      maxReimbursable === null ? clamped : Math.min(maxReimbursable, clamped);
  };

  // Section 2.1: Submission deadline (30 days standard, 31-60 director approval, >60 non-reimbursable)
  const ageDays = daysBetween(expense.expense_date, expense.submitted_date);
  if (ageDays !== null) {
    if (ageDays < 0) {
      findings.push({
        section: "2.1",
        rule_title: "Submission deadline",
        status: "needs_review",
        detail: `Expense date (${expense.expense_date}) is after submitted date (${expense.submitted_date}); verify dates.`,
      });
    } else if (ageDays > 60) {
      capReimbursable(0);
      findings.push({
        section: "2.1",
        rule_title: "Submission deadline (>60 days)",
        status: "policy_violation",
        detail: `Submitted ${ageDays} days after expense date (exceeds 60-day maximum; not reimbursable).`,
        reimbursable_amount_usd: 0,
      });
    } else if (ageDays > 30) {
      findings.push({
        section: "2.1",
        rule_title: "Late submission (31-60 days)",
        status: "needs_review",
        detail: `Submitted ${ageDays} days after expense date; requires additional approval from a director (VP) in reporting chain.`,
      });
    }
  }

  // Section 2.2: Receipt required >= $25.00 (mileage & meal per diem exempt)
  const categoryLower = expense.category.toLowerCase();
  const isMileageOrPerDiem =
    categoryLower.includes("mileage") ||
    categoryLower.includes("per diem") ||
    categoryLower.includes("per-diem");

  if (expense.amount_usd >= 25 && !expense.receipt_attached && !isMileageOrPerDiem) {
    findings.push({
      section: "2.2",
      rule_title: "Itemized receipt required",
      status: "needs_review",
      detail: `Expense of $${expense.amount_usd.toFixed(2)} is $25.00 or more and has no receipt attached.`,
    });
  }

  // Section 2.5: Business purpose required
  if (!expense.description || expense.description.trim().length < 5) {
    findings.push({
      section: "2.5",
      rule_title: "Business purpose",
      status: "needs_review",
      detail: "Expense description is missing or too brief to establish a clear business purpose.",
    });
  }

  // Section 11.1: Unconditional non-reimbursable items
  const descLower = expense.description.toLowerCase();
  const merchantLower = expense.merchant.toLowerCase();
  const combinedText = `${categoryLower} ${merchantLower} ${descLower}`;

  if (
    combinedText.includes("gift card") ||
    combinedText.includes("cash equivalent") ||
    combinedText.includes("parking fine") ||
    combinedText.includes("traffic fine") ||
    combinedText.includes("gym membership") ||
    combinedText.includes("personal entertainment")
  ) {
    capReimbursable(0);
    findings.push({
      section: "11.1",
      rule_title: "Non-reimbursable expense",
      status: "policy_violation",
      detail: "Matches a non-reimbursable category/item under Section 11.1 (fines, gift cards/cash equivalents, gym, or personal entertainment).",
      reimbursable_amount_usd: 0,
    });
  }

  // Section 4.2 & 4.3: Team meals ($40/person) and client entertainment ($100/attendee)
  const attendeeCount = parseAttendeeCount(expense.attendees);
  if (categoryLower.includes("team meal")) {
    if (attendeeCount === 0) {
      findings.push({
        section: "2.3",
        rule_title: "Team meal attendees required",
        status: "needs_review",
        detail: "Team meal must list every attending Halcyon employee.",
      });
    } else {
      const cap = attendeeCount * 40;
      if (expense.amount_usd > cap) {
        capReimbursable(cap);
        findings.push({
          section: "4.2",
          rule_title: "Team meal per-person cap ($40)",
          status: "policy_violation",
          detail: `$${expense.amount_usd.toFixed(2)} exceeds $${cap.toFixed(2)} limit ($40/person across ${attendeeCount} attendees).`,
          reimbursable_amount_usd: cap,
        });
      }
    }
  }

  if (categoryLower.includes("client entertainment") || categoryLower.includes("client meal")) {
    if (attendeeCount === 0) {
      findings.push({
        section: "2.3",
        rule_title: "Client entertainment attendees & company",
        status: "needs_review",
        detail: "Client entertainment must list every attendee and include client company names.",
      });
    } else {
      const cap = attendeeCount * 100;
      if (expense.amount_usd > cap) {
        capReimbursable(cap);
        findings.push({
          section: "4.3",
          rule_title: "Client entertainment cap ($100/attendee)",
          status: "policy_violation",
          detail: `$${expense.amount_usd.toFixed(2)} exceeds $${cap.toFixed(2)} limit ($100/attendee across ${attendeeCount} attendees).`,
          reimbursable_amount_usd: cap,
        });
      }
    }
  }

  // Section 6.2: Lodging nightly cap by city tier
  if (categoryLower.includes("lodging") || categoryLower.includes("hotel")) {
    const rates = getCityRates(expense.city);
    if (expense.amount_usd > rates.lodgingCapUsd) {
      capReimbursable(rates.lodgingCapUsd);
      findings.push({
        section: "6.2",
        rule_title: "Lodging nightly cap",
        status: "policy_violation",
        detail: `$${expense.amount_usd.toFixed(2)} exceeds ${expense.city || "city"} nightly lodging cap of $${rates.lodgingCapUsd.toFixed(2)}.`,
        reimbursable_amount_usd: rates.lodgingCapUsd,
      });
    }
  }

  // Section 6.3: Ground transport mileage rate ($0.70/mile) & premium rideshare check
  if (
    combinedText.includes("uber black") ||
    combinedText.includes("uber lux") ||
    combinedText.includes("lyft lux")
  ) {
    capReimbursable(0);
    findings.push({
      section: "6.3",
      rule_title: "Premium rideshare not reimbursable",
      status: "policy_violation",
      detail: "Premium rideshare tiers (e.g., Uber Black, Uber Lux, Lyft Lux) are not reimbursable under Section 6.3.",
      reimbursable_amount_usd: 0,
    });
  }

  if (categoryLower.includes("mileage") || descLower.includes("mile")) {
    const milesMatch = descLower.match(/(\d+(?:\.\d+)?)\s*mi(?:les?)?/i);
    if (milesMatch) {
      const miles = Number(milesMatch[1]);
      const expectedMax = Number((miles * 0.7).toFixed(2));
      if (expense.amount_usd > expectedMax + 0.01) {
        capReimbursable(expectedMax);
        findings.push({
          section: "6.3",
          rule_title: "Mileage reimbursement rate ($0.70/mi)",
          status: "policy_violation",
          detail: `$${expense.amount_usd.toFixed(2)} exceeds $0.70/mile cap for ${miles} miles ($${expectedMax.toFixed(2)}).`,
          reimbursable_amount_usd: expectedMax,
        });
      }
    }
  }

  // Section 7.1: Home office & equipment ($500 annual allowance)
  if (categoryLower.includes("home office") || categoryLower.includes("equipment")) {
    const remainingAllowance = Math.max(
      0,
      Number((500 - employee.home_office_spent_ytd_usd).toFixed(2))
    );
    if (remainingAllowance === 0 || expense.amount_usd > remainingAllowance) {
      capReimbursable(remainingAllowance);
      findings.push({
        section: "7.1",
        rule_title: "Home office annual limit ($500 YTD)",
        status: "policy_violation",
        detail: `Expense of $${expense.amount_usd.toFixed(2)} exceeds remaining $500 annual allowance ($${remainingAllowance.toFixed(2)} remaining after $${employee.home_office_spent_ytd_usd.toFixed(2)} YTD).`,
        reimbursable_amount_usd: remainingAllowance,
      });
    }
  }

  // Section 9.1: Conference / training registration > $500 requires director pre-approval
  if (
    (categoryLower.includes("conference") || categoryLower.includes("training")) &&
    expense.amount_usd > 500
  ) {
    const hasPreApprovalNote =
      descLower.includes("approv") ||
      descLower.includes("vp") ||
      descLower.includes("director");
    if (!hasPreApprovalNote) {
      findings.push({
        section: "9.1",
        rule_title: "Conference/training pre-approval (> $500)",
        status: "needs_review",
        detail: "Registration over $500 requires director (VP) pre-approval (approver and date noted in description).",
      });
    }
  }

  let deterministicVerdict: ReviewVerdict = "compliant";
  if (findings.some((f) => f.status === "policy_violation")) {
    deterministicVerdict = "policy_violation";
  } else if (findings.some((f) => f.status === "needs_review")) {
    deterministicVerdict = "needs_review";
  }

  return {
    findings,
    deterministicVerdict,
    suggestedReimbursableAmountUsd:
      deterministicVerdict === "compliant" ? expense.amount_usd : maxReimbursable,
  };
}