import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensurePchHeadRow } from "@/app/client/pch/actions";
import { PchClientWorkspace } from "./pch-client-workspace";
import type { TaxEngineOutput } from "@/lib/tax-engine";

// Entry point for the automated PCH flow (phase 2a). One page with
// collapsible sections: Documents, Tab 1 Client, Tab 2 Income,
// Tab 3 Expenses, Tab 4 Vehicle, Draft output, Approval.
//
// Authenticated client only; redirects to the generic case detail if
// this isn't a uber_phv_automated case.

export default async function PchClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await getCurrentUser();
  if (!me || me.role !== "client") redirect(`/login?next=/client/cases/${id}/pch`);

  const admin = createAdminClient();
  const { data: caseRow } = await admin
    .from("cases")
    .select("id, client_id, accountant_id, status, tier")
    .eq("id", id)
    .single();
  if (!caseRow) notFound();
  if (caseRow.client_id !== me.id) notFound();
  if (caseRow.tier !== "uber_phv_automated") {
    // Not a PCH case; punt back to the generic case detail.
    redirect(`/client/cases/${id}`);
  }

  // Make sure the head row exists so every subsequent save finds a row.
  await ensurePchHeadRow(id);

  const [head, income, expenses, vehicle, slots, docStatus, snapshot] =
    await Promise.all([
      admin.from("pch_cases").select("*").eq("case_id", id).single(),
      admin.from("pch_income_lines").select("*").eq("case_id", id).order("sort_order"),
      admin.from("pch_expense_lines").select("*").eq("case_id", id).order("sort_order"),
      admin.from("pch_vehicle").select("*").eq("case_id", id).maybeSingle(),
      admin.from("pch_doc_slots").select("*").order("sort_order"),
      admin.from("pch_doc_status").select("*").eq("case_id", id),
      admin.from("pch_cases").select("engine_snapshot, engine_snapshot_at, client_approval_at, client_approval_name")
        .eq("case_id", id).single(),
    ]);

  const { data: uploadedDocs } = await admin
    .from("case_documents")
    .select("id, file_name, uploaded_at, requirement_key")
    .eq("case_id", id)
    .order("uploaded_at", { ascending: false });

  return (
    <PchClientWorkspace
      caseId={id}
      caseStatus={caseRow.status}
      head={head.data ?? null}
      incomeLines={income.data ?? []}
      expenseLines={expenses.data ?? []}
      vehicle={vehicle.data ?? null}
      docSlots={slots.data ?? []}
      docStatus={docStatus.data ?? []}
      uploadedDocs={uploadedDocs ?? []}
      engineSnapshot={(snapshot.data?.engine_snapshot ?? null) as TaxEngineOutput | null}
      engineSnapshotAt={snapshot.data?.engine_snapshot_at ?? null}
      approvalAt={snapshot.data?.client_approval_at ?? null}
      approvalName={snapshot.data?.client_approval_name ?? null}
    />
  );
}
