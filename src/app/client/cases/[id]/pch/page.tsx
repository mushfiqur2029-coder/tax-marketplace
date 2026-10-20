import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensurePchHeadRow } from "@/app/client/pch/actions";
import { PchClientWorkspace } from "./pch-client-workspace";
import type { ExtractionReviewPayload } from "./extraction-review";
import type { PriorYearOption } from "./prior-year-prompt";
import { SLOT_APPLY_MAPS } from "@/lib/pch/extraction-apply";
import {
  computeReturnsOwed,
  hasRatePackFor,
  type TaxEngineOutput,
  type UkTaxYear,
} from "@/lib/tax-engine";
import {
  type CaseMessageView,
} from "@/components/case/case-messages-panel";
import { CaseConversationsPanel } from "@/components/case/case-conversations-panel";
import { loadSupportThreadForCaseAndUser } from "@/lib/support/data";
import { RealtimeRefresh } from "@/components/realtime-refresh";

// Dynamic so a brand new extraction row (populated in a Next after()
// callback after an upload) is visible on the very next page load,
// not stale from an earlier render.
export const dynamic = "force-dynamic";

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

  const [head, income, expenses, vehicle, slots, docStatus, snapshot, bankTxns, pendingAddons] =
    await Promise.all([
      admin.from("pch_cases").select("*").eq("case_id", id).single(),
      admin.from("pch_income_lines").select("*").eq("case_id", id).order("sort_order"),
      admin.from("pch_expense_lines").select("*").eq("case_id", id).order("sort_order"),
      admin.from("pch_vehicle").select("*").eq("case_id", id).maybeSingle(),
      admin.from("pch_doc_slots").select("*").eq("active", true).order("sort_order"),
      admin.from("pch_doc_status").select("*").eq("case_id", id),
      admin.from("pch_cases").select("engine_snapshot, engine_snapshot_at, client_approval_at, client_approval_name")
        .eq("case_id", id).single(),
      // Slice 3: live ledger feed. Ordered newest-first so the ledger
      // view's grouped render shows the most recent transaction at the
      // top of each category when expanded.
      admin.from("pch_bank_transactions")
        .select("id, txn_date, description, amount_pence, category, category_confidence")
        .eq("case_id", id)
        .order("txn_date", { ascending: false, nullsFirst: false }),
      // Phase 6 Slice 5: add-ons the client still owes payment on.
      admin.from("case_addons")
        .select("id, description, amount_pence, status")
        .eq("case_id", id)
        .eq("status", "pending_payment")
        .order("created_at", { ascending: true }),
    ]);

  const { data: uploadedDocs } = await admin
    .from("case_documents")
    .select("id, file_name, uploaded_at, requirement_key, photo_id_side")
    .eq("case_id", id)
    .order("uploaded_at", { ascending: false });

  // Checklist items the card-level skip buttons on sections 5-8 flip
  // to Done. The sections render a "Marked as not applicable" state
  // when the matching item is in this set, so the client sees the
  // skip persist across refresh (previously the UI stayed in empty
  // state because the *_note column wasn't touched by the skip action).
  const { data: skipRows } = await admin
    .from("pch_check_status")
    .select("item_number, note")
    .eq("case_id", id)
    .in("item_number", [5, 11, 19, 27, 31])
    .eq("status", "Done");
  const skippedItems = new Set<number>(
    (skipRows ?? [])
      .filter((r) => typeof r.note === "string" && r.note.includes("not applicable"))
      .map((r) => r.item_number as number),
  );

  // Compute outstanding prior-year returns. We filter the output so we
  // only show years OLDER than this case's own tax year (the current
  // year's deadline is tracked on the case itself, not here) and we
  // omit any year the client has already spawned a child case for.
  const priorYearOptions = await buildPriorYearOptions({
    admin,
    parentCaseId: id,
    currentTaxYear: (head.data?.tax_year as UkTaxYear) ?? "2025/26",
    tradingStartDate: head.data?.cl_start_date ? new Date(head.data.cl_start_date) : null,
    tradingEndDate: head.data?.cl_stop_date ? new Date(head.data.cl_stop_date) : null,
  });

  // Build the per-document extraction review payloads. We attach the
  // slot's apply-map labels + targetable flags here so the client UI
  // can render friendly field names and know which fields will actually
  // write to the intake tables.
  const { data: extractionsRaw } = await admin
    .from("pch_doc_extractions")
    .select("id, slot_code, status, overall_confidence, document_type, fields, field_states, error_message, source, photo_id_side")
    .eq("case_id", id)
    .order("created_at", { ascending: false });
  const extractions: ExtractionReviewPayload[] = (extractionsRaw ?? []).map((e) => {
    const applyMap = SLOT_APPLY_MAPS[e.slot_code];
    const targetable: Record<string, boolean> = {};
    if (applyMap) {
      for (const [key, target] of Object.entries(applyMap.targets)) {
        targetable[key] = target.table !== "none";
      }
    }
    return {
      id: e.id,
      slotCode: e.slot_code,
      status: e.status,
      overallConfidence: e.overall_confidence,
      documentType: e.document_type,
      fields: (e.fields ?? {}) as ExtractionReviewPayload["fields"],
      fieldStates: (e.field_states ?? {}) as ExtractionReviewPayload["fieldStates"],
      errorMessage: e.error_message,
      source: (e.source ?? "document") as ExtractionReviewPayload["source"],
      photoIdSide: (e.photo_id_side ?? null) as "front" | "back" | null,
      labels: applyMap?.label ?? {},
      targetable,
    };
  });

  // Hide the engine snapshot from the client until the accountant has
  // explicitly moved the case to client_approval. Up to that point the
  // client sees intake only (editable while status is submitted,
  // read-only once in_review/prepared); the figures are first shown on
  // the approval screen.
  const showFigures =
    caseRow.status === "client_approval" ||
    caseRow.status === "filed" ||
    caseRow.status === "complete";

  const messages = await loadCaseMessages(admin, id);
  const supportThread = await loadSupportThreadForCaseAndUser(id, me.id);

  // Slice 3: shape pch_bank_transactions rows for the ledger view.
  const bankTransactions = (bankTxns.data ?? []).map((r) => ({
    id: r.id as string,
    txnDate: (r.txn_date as string | null) ?? null,
    description: r.description as string,
    amountPence: Number(r.amount_pence),
    category: (r.category as string | null) ?? null,
    categoryConfidence: ((r.category_confidence as string | null) ?? null) as
      | "high" | "medium" | "low" | "missing" | null,
  }));

  return (
    <>
      <RealtimeRefresh
        channel={`client-pch-${id}-${me.id}`}
        subscriptions={[
          // Status transitions: accountant takes the case (submitted
          // -> in_review), sends for approval (-> client_approval),
          // confirms filing (-> filed). The client workspace swaps
          // sections based on status, so this is the headline source.
          { table: "cases", filter: `id=eq.${id}` },
          // Head updates: accountant edits head fields, bookkeeping
          // confirm, final_pack_sent_at (lets the client see the pack
          // as soon as it's dispatched).
          { table: "pch_cases", filter: `case_id=eq.${id}` },
          // 33-check status: when an interview answer commits via the
          // AI chat, the row flips to Done; show that instantly.
          { table: "pch_check_status", filter: `case_id=eq.${id}` },
          // Extraction progress: an uploaded doc takes 10 to 60s to
          // process, and the client needs to see the review card land.
          { table: "pch_doc_extractions", filter: `case_id=eq.${id}` },
          // Bank statement ingest produces N transactions async; show
          // them in the ledger as they land.
          { table: "pch_bank_transactions", filter: `case_id=eq.${id}` },
          // Chat.
          { table: "case_messages", filter: `case_id=eq.${id}` },
          // Add-on raised by the accountant lands on the client as a
          // Pay banner.
          { table: "case_addons", filter: `case_id=eq.${id}` },
        ]}
      />
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
      extractions={extractions}
      priorYearOptions={priorYearOptions}
      bankTransactions={bankTransactions}
      skippedItems={Array.from(skippedItems)}
      pendingAddons={(pendingAddons.data ?? []).map((a) => ({
        id: a.id as string,
        description: a.description as string,
        amount_pence: Number(a.amount_pence),
      }))}
      finalPackSentAt={(head.data?.final_pack_sent_at as string | null) ?? null}
      finalPackConfirmedAt={(head.data?.final_pack_confirmed_at as string | null) ?? null}
      finalPackConfirmedName={(head.data?.final_pack_confirmed_name as string | null) ?? null}
      engineSnapshot={
        showFigures
          ? ((snapshot.data?.engine_snapshot ?? null) as TaxEngineOutput | null)
          : null
      }
      engineSnapshotAt={showFigures ? (snapshot.data?.engine_snapshot_at ?? null) : null}
      approvalAt={snapshot.data?.client_approval_at ?? null}
      approvalName={snapshot.data?.client_approval_name ?? null}
      messagesPanel={
        <CaseConversationsPanel
          caseId={id}
          caseMessages={messages}
          supportThread={supportThread}
          viewerRole="client"
          viewerUserId={me.id}
        />
      }
      />
    </>
  );
}

