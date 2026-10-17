import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TaxEngineOutput } from "@/lib/tax-engine";
import { PchAccountantView } from "./pch-accountant-view";

// Phase 2a accountant surface: 33-check review + read-only engine
// snapshot + "request client filing" button. Full override UI + SA
// boxes side-by-side screen land in phase 2b.

export default async function PchAccountantPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await getCurrentUser();
  if (!me || me.role !== "accountant") {
    redirect(`/login?next=/accountant/cases/${id}/pch`);
  }

  const admin = createAdminClient();
  const { data: caseRow } = await admin
    .from("cases")
    .select("id, client_id, accountant_id, status, tier")
    .eq("id", id).single();
  if (!caseRow) notFound();
  if (caseRow.accountant_id !== me.id) notFound();
  if (caseRow.tier !== "uber_phv_automated") {
    redirect(`/accountant/cases/${id}`);
  }

  const [checksMeta, checkStatus, head, overrideHistory, users] = await Promise.all([
    admin.from("pch_check_items").select("*").order("sort_order"),
    admin.from("pch_check_status").select("*").eq("case_id", id),
    admin.from("pch_cases").select("*").eq("case_id", id).single(),
    admin.from("pch_overrides").select("*").eq("case_id", id)
      .order("overridden_at", { ascending: false }),
    // Resolve the display names for the audit trail author column.
    // Keep this query cheap; we only need id + full_name.
    admin.from("users").select("id, full_name"),
  ]);

  const snapshot = (head.data?.engine_snapshot ?? null) as TaxEngineOutput | null;
  const userById = new Map(
    (users.data ?? []).map((u) => [u.id, u.full_name as string | null]),
  );

  return (
    <PchAccountantView
      caseId={id}
      caseStatus={caseRow.status}
      checksMeta={checksMeta.data ?? []}
      checkStatus={checkStatus.data ?? []}
      snapshot={snapshot}
      snapshotAt={head.data?.engine_snapshot_at ?? null}
      approvalAt={head.data?.client_approval_at ?? null}
      approvalName={head.data?.client_approval_name ?? null}
      overrideHistory={overrideHistory.data ?? []}
      userDisplayNames={Object.fromEntries(userById)}
    />
  );
}
