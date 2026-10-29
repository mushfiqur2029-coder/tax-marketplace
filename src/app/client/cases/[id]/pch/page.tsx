import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensurePchHeadRow } from "@/app/client/pch/actions";
import { getDocumentSignedUrl } from "@/app/client/actions";
import { PchClientWorkspace } from "./pch-client-workspace";
import type { PriorYearOption } from "./prior-year-prompt";
import {
  computeReturnsOwed,
  hasRatePackFor,
  type TaxEngineOutput,
  type UkTaxYear,
} from "@/lib/tax-engine";
import { getTier } from "@/lib/service-catalog";
import { effectiveFeePence } from "@/lib/case/pricing";
import { ensureAccountancyFeesRow } from "@/lib/pch/accountancy-fees";
import { type CaseMessageView } from "@/components/case/case-messages-panel";
import { CaseConversationsPanel } from "@/components/case/case-conversations-panel";
import { loadSupportThreadForCaseAndUser } from "@/lib/support/data";

// Dynamic so a brand new extraction row (populated in a Next after()
// callback after an upload) is visible on the very next page load,
// not stale from an earlier render.
export const dynamic = "force-dynamic";

// Entry point for the automated PCH flow (phase 2a). One page with
// collapsible sections: identity, income, expenses, vehicle (as a
// subsection of expenses), sections 4-15, final general uploads.
// Phase A ships the status-aware shell; the intake sections land in
// phases B-D of the rebuild.
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
    .select("id, client_id, accountant_id, status, tier, custom_fee_pence, urgent_fee_pence")
    .eq("id", id)
    .single();
  if (!caseRow) notFound();
  if (caseRow.client_id !== me.id) notFound();
  if (caseRow.tier !== "uber_phv_automated") {
    redirect(`/client/cases/${id}`);
  }

  // Make sure the head row exists so every subsequent save finds a row.
  await ensurePchHeadRow(id);

  // Make sure the Accountancy Fees expense row is persisted. Was a
  // display-only prefill until Phase M+2; untouched boxes meant no DB
  // row, which meant hydrateInputsFromDb saw £0 and the tax engine
  // overstated profit by the fee. Lazy backfill here is idempotent -
  // if the row already exists (client typed something, or an earlier
  // page load created it) this is a cheap no-op.
  await ensureAccountancyFeesRow(id, admin);

  const [
    head,
    snapshot,
    pendingAddons,
    licenceDocsRes,
    pch24ExtRes,
    incomeRes,
    expenseRes,
    vehicleRes,
    giftAidRes,
    generalUploadsRes,
    intakeAttachmentsRes,
    bulkIntakeUploadsRes,
  ] = await Promise.all([
      admin.from("pch_cases").select("*").eq("case_id", id).single(),
      admin
        .from("pch_cases")
        .select(
          "engine_snapshot, engine_snapshot_at, client_approval_at, client_approval_name, client_approved_at, client_approved_signature_name",
        )
        .eq("case_id", id)
        .single(),
      admin
        .from("case_addons")
        .select("id, description, amount_pence, status")
        .eq("case_id", id)
        .eq("status", "pending_payment")
        .order("created_at", { ascending: true }),
      // Section 1: licence front + back uploads land under requirement
      // _key='PCH-24'. We only need their file-name + which side.
      admin
        .from("case_documents")
        .select("id, file_name, uploaded_at, photo_id_side")
        .eq("case_id", id)
        .eq("requirement_key", "PCH-24")
        .order("uploaded_at", { ascending: false }),
      // Section 1: PCH-24 extraction rows so the licence card can show
      // "AI is reading your ID" / auto-apply when a done extraction
      // lands. applied_at (migration 0114) gates the client-side
      // re-apply logic so a refreshed page can't clobber a client's
      // edit back to the OCR value.
      admin
        .from("pch_doc_extractions")
        .select("id, status, photo_id_side, applied_at")
        .eq("case_id", id)
        .eq("slot_code", "PCH-24")
        .order("created_at", { ascending: false })
        .limit(5),
      // Section 2: income lines (default rows seeded on first type).
      // Phase B columns (auto_extracted / client_reviewed /
      // extraction_note) are optional on the client-side types, but
      // we always pull them so the row components can show the
      // "Auto-read, not yet checked" badge where applicable.
      admin
        .from("pch_income_lines")
        .select("id, source, gross_takings_pence, auto_extracted, client_reviewed, extraction_note")
        .eq("case_id", id)
        .order("sort_order"),
      // Section 3: expense lines (fixed slots + airport rows).
      admin
        .from("pch_expense_lines")
        .select("id, label, amount_paid_pence, category, sa103s_box, car_cost, auto_extracted, client_reviewed, extraction_note")
        .eq("case_id", id)
        .order("sort_order"),
      // Section 3 vehicle subsection: pch_vehicle row keyed on case_id.
      admin.from("pch_vehicle").select("*").eq("case_id", id).maybeSingle(),
      // Section 10 Gift Aid: repeatable mini-list.
      admin
        .from("pch_gift_aid_entries")
        .select("id, charity_name, donation_date, amount_pence")
        .eq("case_id", id)
        .order("sort_order"),
      // Final section: existing general uploads (requirement_key='intake-general').
      admin
        .from("case_documents")
        .select("id, file_name, uploaded_at")
        .eq("case_id", id)
        .eq("requirement_key", "intake-general")
        .order("uploaded_at", { ascending: false }),
      // Phase K/L: multi-file attachments on the Cash receipt +
      // Others income rows (section 2) and the Cash expense + Other
      // expense rows (section 3). Each row gets its own
      // requirement_key suffixed with the line id
      // (intake-income-attach-<id>, intake-expense-attach-<id>); we
      // fetch both prefixes in one go and the client components
      // match on their own line id. Also pulls the new case-scoped
      // "Less: Private use" attachments (intake-private-use-attach,
      // one key for all files on the case, no line id suffix) in the
      // same round-trip; they're split out below.
      admin
        .from("case_documents")
        .select("id, file_name, requirement_key, uploaded_at")
        .eq("case_id", id)
        .or("requirement_key.like.intake-income-attach-%,requirement_key.like.intake-expense-attach-%,requirement_key.eq.intake-private-use-attach")
        .order("uploaded_at", { ascending: true }),
      // Phase B: bulk-intake uploads list. Newest first so the
      // BulkDocumentUpload panel shows latest at the top. The
      // per-row useLiveRow in that panel keeps each row's status
      // chip in sync - this fetch just seeds the initial render.
      admin
        .from("pch_intake_uploads")
        .select("id, file_name, status, items_count, error_message, uploaded_at")
        .eq("case_id", id)
        .order("uploaded_at", { ascending: false }),
    ]);

  // Accountancy Fees row prefills with what this client is paying us
  // for this return. Look up the live tier (admin may have put it on
  // sale since the case was created) and prefer custom_fee_pence if
  // this is a bespoke-fee case; same precedence effectiveFeePence
  // enforces everywhere else. On an urgent case the client paid us an
  // extra urgent_fee_pence on top of the base plan fee at checkout
  // (deliberately not folded into effectiveFeePence so the checkout
  // and webhook paths can reason about the two amounts separately);
  // the deductible accountancy figure is the TOTAL they paid, so sum
  // them here. Keep in step with ensureAccountancyFeesRow which
  // writes the same sum into pch_expense_lines.
  const tier = await getTier(caseRow.tier);
  const caseFeePence =
    effectiveFeePence(caseRow, tier)
    + ((caseRow.urgent_fee_pence as number | null) ?? 0);

  const priorYearOptions = await buildPriorYearOptions({
    admin,
    parentCaseId: id,
    currentTaxYear: (head.data?.tax_year as UkTaxYear) ?? "2025/26",
    tradingStartDate: head.data?.cl_start_date ? new Date(head.data.cl_start_date) : null,
    tradingEndDate: head.data?.cl_stop_date ? new Date(head.data.cl_stop_date) : null,
  });

  // Hide the engine snapshot from the client until the accountant has
  // explicitly moved the case to client_approval.
  const showFigures =
    caseRow.status === "client_approval"
    || caseRow.status === "filed"
    || caseRow.status === "complete";

  const messages = await loadCaseMessages(admin, id);
  const supportThread = await loadSupportThreadForCaseAndUser(id, me.id);

  // Phase K: group Phase-K attachments by their line id so each
  // multi-file row only sees its own. The case-scoped private-use
  // attachments pile into a flat list rather than a per-line map
  // because that card is a single pch_vehicle column, no line id.
  const intakeAttachmentsByLine = new Map<string, Array<{ docId: string; fileName: string }>>();
  const privateUseAttachments: Array<{ docId: string; fileName: string }> = [];
  for (const d of intakeAttachmentsRes.data ?? []) {
    const key = (d.requirement_key as string | null) ?? "";
    const prefixIncome = "intake-income-attach-";
    const prefixExpense = "intake-expense-attach-";
    if (key === "intake-private-use-attach") {
      privateUseAttachments.push({
        docId: d.id as string,
        fileName: d.file_name as string,
      });
      continue;
    }
    const lineId = key.startsWith(prefixIncome)
      ? key.slice(prefixIncome.length)
      : key.startsWith(prefixExpense)
        ? key.slice(prefixExpense.length)
        : null;
    if (!lineId) continue;
    const list = intakeAttachmentsByLine.get(lineId) ?? [];
    list.push({ docId: d.id as string, fileName: d.file_name as string });
    intakeAttachmentsByLine.set(lineId, list);
  }

  // Server-action closure for signing short-lived download URLs for
  // the four final documents. Mirrors the pattern on the accountant
  // page.tsx; getDocumentSignedUrl runs assertCaseOwner first, so a
  // client can only ever sign a URL for their own case.
  const signDocUrl = async (path: string) => {
    "use server";
    return getDocumentSignedUrl(id, path);
  };

  return (
    <>
      <PchClientWorkspace
        caseId={id}
        caseStatus={caseRow.status}
        head={head.data ?? null}
        priorYearOptions={priorYearOptions}
        pendingAddons={(pendingAddons.data ?? []).map((a) => ({
          id: a.id as string,
          description: a.description as string,
          amount_pence: Number(a.amount_pence),
        }))}
        finalPackSentAt={(head.data?.final_pack_sent_at as string | null) ?? null}
        finalPackConfirmedAt={(head.data?.final_pack_confirmed_at as string | null) ?? null}
        finalPackConfirmedName={(head.data?.final_pack_confirmed_name as string | null) ?? null}
        intakeSubmittedAt={(head.data?.intake_submitted_at as string | null) ?? null}
        intakeMethod={
          (head.data?.intake_method as "manual" | "auto_upload" | null) ?? null
        }
        saForwardingPdfPath={(head.data?.sa_forwarding_pdf_path as string | null) ?? null}
        pchAccountsPdfPath={(head.data?.pch_accounts_pdf_path as string | null) ?? null}
        sa302UploadPath={(head.data?.sa302_upload_path as string | null) ?? null}
        sa100UploadPath={(head.data?.sa100_upload_path as string | null) ?? null}
        signDocUrl={signDocUrl}
        engineSnapshot={
          showFigures
            ? ((snapshot.data?.engine_snapshot ?? null) as TaxEngineOutput | null)
            : null
        }
        engineSnapshotAt={showFigures ? (snapshot.data?.engine_snapshot_at ?? null) : null}
        approvalAt={snapshot.data?.client_approval_at ?? null}
        approvalName={snapshot.data?.client_approval_name ?? null}
        approvedAt={snapshot.data?.client_approved_at ?? null}
        approvedSignatureName={
          snapshot.data?.client_approved_signature_name ?? null
        }
        section1Initial={{
          cl_name: (head.data?.cl_name as string | null) ?? null,
          cl_dob: (head.data?.cl_dob as string | null) ?? null,
          cl_address: (head.data?.cl_address as string | null) ?? null,
          cl_postcode: (head.data?.cl_postcode as string | null) ?? null,
          cl_phone: (head.data?.cl_phone as string | null) ?? null,
          cl_email: (head.data?.cl_email as string | null) ?? null,
          cl_utr: (head.data?.cl_utr as string | null) ?? null,
          cl_nino: (head.data?.cl_nino as string | null) ?? null,
          photo_id_kind:
            (head.data?.photo_id_kind as "passport" | "licence" | null) ?? null,
        }}
        licenceDocs={(licenceDocsRes.data ?? []).map((d) => ({
          id: d.id as string,
          file_name: d.file_name as string,
          uploaded_at: d.uploaded_at as string,
          photo_id_side: (d.photo_id_side ?? null) as "front" | "back" | null,
        }))}
        pch24Extractions={(pch24ExtRes.data ?? []).map((e) => ({
          id: e.id as string,
          status: e.status as string,
          photo_id_side: (e.photo_id_side ?? null) as "front" | "back" | null,
          applied_at: (e.applied_at as string | null) ?? null,
        }))}
        incomeLines={(incomeRes.data ?? []).map((l) => ({
          id: l.id as string,
          source: (l.source as string) ?? "",
          gross_takings_pence: Number(l.gross_takings_pence ?? 0),
          auto_extracted: (l.auto_extracted as boolean | null) ?? false,
          client_reviewed: (l.client_reviewed as boolean | null) ?? false,
          extraction_note: (l.extraction_note as string | null) ?? null,
        }))}
        expenseLines={(expenseRes.data ?? []).map((l) => ({
          id: l.id as string,
          label: l.label as string,
          amount_paid_pence: Number(l.amount_paid_pence ?? 0),
          category: l.category as string,
          sa103s_box: Number(l.sa103s_box),
          car_cost: (l.car_cost ?? "No") as "Yes" | "No" | "Phone",
          auto_extracted: (l.auto_extracted as boolean | null) ?? false,
          client_reviewed: (l.client_reviewed as boolean | null) ?? false,
          extraction_note: (l.extraction_note as string | null) ?? null,
        }))}
        bulkIntakeUploads={(bulkIntakeUploadsRes.data ?? []).map((u) => ({
          id: u.id as string,
          file_name: u.file_name as string,
          status: u.status as "pending" | "processing" | "done" | "error",
          items_count: (u.items_count as number | null) ?? null,
          error_message: (u.error_message as string | null) ?? null,
          uploaded_at: u.uploaded_at as string,
        }))}
        intakeAttachments={Object.fromEntries(intakeAttachmentsByLine)}
        privateUseAttachments={privateUseAttachments}
        vehicleInitial={{
          status: (vehicleRes.data?.status as string | null) ?? null,
          fuel: (vehicleRes.data?.fuel as string | null) ?? null,
          make_model: (vehicleRes.data?.make_model as string | null) ?? null,
          registration: (vehicleRes.data?.registration as string | null) ?? null,
          bought_this_year:
            (vehicleRes.data?.bought_this_year as boolean | null) ?? null,
          purchase_price_pence:
            (vehicleRes.data?.purchase_price_pence as number | null) ?? null,
          new_or_used:
            (vehicleRes.data?.new_or_used as "New" | "Used" | null) ?? null,
          odo_start: (vehicleRes.data?.odo_start as number | null) ?? null,
          odo_end: (vehicleRes.data?.odo_end as number | null) ?? null,
          other_business_miles:
            (vehicleRes.data?.other_business_miles as number | null) ?? null,
          previous_method:
            (vehicleRes.data?.previous_method as string | null) ?? null,
          wdv_brought_forward_pence:
            (vehicleRes.data?.wdv_brought_forward_pence as number | null) ?? null,
          private_use_amount_pence:
            (vehicleRes.data?.private_use_amount_pence as number | null) ?? null,
        }}
        caseFeePence={caseFeePence}
        declarationsInitial={{
          statuses: ((head.data?.cl_declaration_status ?? {}) as Record<
            string,
            "applicable" | "not_applicable" | undefined
          >),
          employment_income_pence:
            (head.data?.employment_income_pence as number | null) ?? null,
          other_employment_evidence:
            (head.data?.other_employment_evidence as string | null) ?? null,
          p11d_pence: (head.data?.p11d_pence as number | null) ?? null,
          benefits_note: (head.data?.benefits_note as string | null) ?? null,
          bank_interest_pence: (head.data?.bank_interest_pence as number | null) ?? null,
          dividend_income_pence: (head.data?.dividend_income_pence as number | null) ?? null,
          capital_gains_pence: (head.data?.capital_gains_pence as number | null) ?? null,
          capital_gains_note: (head.data?.capital_gains_note as string | null) ?? null,
          rental_profit_pence: (head.data?.rental_profit_pence as number | null) ?? null,
          gross_rent_received_pence:
            (head.data?.gross_rent_received_pence as number | null) ?? null,
          personal_pension_net_pence:
            (head.data?.personal_pension_net_pence as number | null) ?? null,
          child_benefit_pence: (head.data?.child_benefit_pence as number | null) ?? null,
          overseas_income_pence: (head.data?.overseas_income_pence as number | null) ?? null,
          overseas_tax_paid_pence:
            (head.data?.overseas_tax_paid_pence as number | null) ?? null,
          student_loan_plan: (head.data?.student_loan_plan as string | null) ?? null,
          anything_else_note: (head.data?.anything_else_note as string | null) ?? null,
          p11d_evidence: (head.data?.p11d_evidence as string | null) ?? null,
          interest_evidence: (head.data?.interest_evidence as string | null) ?? null,
          dividend_evidence: (head.data?.dividend_evidence as string | null) ?? null,
          capital_gains_evidence:
            (head.data?.capital_gains_evidence as string | null) ?? null,
          rental_evidence: (head.data?.rental_evidence as string | null) ?? null,
          pension_evidence: (head.data?.pension_evidence as string | null) ?? null,
          child_benefit_evidence:
            (head.data?.child_benefit_evidence as string | null) ?? null,
          overseas_evidence: (head.data?.overseas_evidence as string | null) ?? null,
          student_loan_evidence:
            (head.data?.student_loan_evidence as string | null) ?? null,
        }}
        giftAidEntries={(giftAidRes.data ?? []).map((e) => ({
          id: e.id as string,
          charity_name: (e.charity_name as string | null) ?? null,
          donation_date: (e.donation_date as string | null) ?? null,
          amount_pence: Number(e.amount_pence ?? 0),
        }))}
        section15Initial={{
          last_year_sa_status:
            (head.data?.last_year_sa_status as "yes" | "no" | "not_applicable" | null) ?? null,
          last_year_sa_paid: (head.data?.last_year_sa_paid as boolean | null) ?? null,
          last_year_sa302_evidence:
            (head.data?.last_year_sa302_evidence as string | null) ?? null,
        }}
        generalUploads={(generalUploadsRes.data ?? []).map((d) => ({
          id: d.id as string,
          file_name: d.file_name as string,
          uploaded_at: d.uploaded_at as string,
        }))}
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
  const list = (rows ?? []) as {
    id: string;
    author_id: string;
    author_role: "client" | "accountant" | "admin";
    body: string;
    created_at: string;
    attachments: unknown;
  }[];
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

async function buildPriorYearOptions({
  admin, parentCaseId, currentTaxYear, tradingStartDate, tradingEndDate,
}: {
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

  return owed.years.slice(0, 5).map((y) => ({
    taxYear: y.taxYear,
    filingDeadline: y.filingDeadline.toISOString(),
    overdue: y.filingOverdue,
    supported: hasRatePackFor(y.taxYear),
    alreadySpawned: alreadySpawnedSet.has(y.taxYear),
  }));
}
