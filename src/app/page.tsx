// Root route redirect wrapped in Suspense for Next.js 16 Cache Components

import { Suspense } from "react";
import { redirect } from "next/navigation";

async function RedirectToExpenses(): Promise<never> {
  redirect("/expenses");
}

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <RedirectToExpenses />
    </Suspense>
  );
}