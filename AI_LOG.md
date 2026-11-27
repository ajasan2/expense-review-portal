# AI Development Log

## Tools Used, For What, and Why

- **Gemini**: Used to help configure local Google Cloud CLI authentication, outline an ideal Next.js/TypeScript project structure aligned with clean architectural boundaries, and evaluate policy architecture tradeoffs (deterministic rules first + AI vs. all-AI evaluation) and auth tradeoffs (app-level demo/session flow vs. industry-standard identity providers).
- **AI Coding / Chat Assistance (in-editor & conversation)**: Used to explore tradeoffs between Node's built-in test runner and Vitest, draft the initial SQL schema/migration/seed structure, iterate on policy rule edge cases and UI workflows, and review persistence and layout details.

## Concrete Examples Where AI Output Was Wrong, Incomplete, or Insecure

1. **Cookie / Auth Implementation Assuming Vercel Deployment**:
   - **What it produced**: An initial cookie/session setup tailored around Vercel deployment assumptions.
   - **How I caught it**: I target **Google Cloud** for deployment rather than Vercel, so relying on platform-specific assumptions risked mismatching my deployment environment.
   - **What I changed**: Reminded the model of the Google Cloud deployment target and kept session handling aligned with standard Next.js server/cookie behavior and explicit environment configuration.

2. **Project Structure Drift & Unnecessary Deep Navigations**:
   - **What it produced**: Suggestions that drifted from the established folder layout or introduced extra nested navigation steps.
   - **How I caught it**: Comparing proposed changes against the repository tree showed unnecessary complexity and inconsistent structure.
   - **What I changed**: Realigned implementations around the existing `src/app`, `src/lib`, `db/`, and `tests/` structure and kept user flows direct (`/expenses`, `/expenses/[id]`, and `/manager`).

3. **Workflow & UI Discrepancies Caught During End-to-End Testing**:
   - **What it produced**: Initial UI and form flows where (a) `submitted_date` was exposed as an editable date input in the submission form, (b) approvers could still see the `"Run / Re-run Policy Review"` button on their own expenses, and (c) manager approval comments were saved on decisions but not surfaced clearly on the expense detail view when switching back to the employee view.
   - **How I caught it**: Walking through employee and manager workflows manually in the browser and checking database rows exposed each gap directly.
   - **What I changed**: Removed `submitted_date` from the form UI and automated it server-side, restricted the review trigger on `/expenses/[id]` to authorized approvers on non-owned expenses (`!isOwnExpense`), and surfaced `decision_comment` and `decided_date` in the expense detail view while normalizing empty/whitespace comments on the server.

## Prompt I Am Most Proud Of

- **Prompt**: Asking for explicit architectural tradeoffs—specifically comparing deterministic policy rules first paired with AI versus an all-AI policy engine, and comparing app-level authentication/session mechanics against industry-standard auth—while keeping project structure and failure modes in view.
- **Why it worked**: Instead of asking for generic code generation, framing the constraints and tradeoffs upfront forced concrete comparisons around determinism, cost/rate-limit resilience, auditability, and maintainability, leading to a cleaner hybrid design (`rules.ts` + `review-expense.ts` with explicit fallback/error states).

## What I Deliberately Wrote, Reviewed, or Designed Myself

- **Understanding the Database Schema Line by Line & Testing Idempotency**: After generating the initial SQL schema and seeding setup, I went through each line to understand how tables, constraints, and seed scripts worked, then tested seeding idempotency and database load consistency directly.
- **Evaluating LLM Alternatives & Model Suitability**: When the Gemini API was no longer free for my workflow, I researched alternatives and evaluated model tradeoffs and suitability for structured JSON expense policy review rather than accepting a default blindly.
- **Manual End-to-End & Persistence Verification**: I manually exercised employee submission, data isolation, manager queue review/decisions, cross-role visibility, and database persistence across requests alongside automated Vitest unit tests.