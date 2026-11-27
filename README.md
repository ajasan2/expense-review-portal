# Halcyon Expense Review Portal

A full-stack expense submission, policy auditing, and role-scoped approval portal built with **Next.js (App Router), TypeScript, PostgreSQL (Supabase), and AI-Driven Policy Enforcement (with Deterministic Guardrails)**.

The application implements the Halcyon Expense & Reimbursement Policy v3.2 to evaluate expense claims, identify policy violations, and support role-based approval workflows.

## Table of Contents

1. [Project Overview](#project-overview)
2. [Quick Start](#quick-start)
3. [Architecture & Key Decisions](#architecture--key-decisions)
4. [Technology Choices & Rationale](#technology-choices--rationale)
5. [Project Structure](#project-structure)
6. [Setup & Run Instructions](#setup--run-instructions)
7. [Test Accounts & Role Switching](#test-accounts--role-switching)
8. [Deployment Details (Google Cloud Run)](#deployment-details-google-cloud-run)
9. [Assumptions & Known Limitations](#assumptions--known-limitations)

## Project Overview

The Halcyon Expense Review Portal streamlines enterprise expense management through a combination of deterministic business rules and AI-assisted policy evaluation.

The application supports two primary user journeys:

- **Employee Portal:** Submit expenses, view personal expense history, inspect policy findings, and review approval or rejection decisions.
- **Approver Portal:** Review pending expenses, evaluate policy compliance, and approve or reject eligible claims with optional comments.

### Key Features

- **Expense Management:** Create, submit, and track expense claims.
- **Policy Enforcement:** Automatically evaluate expenses against Halcyon Expense & Reimbursement Policy v3.2.
- **AI-Powered Reviews:** Generate structured policy findings and reimbursement recommendations using the Groq API.
- **Deterministic Fallback:** Maintain policy review functionality when the external AI provider is unavailable.
- **Role-Based Access Control:** Support employee, manager, director, and executive roles.
- **Approval Workflows:** Review, approve, or reject expenses with decision comments.
- **Database Persistence:** Store employees, expenses, and policy reviews in PostgreSQL.
- **Access Restrictions:** Prevent employees from viewing other employees' expenses and prevent approvers from reviewing their own claims.
- **Automated Testing:** Validate policy rules and authorization boundaries using Vitest.
- **Cloud Deployment:** Support containerized deployment using Google Cloud Run.

## Quick Start

Follow these steps to run the project locally.

### 1. Prerequisites

Make sure you have the following installed or available:

- **Node.js:** Version 20 or later.
- **npm:** Node.js package manager.
- **PostgreSQL / Supabase:** A configured PostgreSQL database instance.
- **Groq API Key:** Optional for deterministic fallback testing; required for live AI policy reviews.

### 2. Clone the Repository

```bash
git clone <repository-url>
cd halcyon-expense-portal
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment Variables

Create a `.env.local` file in the project root:

```env
DATABASE_URL=postgresql://user:password@host:5432/postgres
AUTH_SECRET=your_random_session_secret
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL_NAME=your_groq_model_id
ALLOW_DEMO_USER_SWITCHER=true
```

### 5. Initialize the Database

Execute the SQL migration against your PostgreSQL database:

```text
db/migrations/001_init.sql
```

Seed the database and verify the records:

```bash
npx tsx db/seed.ts
npx tsx db/verify-queries.ts
```

### 6. Run Tests

```bash
npm test
```

### 7. Start the Development Server

```bash
npm run dev
```

Open the application:

```text
http://localhost:3000
```

**Note:** A Groq API key is required for live AI policy reviews. Without it, the application uses its deterministic fallback review behavior.

---

## 1. Architecture & Key Decisions

### 1.1 Hybrid Deterministic + AI Policy Engine

The application uses a hybrid policy evaluation architecture that combines deterministic business rules with AI-assisted review. Deterministic policy evaluation runs first and enforces exact reimbursement constraints, including:

- **Submission Deadlines:**
  - Within 30 days: Standard submission window.
  - 31–60 days: Requires director escalation.
  - More than 60 days: Non-reimbursable.
- **Receipt Requirements:** Receipts are required for expenses of `$25.00` or more.
- **Lodging Limits:** Enforces city-tier lodging reimbursement caps.
- **Meal and Entertainment Expenses:** Validates attendee limits.
- **Mileage Reimbursement:** Applies the `$0.70/mile` reimbursement rate.
- **Home Office Allowance:** Enforces the annual `$500 YTD` allowance.
- **Unconditional Exclusions:** Identifies expenses that are never reimbursable under the policy.

After deterministic evaluation, the LLM reviewer receives the expense context and deterministic policy findings and returns structured JSON containing:  `verdict`, `findings`, `reimbursable_amount_usd`, `summary`

**Failure Handling:**

If the LLM provider is unavailable, unconfigured, or returns invalid output, the application:

- Surfaces explicit failure context.
- Records a deterministic fallback verdict.
- Preserves the expense review workflow instead of failing silently.

### 1.2 Server-Side Data Authority

Critical business data is controlled by the server rather than trusted from client-submitted values.

- `submitted_date` is automatically generated by the server at submission time.
- Approval decisions persist the following fields in PostgreSQL:
  - `status`
  - `approver_id`
  - `decided_date`
  - `decision_comment`
- After a decision, affected routes are revalidated:
  - `/expenses`
  - `/manager`
  - `/expenses/[id]`

### 1.3 Defense-in-Depth Access Control

The application enforces role-based access control at multiple layers.

**Employee Permissions:**

- Employees can only view their own expenses.
- Employees cannot trigger policy reviews.
- Employees cannot approve or reject expenses.

**Approver Permissions:**

- Managers, directors, and executives can review eligible expenses submitted by other employees.
- Approvers cannot approve or reject their own expenses.
- Approvers cannot trigger or re-run policy reviews on their own expenses.

In addition to UI and Server Action/API route guards, database query helpers apply SQL-level filtering to restrict returned records.

### 1.4 System Architecture Diagram

The architecture prioritizes policy consistency, access control, traceability, and reliable expense review workflows while providing a foundation for future production integrations such as corporate SSO, receipt storage, and sequential approval routing.

 `docs/architecture.png`

---

## 2. Technology Choices & Rationale

| Layer | Technology | Rationale |
|---|---|---|
| Framework & Language | Next.js (App Router) + TypeScript | Unifies server-rendered pages, Server Actions, and REST API endpoints (`/api/expenses/*`) while providing end-to-end type safety across the UI, policy rules, and database queries. |
| Database | PostgreSQL (Supabase) | Provides relational integrity across `employees`, `expenses`, and `expense_reviews`, JSONB storage for structured findings, and support for idempotent database seeding. |
| LLM Provider | Groq API (Structured JSON) | Selected after evaluating API availability, rate limits, latency, and cost tradeoffs compared to Gemini's free-tier constraints for structured JSON policy evaluations. |
| Validation | Zod | Validates Server Action and REST API payloads on the server before database writes or LLM calls. |
| Testing | Vitest | Provides fast TypeScript execution, clean mocking, and ergonomic unit tests covering policy edge cases and permission boundaries. |
| Deployment | Google Cloud Run | Supports a containerized, stateless Next.js runtime with serverless scaling on GCP without requiring Vercel-specific platform integration. |

---

## 3. Project Structure

```text
├── data/
│   ├── Policy PDF                  # Expense and reimbursement policy
│   ├── employees.csv               # Employee seed data
│   └── expenses.csv                # Expense seed data
│
├── db/
│   ├── migrations/
│   │   └── 001_init.sql            # PostgreSQL schema and indexes
│   ├── seed.ts                     # Idempotent database seeder
│   └── verify-queries.ts           # Database query verification
│
├── docs/
│   └── architecture.png            # Architecture diagram
│
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── expenses/           # REST endpoints
│   │   ├── auth/
│   │   │   └── actions.ts          # Session sign-in, sign-out, demo switcher
│   │   ├── expenses/               # Employee portal, detail pages, server actions
│   │   ├── manager/                # Approver review queue
│   │   └── layout.tsx              # Session bar and user switcher
│   │
│   ├── lib/
│   │   ├── auth/                   # Cookie sessions and role permission guards
│   │   ├── db/                     # PostgreSQL client and scoped query helpers
│   │   ├── llm/                    # AI policy reviewer and fallback handling
│   │   └── policy/                 # Deterministic Halcyon v3.2 rule engine
│   │
│   └── types/
│       └── expense.ts              # Shared domain and review TypeScript types
│
└── tests/                          # Vitest suites (permissions and policy review)
```

---

## 4. Test Accounts & Role Switching

Because the portal models an internal enterprise expense management system, authentication uses HTTP cookie-backed employee sessions paired with a **Demo Switch** bar in the top navigation.

### 4.1 How Role Switching Works

1. Pick a user on the landing page or top nav **Demo Switch** dropdown to set the session cookie.
2. Select another account and click **Switch** to change sessions
3. **Sign Out** to clear it and return to the landing page.

### 4.2 Sample Test Accounts

#### `employee`

| Name | Department |
|---|---|
| Carlos Rivera | Submit expenses, inspect personal expense details and manager decision notes. Blocked from viewing other employees' expenses or running policy reviews. |

#### `manager`

| Name | Department |
|---|---|
| Javier Morales | View and decide on direct/assigned pending expenses, re-run policy reviews on team expenses, and leave approval or rejection comments. Cannot approve or review personal expenses.

#### `director`

| Name | Department |
|---|---|
| Marcus Lee | Broad approver visibility across pending expenses and director-level escalations, such as late submissions between 31 and 60 days and conference registration expenses exceeding $500. |

---

## 5. Deployment Details (Google Cloud Run)

To be added.

---

## 6. Assumptions & Known Limitations

### 6.1 Assumptions

#### Authentication & Demo Switcher

The specification did not mandate an external OAuth/SSO provider or a password-based authentication table.

A signed, cookie-backed employee session picker was therefore implemented to allow reviewers to switch between employee, manager, and director personas during testing.

#### Deterministic Precedence & Explicit AI Fallback

Deterministic policy violations and reimbursement caps serve as the compliance baseline.

When the external LLM call fails, is unavailable, or lacks an API key, the application records a deterministic fallback review with explicit error details rather than blocking expense creation.

### 7.2 Known Limitations

#### Demo Switcher Gating

The `isDemoUserSwitcherEnabled` function in `src/app/auth/actions.ts` enables the demo user switcher in non-production environments or when:

```env
ALLOW_DEMO_USER_SWITCHER=true
```

For a real production deployment, demo user switching should be disabled and replaced with corporate SSO/OAuth2 authentication, such as Google Workspace or another OIDC provider.

#### Receipt Storage

Receipt attachment is currently modeled as a boolean flag
`receipt_attached`.
The application does not currently implement binary file or object storage for receipt images and documents.