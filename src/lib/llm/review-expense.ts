// AI structured policy review with deterministic grounding & fallback

import { evaluateDeterministicPolicy } from "@/lib/policy";
import type {
  Employee,
  Expense,
  ExpenseReview,
  PolicyFinding,
  ReviewVerdict,
} from "@/types/expense";

export const DEFAULT_AI_MODEL = "openai/gpt-oss-120b";
const GROQ_CHAT_COMPLETIONS_URL =
  "https://api.groq.com/openai/v1/chat/completions";
const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_RETRY_DELAY_MS = 15_000;

export interface AiClientLike {
  chat: {
    completions: {
      create(params: Record<string, unknown>): Promise<{
        choices?: Array<{
          message?: {
            content?: string | null;
          };
        }>;
      }>;
    };
  };
}

export interface ReviewExpenseInput {
  expense: Expense;
  employee: Employee;
  modelName?: string;
  client?: AiClientLike;
}

export interface GeneratedExpenseReview
  extends Omit<ExpenseReview, "id" | "reviewed_at"> {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(
  retryAfterHeader: string | null,
  errText: string,
  attempt: number
): number {
  const fallbackMs = Math.min(MAX_RETRY_DELAY_MS, 2_000 * 2 ** attempt);

  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(MAX_RETRY_DELAY_MS, Math.ceil(seconds * 1_000) + 250);
    }
    const dateMs = Date.parse(retryAfterHeader);
    if (!Number.isNaN(dateMs)) {
      const diff = dateMs - Date.now();
      if (diff > 0) {
        return Math.min(MAX_RETRY_DELAY_MS, diff + 250);
      }
    }
  }

  const messageMatch = errText.match(/try again in\s+([0-9]+(?:\.[0-9]+)?)s/i);
  if (messageMatch) {
    const parsedSeconds = Number(messageMatch[1]);
    if (Number.isFinite(parsedSeconds) && parsedSeconds > 0) {
      return Math.min(
        MAX_RETRY_DELAY_MS,
        Math.ceil(parsedSeconds * 1_000) + 250
      );
    }
  }

  return fallbackMs;
}

function createDefaultGroqClient(apiKey: string): AiClientLike {
  return {
    chat: {
      completions: {
        async create(body) {
          for (let attempt = 0; ; attempt++) {
            const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              signal: AbortSignal.timeout(15_000),
              body: JSON.stringify(body),
            });

            if (response.ok) {
              return response.json();
            }

            const errText = await response.text().catch(() => "");

            if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
              const waitMs = parseRetryAfterMs(
                response.headers.get("retry-after"),
                errText,
                attempt
              );
              console.warn(
                `[review-expense] Rate limited (429); retrying in ${waitMs}ms (attempt ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES}).`
              );
              await sleep(waitMs);
              continue;
            }

            throw new Error(
              `Groq API error (${response.status}): ${errText || response.statusText}`
            );
          }
        },
      },
    },
  };
}

function extractJsonObject(rawText: string): string {
  const trimmed = rawText.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return "{}";
}

function sanitizeFindings(raw: unknown): PolicyFinding[] {
  if (!Array.isArray(raw)) return [];
  const validStatuses: ReviewVerdict[] = [
    "compliant",
    "needs_review",
    "policy_violation",
  ];

  return raw
    .filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === "object")
    )
    .map((item) => {
      const status: ReviewVerdict = validStatuses.includes(
        item.status as ReviewVerdict
      )
        ? (item.status as ReviewVerdict)
        : "needs_review";

      const reimbursable =
        typeof item.reimbursable_amount_usd === "number" &&
        Number.isFinite(item.reimbursable_amount_usd)
          ? item.reimbursable_amount_usd
          : null;

      return {
        section:
          typeof item.section === "string" && item.section.trim()
            ? item.section.trim()
            : "Halcyon Policy v3.2",
        rule_title:
          typeof item.rule_title === "string" && item.rule_title.trim()
            ? item.rule_title.trim()
            : "Policy Observation",
        status,
        detail:
          typeof item.detail === "string" && item.detail.trim()
            ? item.detail.trim()
            : "",
        reimbursable_amount_usd: reimbursable,
      };
    })
    .filter((f) => f.detail.length > 0);
}

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

