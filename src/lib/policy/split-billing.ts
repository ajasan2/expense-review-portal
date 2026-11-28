import type { Expense } from "@/types/expense";

export interface SplitBillingMatch {
  matchedExpenses: Expense[];
  combinedAmountUsd: number;
}

function normalizeMerchant(merchant: string): string {
  return merchant.trim().toLowerCase().replace(/\s+/g, " ");
}

function daysApart(aIso: string, bIso: string): number {
  const a = Date.parse(`${aIso}T00:00:00Z`);
  const b = Date.parse(`${bIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.round((a - b) / (1000 * 60 * 60 * 24)));
}

/**
 * Finds other expenses by the same employee that appear to be split parts
 * of a single purchase (same merchant + same expense_date or within 1 day,
 * excluding rejected claims).
 */
export function findPotentialSplitExpenses(
  target: Pick<Expense, "expense_id" | "employee_id" | "merchant" | "expense_date">,
  candidates: Expense[]
): SplitBillingMatch {
  const targetMerchant = normalizeMerchant(target.merchant);
  const matched = candidates.filter((other) => {
    if (other.expense_id === target.expense_id) return false;
    if (other.employee_id !== target.employee_id) return false;
    if (other.status === "rejected") return false;
    if (!targetMerchant || normalizeMerchant(other.merchant) !== targetMerchant) {
      return false;
    }
    return daysApart(target.expense_date, other.expense_date) <= 1;
  });

  const combinedAmountUsd = Number(
    matched.reduce((sum, item) => sum + Number(item.amount_usd), 0).toFixed(2)
  );

  return { matchedExpenses: matched, combinedAmountUsd };
}