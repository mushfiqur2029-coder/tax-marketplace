import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TaxEngineOutput } from "@/lib/tax-engine";
import { PchAccountantView } from "./pch-accountant-view";
import { computePriorYearAnomalies, type Anomaly } from "@/lib/pch/prior-year-anomalies";
import {
  CaseMessagesPanel,
  type CaseMessageView,
} from "@/components/case/case-messages-panel";

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

  const [checksMeta, checkStatus, head, overrideHistory, users, blockedRows, slotMeta, addonRows, incomeLines, expenseLines] = await Promise.all([
    admin.from("pch_check_items").select("*").order("sort_order"),
    admin.from("pch_check_status").select("*").eq("case_id", id),
    admin.from("pch_cases").select("*").eq("case_id", id).single(),
    admin.from("pch_overrides").select("*").eq("case_id", id)
      .order("overridden_at", { ascending: false }),
    // Resolve the display names for the audit trail author column.
    // Keep this query cheap; we only need id + full_name.
    admin.from("users").select("id, full_name"),
    // Slice 5 (Phase 5): slots the client flagged "I don't have this document".
    admin.from("pch_doc_status")
      .select("slot_code, status, note, updated_at")
      .eq("case_id", id)
      .eq("status", "Awaiting accountant")
      .order("updated_at", { ascending: true }),
    admin.from("pch_doc_slots").select("code, section, display_name"),
    // Phase 6 Slice 5: addons on this case (hide 'rejected' noise).
    admin.from("case_addons")
      .select("id, description, amount_pence, status, created_at")
      .eq("case_id", id)
      .in("status", ["pending_admin", "pending_payment", "paid"])
      .order("created_at", { ascending: false }),
    // Phase 6 Slice 6: line-item P&L edit grid feed.
    admin.from("pch_income_lines")
      .select("id, source, gross_takings_pence, platform_fee_pence, on_trip_miles, dead_miles, line_type, ai_proposed_json, edited_by, edited_at")
      .eq("case_id", id)
      .order("sort_order", { ascending: true }),
    admin.from("pch_expense_lines")
      .select("id, label, amount_paid_pence, category, sa103s_box, evidence, ai_proposed_json, edited_by, edited_at")
      .eq("case_id", id)
      .order("sort_order", { ascending: true }),
  ]);

  const snapshot = (head.data?.engine_snapshot ?? null) as TaxEngineOutput | null;
  const snapshotAt = (head.data?.engine_snapshot_at as string | null) ?? null;

  // "Stale snapshot" indicator: any P&L edit after the snapshot time
  // means the figures the accountant sees in the snapshot panel + SA302
  // reconciliation table are out of date. The view uses this count to
  // render a yellow banner with a Refresh button that calls
  // rerunPchEngineSnapshotAction.
  const snapshotTs = snapshotAt ? Date.parse(snapshotAt) : 0;
  const countEditsAfter = (rows: Array<{ edited_at: string | null }>) =>
    rows.filter((r) => r.edited_at && Date.parse(r.edited_at) > snapshotTs).length;
  const editsSinceSnapshot =
    countEditsAfter((incomeLines.data ?? []) as Array<{ edited_at: string | null }>)
    + countEditsAfter((expenseLines.data ?? []) as Array<{ edited_at: string | null }>);

  const userById = new Map(
    (users.data ?? []).map((u) => [u.id, u.full_name as string | null]),
  );

  const { anomalies, priorYearLabel } = await loadPriorYearAnomalies(
    admin, caseRow.client_id, caseRow.id, head.data?.tax_year ?? null, snapshot,
  );

  const messages = await loadMessages(admin, id);

  // Decorate blocked slots with display name + section from pch_doc_slots.
  const slotMetaByCode = new Map(
    (slotMeta.data ?? []).map((s) => [
      s.code as string,
      { displayName: s.display_name as string, section: s.section as string },
    ]),
  );
  const blocked = (blockedRows.data ?? []).map((r) => ({
    slotCode: r.slot_code as string,
    displayName: slotMetaByCode.get(r.slot_code as string)?.displayName ?? (r.slot_code as string),
    section: slotMetaByCode.get(r.slot_code as string)?.section ?? "",
    note: (r.note as string | null) ?? null,
    updatedAt: (r.updated_at as string | null) ?? null,
  }));

  return (
    <PchAccountantView
      caseId={id}
      caseStatus={caseRow.status}
      checksMeta={checksMeta.data ?? []}
      checkStatus={checkStatus.data ?? []}
      snapshot={snapshot}
      snapshotAt={snapshotAt}
      editsSinceSnapshot={editsSinceSnapshot}
      approvalAt={head.data?.client_approval_at ?? null}
      approvalName={head.data?.client_approval_name ?? null}
      overrideHistory={overrideHistory.data ?? []}
      userDisplayNames={Object.fromEntries(userById)}
      sa302Comparison={head.data?.sa302_comparison ?? null}
      priorYearAnomalies={anomalies}
      priorYearLabel={priorYearLabel}
      awaitingAccountantSlots={blocked}
      addons={(addonRows.data ?? []).map((a) => ({
        id: a.id as string,
        description: a.description as string,
        amount_pence: Number(a.amount_pence),
        status: a.status as "pending_admin" | "pending_payment" | "paid" | "rejected",
        created_at: a.created_at as string,
      }))}
      incomeLines={(incomeLines.data ?? []).map((l) => ({
        id: l.id as string,
        source: l.source as string,
        gross_takings_pence: Number(l.gross_takings_pence ?? 0),
        platform_fee_pence: Number(l.platform_fee_pence ?? 0),
        on_trip_miles: Number(l.on_trip_miles ?? 0),
        dead_miles: Number(l.dead_miles ?? 0),
        line_type: (l.line_type ?? "Fares") as "Fares" | "Other" | "VAT",
        ai_proposed_json: (l.ai_proposed_json ?? null) as {
          source?: string;
          gross_takings_pence?: number;
          platform_fee_pence?: number;
        } | null,
        edited_by: (l.edited_by as string | null) ?? null,
        edited_at: (l.edited_at as string | null) ?? null,
      }))}
      expenseLines={(expenseLines.data ?? []).map((l) => ({
        id: l.id as string,
        label: l.label as string,
        amount_paid_pence: Number(l.amount_paid_pence ?? 0),
        category: (l.category as string) ?? "",
        sa103s_box: Number(l.sa103s_box ?? 0),
        evidence: (l.evidence as string | null) ?? null,
        ai_proposed_json: (l.ai_proposed_json ?? null) as {
          label?: string;
          amount_paid_pence?: number;
        } | null,
        edited_by: (l.edited_by as string | null) ?? null,
        edited_at: (l.edited_at as string | null) ?? null,
      }))}
      bookkeepingConfirmedAt={(head.data?.bookkeeping_confirmed_at as string | null) ?? null}
      bookkeepingConfirmedByLabel={
        head.data?.bookkeeping_confirmed_by
          ? userById.get(head.data.bookkeeping_confirmed_by as string) ?? null
          : null
      }
      clientApprovalAt={(head.data?.client_approval_at as string | null) ?? null}
      clientApprovalName={(head.data?.client_approval_name as string | null) ?? null}
      finalPackSentAt={(head.data?.final_pack_sent_at as string | null) ?? null}
      finalPackConfirmedAt={(head.data?.final_pack_confirmed_at as string | null) ?? null}
      finalPackConfirmedName={(head.data?.final_pack_confirmed_name as string | null) ?? null}
      messagesPanel={<CaseMessagesPanel caseId={id} messages={messages} viewerRole="accountant" viewerUserId={me.id} />}
    />
  );
}