function finalizeReview(params: {
  expense: Expense;
  deterministic: ReturnType<typeof evaluateDeterministicPolicy>;
  llmVerdict: ReviewVerdict;
  llmFindings: PolicyFinding[];
  llmReimbursableAmountUsd?: number | null;
  llmSummary?: string;
  modelName: string;
}): GeneratedExpenseReview {
  const {
    expense,
    deterministic,
    llmVerdict,
    llmFindings,
    llmReimbursableAmountUsd,
    llmSummary,
    modelName,
  } = params;

  const findings = mergeFindings(deterministic.findings, llmFindings);
  const verdict = resolveVerdict(
    deterministic.deterministicVerdict,
    llmVerdict,
    findings
  );

  let reimbursableAmountUsd: number | null =
    typeof llmReimbursableAmountUsd === "number" &&
    Number.isFinite(llmReimbursableAmountUsd)
      ? llmReimbursableAmountUsd
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
    typeof llmSummary === "string" && llmSummary.trim().length > 0
      ? llmSummary.trim()
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

export async function reviewExpenseWithAi({
  expense,
  employee,
  modelName = process.env.GROQ_MODEL || DEFAULT_AI_MODEL,
  client,
}: ReviewExpenseInput): Promise<GeneratedExpenseReview> {
  const deterministic = evaluateDeterministicPolicy(expense, employee);
  const apiKey = process.env.GROQ_API_KEY;

  if (!client && !apiKey) {
    console.warn(
      "[review-expense] GROQ_API_KEY is missing; using deterministic fallback."
    );
    const missingKeyFinding: PolicyFinding = {
      section: "System / AI Review",
      rule_title: "AI Policy Review Unavailable",
      status: "needs_review",
      detail:
        "GROQ_API_KEY is not configured. Only deterministic Halcyon v3.2 policy checks were evaluated.",
      reimbursable_amount_usd: null,
    };

    return finalizeReview({
      expense,
      deterministic,
      llmVerdict: "needs_review",
      llmFindings: [missingKeyFinding],
      llmReimbursableAmountUsd: deterministic.suggestedReimbursableAmountUsd,
      llmSummary: `AI review skipped (GROQ_API_KEY missing); showing deterministic Halcyon v3.2 check only (${deterministic.deterministicVerdict}).`,
      modelName: "deterministic-fallback",
    });
  }

  const groqClient: AiClientLike =
    client ?? createDefaultGroqClient(apiKey as string);

  const systemPrompt = [
    "You are an expense compliance reviewer for Halcyon Logistics (Policy v3.2).",
    "Evaluate the expense against Halcyon policy rules (submission deadlines, $25 receipt rule, attendees & client companies, meal/client caps, alcohol rules, air travel class/advance booking, lodging/per-diem city tiers, ground transport/mileage $0.70/mi, $500 annual home office cap, IT software pre-approval, >$500 conference/training pre-approval, $75 client gift cap, and non-reimbursable items).",
    "Do not contradict deterministic rule violations or caps.",
    'Return ONLY valid JSON matching: {"verdict":"compliant"|"needs_review"|"policy_violation","reimbursable_amount_usd":number|null,"summary":string,"findings":[{"section":string,"rule_title":string,"status":"compliant"|"needs_review"|"policy_violation","detail":string,"reimbursable_amount_usd":number|null}]}.',
  ].join(" ");

  const userPrompt = [
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

  try {
    const completion = await groqClient.chat.completions.create({
      model: modelName,
      temperature: 0.1,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const rawText = completion.choices?.[0]?.message?.content ?? "{}";
    const extractedJson = extractJsonObject(rawText);
    const hadNoJsonObject = extractedJson === "{}" && rawText.trim() !== "{}";

    if (hadNoJsonObject) {
      console.warn(
        "[review-expense] AI response did not contain a JSON object."
      );
    }

    const parsed = JSON.parse(extractedJson) as {
      verdict?: ReviewVerdict;
      reimbursable_amount_usd?: number | null;
      summary?: string;
      findings?: unknown;
    };

    const extraFindings = sanitizeFindings(parsed.findings);
    if (hadNoJsonObject) {
      extraFindings.unshift({
        section: "System / AI Review",
        rule_title: "Malformed AI Response",
        status: "needs_review",
        detail:
          "AI response did not return a valid JSON object. Deterministic policy checks were applied.",
        reimbursable_amount_usd: null,
      });
    }

    const llmVerdict: ReviewVerdict = hadNoJsonObject
      ? "needs_review"
      : parsed.verdict === "compliant" ||
          parsed.verdict === "needs_review" ||
          parsed.verdict === "policy_violation"
        ? parsed.verdict
        : deterministic.deterministicVerdict;

    const summary = hadNoJsonObject
      ? `AI response could not be parsed as JSON; showing deterministic Halcyon v3.2 check (${deterministic.deterministicVerdict}).`
      : parsed.summary;

    return finalizeReview({
      expense,
      deterministic,
      llmVerdict,
      llmFindings: extraFindings,
      llmReimbursableAmountUsd: parsed.reimbursable_amount_usd,
      llmSummary: summary,
      modelName,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown AI review error";
    console.error("[review-expense] AI review failed, falling back:", error);

    const fallbackFinding: PolicyFinding = {
      section: "System / AI Review",
      rule_title: "AI Policy Review Fallback",
      status: "needs_review",
      detail: `Automated AI review failed (${errorMessage}). Only deterministic policy checks were evaluated.`,
      reimbursable_amount_usd: null,
    };

    return finalizeReview({
      expense,
      deterministic,
      llmVerdict: "needs_review",
      llmFindings: [fallbackFinding],
      llmReimbursableAmountUsd: deterministic.suggestedReimbursableAmountUsd,
      llmSummary: `AI review failed (${errorMessage}); showing deterministic Halcyon v3.2 evaluation only.`,
      modelName: "deterministic-fallback",
    });
  }
}