async function loadCaseMessages(
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
  const { data: users } = await admin
    .from("users")
    .select("id, email")
    .in("id", authorIds);
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

// Build the per-year list of prior-year options for the prompt panel.
// Scope: years strictly OLDER than the current case's own tax year
// (the current year is tracked by the case itself). Marks each year as
// supported (we have a rate pack) and alreadySpawned (a child case
// already exists for it).
async function buildPriorYearOptions({ admin, parentCaseId, currentTaxYear, tradingStartDate, tradingEndDate }: {
  admin: ReturnType<typeof createAdminClient>;
  parentCaseId: string;
  currentTaxYear: UkTaxYear;
  tradingStartDate: Date | null;
  tradingEndDate: Date | null;
}): Promise<PriorYearOption[]> {
  if (!tradingStartDate) return [];
  const asOf = new Date();
  const owed = computeReturnsOwed({
    tradingStartDate,
    tradingEndDate: tradingEndDate ?? undefined,
    alreadyFiledYears: [currentTaxYear],
    asOf,
  });
  if (owed.years.length === 0) return [];

  const { data: existingChildren } = await admin
    .from("cases")
    .select("tax_year_label")
    .eq("parent_case_id", parentCaseId);
  const alreadySpawnedSet = new Set(
    (existingChildren ?? []).map((c) => c.tax_year_label).filter(Boolean) as string[],
  );

  // Oldest first (same order as returns-owed), capped at 5 to keep the
  // panel sane for very old clients.
  return owed.years.slice(0, 5).map((y) => ({
    taxYear: y.taxYear,
    filingDeadline: y.filingDeadline.toISOString(),
    overdue: y.filingOverdue,
    supported: hasRatePackFor(y.taxYear),
    alreadySpawned: alreadySpawnedSet.has(y.taxYear),
  }));
}
