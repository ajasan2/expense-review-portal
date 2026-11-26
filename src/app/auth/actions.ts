// src/app/auth/actions.ts: Session sign-in, sign-out, and production-gated demo switcher

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clearSession, setSessionEmployeeId } from "@/lib/auth/session";
import { getEmployeeById } from "@/lib/db/queries";

export async function isDemoUserSwitcherEnabled(): Promise<boolean> {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ALLOW_DEMO_USER_SWITCHER === "true"
  );
}

export async function signInAsEmployeeAction(formData: FormData): Promise<void> {
  const employeeId = String(formData.get("employee_id") ?? "").trim();
  if (!employeeId) {
    redirect("/");
  }

  const employee = await getEmployeeById(employeeId);
  if (!employee) {
    redirect("/");
  }

  await setSessionEmployeeId(employee.employee_id);
  revalidatePath("/", "layout");
  redirect("/expenses");
}

export async function switchDemoUserAction(formData: FormData): Promise<void> {
  const enabled = await isDemoUserSwitcherEnabled();
  if (!enabled) {
    throw new Error("Demo user switcher is disabled in production");
  }

  await signInAsEmployeeAction(formData);
}

export async function signOutAction(): Promise<void> {
  await clearSession();
  revalidatePath("/", "layout");
  redirect("/");
}