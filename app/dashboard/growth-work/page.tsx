import { Suspense } from "react";
import { requireDashboardTabAccess } from "@/lib/dashboard-access";
import GrowthExecution from "@/components/GrowthExecution";

export const dynamic = "force-dynamic";
export default async function GrowthPage() {
  try {
    await requireDashboardTabAccess("growth-work", "Growth Execution");
  } catch (error) {
    return (
      <div style={{ padding: 32 }} role="alert">
        <h1>Growth Execution</h1>
        <p>
          {error instanceof Error ? error.message : "Akses tidak tersedia."}
        </p>
      </div>
    );
  }
  return (
    <Suspense fallback={<p>Memuat Growth Execution…</p>}>
      <GrowthExecution />
    </Suspense>
  );
}
