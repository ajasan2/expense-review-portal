// Quick smoke test for queries.ts against Supabase
import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const { sql } = await import("../src/lib/db/client");
  const {
    getEmployeeById,
    listEmployees,
    listExpensesForEmployee,
    listPendingExpensesForApprover,
  } = await import("../src/lib/db/queries");

  const employees = await listEmployees();
  console.log("Total employees:", employees.length);
  console.log("Sample YTD type:", typeof employees[0]?.home_office_spent_ytd_usd);

  const sampleEmp = employees.find((e) => e.full_name === "Sam Patel") ?? employees[0];
  const ownExpenses = await listExpensesForEmployee(sampleEmp.employee_id);
  console.log(`${sampleEmp.full_name} expenses:`, ownExpenses.length);
  if (ownExpenses[0]) {
    console.log(
      "Sample amount_usd:",
      ownExpenses[0].expense.amount_usd,
      typeof ownExpenses[0].expense.amount_usd
    );
  }

  const manager = employees.find((e) => e.role === "manager");
  if (manager) {
    const queue = await listPendingExpensesForApprover(manager);
    console.log(`${manager.full_name} pending queue:`, queue.length);
  }

  const fetched = await getEmployeeById(sampleEmp.employee_id);
  console.log("getEmployeeById match:", fetched?.email === sampleEmp.email);

  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  const { sql } = await import("../src/lib/db/client");
  await sql.end();
  process.exit(1);
});