async function loadMessages(
  admin: ReturnType<typeof createAdminClient>,
  caseId: string,
): Promise<CaseMessageView[]> {
  const { data: rows } = await admin
    .from("case_messages")
    .select("id, author_id, author_role, body, created_at, attachments")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  const list = (rows ?? []) as { id: string; author_id: string; author_role: "client" | "accountant" | "admin"; body: string; created_at: string; attachments: unknown }[];
  if (list.length === 0) return [];
  const authorIds = Array.from(new Set(list.map((m) => m.author_id)));
  const { data: users } = await admin.from("users").select("id, email").in("id", authorIds);
  const emailById = new Map((users ?? []).map((u) => [u.id, u.email]));
  return list.map((m) => ({
    id: m.id,
    authorRole: m.author_role,
    authorLabel: emailById.get(m.author_id) ?? m.author_id.slice(0, 8),
    body: m.body,
    createdAt: m.created_at,
    attachments: Array.isArray(m.attachments)
      ? (m.attachments as CaseMessageView["attachments"])
      : null,
  }));
}

// Pick the most recent prior tax-year case the same client has had,
// filtered to the same tier so we're not comparing a PCH year against
// something unrelated. Returns the empty case when nothing comparable
// is on file; callers render nothing.
async function loadPriorYearAnomalies(
  admin: ReturnType<typeof createAdminClient>,
  clientId: string,
  currentCaseId: string,
  currentTaxYear: string | null,
  currentSnapshot: TaxEngineOutput | null,
): Promise<{ anomalies: Anomaly[]; priorYearLabel: string }> {
  if (!currentSnapshot || !currentTaxYear) return { anomalies: [], priorYearLabel: "" };

  // Same client, same tier, different case, with a snapshot. Order by
  // tax_year desc so the latest prior year wins.
  const { data: siblings } = await admin
    .from("cases")
    .select("id, tax_year_label")
    .eq("client_id", clientId)
    .eq("tier", "uber_phv_automated")
    .neq("id", currentCaseId);
  if (!siblings?.length) return { anomalies: [], priorYearLabel: "" };

  const priorCandidates = siblings
    .map((s) => ({ caseId: s.id, taxYear: s.tax_year_label ?? "" }))
    .filter((s) => s.taxYear && s.taxYear < currentTaxYear);
  if (priorCandidates.length === 0) return { anomalies: [], priorYearLabel: "" };
  priorCandidates.sort((a, b) => b.taxYear.localeCompare(a.taxYear));
  const prior = priorCandidates[0];

  const [{ data: priorHead }, { data: currVehicle }, { data: priorVehicle }] = await Promise.all([
    admin.from("pch_cases").select("engine_snapshot").eq("case_id", prior.caseId).maybeSingle(),
    admin.from("pch_vehicle").select("odo_start, odo_end, other_business_miles").eq("case_id", currentCaseId).maybeSingle(),
    admin.from("pch_vehicle").select("odo_start, odo_end, other_business_miles").eq("case_id", prior.caseId).maybeSingle(),
  ]);
  const priorSnapshot = (priorHead?.engine_snapshot ?? null) as TaxEngineOutput | null;
  if (!priorSnapshot) return { anomalies: [], priorYearLabel: "" };

  const miles = (v: typeof currVehicle): number =>
    v ? Math.max(0, (v.odo_end ?? 0) - (v.odo_start ?? 0)) + (v.other_business_miles ?? 0) : 0;

  const anomalies = computePriorYearAnomalies(
    currentSnapshot,
    priorSnapshot,
    { current: miles(currVehicle), prior: miles(priorVehicle) },
  );
  return { anomalies, priorYearLabel: prior.taxYear };
}
