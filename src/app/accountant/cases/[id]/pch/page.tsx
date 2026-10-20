import { notFound, redirect } from "next/navigation";
import { getCurrentUser, requireApprovedAccountant } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TaxEngineOutput } from "@/lib/tax-engine";
import { PchAccountantView } from "./pch-accountant-view";
import { computePriorYearAnomalies, type Anomaly } from "@/lib/pch/prior-year-anomalies";
import {
  type CaseMessageView,
} from "@/components/case/case-messages-panel";
import { CaseConversationsPanel } from "@/components/case/case-conversations-panel";
import { loadSupportThreadForCaseAndUser } from "@/lib/support/data";
import { deriveChecklistPrefills, type ChecklistPrefill } from "@/lib/pch/checklist-prefills";
import { takeCaseAction, getDocSignedUrlForAccountant } from "@/app/accountant/actions";
import { TakeCaseForm } from "../take-case-form";
import { PortalPageHeader } from "@/components/portal-page-header";
import { formatDateTime } from "@/lib/format";

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
    .select("id, client_id, accountant_id, status, tier, stripe_payment_status, submitted_at, deadline, is_urgent")
    .eq("id", id).single();
  if (!caseRow) notFound();
  if (caseRow.tier !== "uber_phv_automated") {
    redirect(`/accountant/cases/${id}`);
  }

  // Queue state: paid PCH case not yet taken by any accountant. Render
  // a minimal Take Case view with a short preview of what the client
  // has filled in so far. The atomic UPDATE in takeCaseAction prevents
  // two accountants from winning a race on the same row.
  if (caseRow.accountant_id === null) {
    if (caseRow.status !== "submitted" || caseRow.stripe_payment_status !== "succeeded") {
      notFound();
    }
    const approved = await requireApprovedAccountant();
    const [clientRes, pchHeadRes] = await Promise.all([
      admin.from("users").select("email").eq("id", caseRow.client_id).maybeSingle(),
      admin.from("pch_cases").select("cl_name, tax_year, engine_snapshot_at").eq("case_id", id).maybeSingle(),
    ]);
    const take = async (): Promise<{ ok: true } | { ok: false; error: string }> => {
      "use server";
      return takeCaseAction(id);
    };
    const intakeComplete = !!pchHeadRes.data?.engine_snapshot_at;
    return (
      <>
        <PortalPageHeader
          eyebrow="PCH automated · in the queue"
          title={pchHeadRes.data?.cl_name ?? "New PCH case"}
          description={
            clientRes.data?.email
              ? `Client: ${clientRes.data.email}`
              : "Paid and waiting for an accountant to pick up."
          }
        />
        <div className="card-sl max-w-xl space-y-4 p-6 sm:p-8">
          <dl className="grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[160px_1fr]">
            <dt className="text-slate">Tax year</dt>
            <dd className="font-medium text-ink">{pchHeadRes.data?.tax_year ?? "."}</dd>
            <dt className="text-slate">Submitted</dt>
            <dd className="font-medium text-ink">
              {caseRow.submitted_at ? formatDateTime(caseRow.submitted_at as string) : "."}
            </dd>
            <dt className="text-slate">Intake</dt>
            <dd className={intakeComplete ? "font-medium text-emerald-700" : "font-medium text-amber-700"}>
              {intakeComplete
                ? "Submitted for review (engine snapshot ready)"
                : "Still in progress (client hasn't clicked Submit for review yet)"}
            </dd>
          </dl>
          {!intakeComplete ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              The client paid but hasn&apos;t finished the intake. You can
              still take the case to help them finish via chat; the figures
              you&apos;ll see are from whatever they&apos;ve entered so far.
            </p>
          ) : null}
          {approved.status !== "suspended" ? (
            <TakeCaseForm take={take} />
          ) : (
            <p className="text-sm text-slate">
              Your account is suspended. Taking new cases is locked until an
              admin reinstates you.
            </p>
          )}
        </div>
      </>
    );
  }

  // Case assigned to another accountant. Keep the 404 for simplicity;
  // the queue filter stops cases from leaking to the wrong accountant
  // in the normal path, so this only trips on direct URL access.
  if (caseRow.accountant_id !== me.id) notFound();

  const [checksMeta, checkStatus, head, overrideHistory, users, blockedRows, slotMeta, addonRows, incomeLines, expenseLines, caseDocs] = await Promise.all([
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
    // Documents panel: every file the client has uploaded on this case,
    // regardless of whether its slot is in the mandatory set. Grouped
    // client-side by slot section (Identity / Earnings / Expenses /
    // Other) via the slotMeta join above.
    admin.from("case_documents")
      .select("id, file_name, file_url, uploaded_at, requirement_key")
      .eq("case_id", id)
      .order("uploaded_at", { ascending: false }),
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
  const supportThread = await loadSupportThreadForCaseAndUser(id, me.id);

  // Phase 7 Slice 7.4: pre-fill map for the 33-point checklist. Shape
  // is a Map<item_number, ChecklistPrefill>; 7.4 ships a stub that
  // returns an empty Map (so auto rows render their "AI could not
  // derive" fallback), 7.5 fills in the 20 auto items cluster by
  // cluster. Non-blocking: a derivation failure doesn't crash the
  // page, the UI just falls back to manual Done/N/A on affected rows.
  const prefills = await deriveChecklistPrefills(id, admin, { anomalies });
  const prefillList: ChecklistPrefill[] = Array.from(prefills.values());

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

  // Client identity: the four fields the Photo ID extraction confirmed,
  // plus the HMRC references the client typed, plus contact. Signed-up
  // user email is the authoritative email (cl_email mirrors it on
  // first sync). Phone comes from pch_cases.cl_phone which is populated
  // by syncPchProfileFromUserAction.
  const { data: clientRow } = await admin
    .from("users").select("email").eq("id", caseRow.client_id).maybeSingle();

  // Signed URL action for the Documents panel. 10-min TTL via the
  // getDocSignedUrlForAccountant action which already enforces that
  // the caller is the assigned accountant.
  const signDocUrl = async (path: string) => {
    "use server";
    return getDocSignedUrlForAccountant(id, path);
  };

  const documents = (caseDocs.data ?? []).map((d) => ({
    id: d.id as string,
    file_name: d.file_name as string,
    file_url: d.file_url as string,
    uploaded_at: d.uploaded_at as string,
    requirement_key: (d.requirement_key as string | null) ?? null,
  }));
  const documentSlotMeta = (slotMeta.data ?? []).map((s) => ({
    code: s.code as string,
    section: s.section as string,
    displayName: s.display_name as string,
  }));

  return (
    <PchAccountantView
      caseId={id}
      caseStatus={caseRow.status}
      checksMeta={checksMeta.data ?? []}
      checkStatus={checkStatus.data ?? []}
      checkPrefills={prefillList}
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
      identity={{
        name: (head.data?.cl_name as string | null) ?? null,
        dob: (head.data?.cl_dob as string | null) ?? null,
        address: (head.data?.cl_address as string | null) ?? null,
        postcode: (head.data?.cl_postcode as string | null) ?? null,
        utr: (head.data?.cl_utr as string | null) ?? null,
        nino: (head.data?.cl_nino as string | null) ?? null,
        phone: (head.data?.cl_phone as string | null) ?? null,
        email: (head.data?.cl_email as string | null) ?? clientRow?.email ?? null,
      }}
      documents={documents}
      documentSlotMeta={documentSlotMeta}
      signDocUrl={signDocUrl}
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
      messagesPanel={
        <CaseConversationsPanel
          caseId={id}
          caseMessages={messages}
          supportThread={supportThread}
          viewerRole="accountant"
          viewerUserId={me.id}
        />
      }
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
