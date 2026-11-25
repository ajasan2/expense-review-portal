// src/lib/llm/review-expense.ts: Gemini structured policy review with deterministic rule grounding

import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { evaluateDeterministicPolicy } from "@/lib/policy";
import type {
  Employee,
  Expense,
  ExpenseReview,
  PolicyFinding,
  ReviewVerdict,
} from "@/types/expense";

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

export interface GeminiClientLike {
  models: {
    generateContent(params: {
      model: string;
      contents: string;
      config?: Record<string, unknown>;
    }): Promise<{ text?: string }>;
  };
}

export interface ReviewExpenseInput {
  expense: Expense;
  employee: Employee;
  modelName?: string;
  client?: GeminiClientLike;
}

export interface GeneratedExpenseReview
  extends Omit<ExpenseReview, "id" | "reviewed_at"> {}

const reviewResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    verdict: {
      type: Type.STRING,
      enum: ["compliant", "needs_review", "policy_violation"],
    },
    reimbursable_amount_usd: {
      type: Type.NUMBER,
      nullable: true,
    },
    summary: {
      type: Type.STRING,
    },
    findings: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          section: { type: Type.STRING },
          rule_title: { type: Type.STRING },
          status: {
            type: Type.STRING,
            enum: ["compliant", "needs_review", "policy_violation"],
          },
          detail: { type: Type.STRING },
          reimbursable_amount_usd: { type: Type.NUMBER, nullable: true },
        },
        required: ["section", "rule_title", "status", "detail"],
      },
    },
  },
  required: ["verdict", "reimbursable_amount_usd", "summary", "findings"],
};

function mergeFindings(
  deterministic: PolicyFinding[],
  llmFindings: PolicyFinding[]
): PolicyFinding[] {
  const seen = new Set(
    deterministic.map((f) => `${f.section}::${f.rule_title.toLowerCase()}`)
  );
  const merged = [...deterministic];

  for (const item of llmFindings) {
    const key = `${item.section}::${item.rule_title.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  }

  return merged;
}

function resolveVerdict(
  deterministicVerdict: ReviewVerdict,
  llmVerdict: ReviewVerdict,
  mergedFindings: PolicyFinding[]
): ReviewVerdict {
  if (
    deterministicVerdict === "policy_violation" ||
    llmVerdict === "policy_violation" ||
    mergedFindings.some((f) => f.status === "policy_violation")
  ) {
    return "policy_violation";
  }
  if (
    deterministicVerdict === "needs_review" ||
    llmVerdict === "needs_review" ||
    mergedFindings.some((f) => f.status === "needs_review")
  ) {
    return "needs_review";
  }
  return "compliant";
}

export async function reviewExpenseWithGemini({
  expense,
  employee,
  modelName = DEFAULT_GEMINI_MODEL,
  client,
}: ReviewExpenseInput): Promise<GeneratedExpenseReview> {
  const deterministic = evaluateDeterministicPolicy(expense, employee);

  const ai: GeminiClientLike =
    client ??
    (() => {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not set");
      }
      return new GoogleGenAI({ apiKey });
    })();

  const prompt = [
    "You are an expense compliance reviewer for Halcyon Logistics (Policy v3.2).",
    "Evaluate the expense against Halcyon policy rules (submission deadlines, $25 receipt rule, attendees & client companies, meal/client caps, alcohol rules, air travel class/advance booking, lodging/per-diem city tiers, ground transport/mileage $0.70/mi, $500 annual home office cap, IT software pre-approval, >$500 conference/training pre-approval, $75 client gift cap, and non-reimbursable items).",
    "Deterministic rule findings already computed:",
    JSON.stringify(deterministic.findings),
    "Employee context:",
    JSON.stringify({
      employee_id: employee.employee_id,
      full_name: employee.full_name,
      role: employee.role,
      location: employee.location,
      home_office_spent_ytd_usd: employee.home_office_spent_ytd_usd,
    }),
    "Expense record:",
    JSON.stringify(expense),
    "Return a concise summary and any additional policy findings not already listed.",
  ].join("\n\n");

  const response = await ai.models.generateContent({
    model: modelName,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: reviewResponseSchema,
      temperature: 0.1,
    },
  });

  const rawText = response.text ?? "{}";
  let parsed: {
    verdict?: ReviewVerdict;
    reimbursable_amount_usd?: number | null;
    summary?: string;
    findings?: PolicyFinding[];
  } = {};

  try {
    parsed = JSON.parse(rawText);
  } catch {
    parsed = {};
  }

  const llmFindings = Array.isArray(parsed.findings) ? parsed.findings : [];
  const findings = mergeFindings(deterministic.findings, llmFindings);
  const llmVerdict: ReviewVerdict =
    parsed.verdict === "compliant" ||
    parsed.verdict === "needs_review" ||
    parsed.verdict === "policy_violation"
      ? parsed.verdict
      : deterministic.deterministicVerdict;

  const verdict = resolveVerdict(
    deterministic.deterministicVerdict,
    llmVerdict,
    findings
  );

  let reimbursableAmountUsd: number | null =
    typeof parsed.reimbursable_amount_usd === "number"
      ? parsed.reimbursable_amount_usd
      : deterministic.suggestedReimbursableAmountUsd;

  if (
    deterministic.deterministicVerdict === "policy_violation" &&
    deterministic.suggestedReimbursableAmountUsd !== null &&
    reimbursableAmountUsd !== null
  ) {
    reimbursableAmountUsd = Math.min(
      reimbursableAmountUsd,
      deterministic.suggestedReimbursableAmountUsd
    );
  }

  if (reimbursableAmountUsd !== null) {
    reimbursableAmountUsd = Math.max(
      0,
      Math.min(expense.amount_usd, Number(reimbursableAmountUsd.toFixed(2)))
    );
  }

  const summary =
    typeof parsed.summary === "string" && parsed.summary.trim().length > 0
      ? parsed.summary.trim()
      : `Evaluated expense ${expense.expense_id} (${verdict}).`;

  return {
    expense_id: expense.expense_id,
    verdict,
    findings,
    reimbursable_amount_usd: reimbursableAmountUsd,
    summary,
    model_name: modelName,
  };
}