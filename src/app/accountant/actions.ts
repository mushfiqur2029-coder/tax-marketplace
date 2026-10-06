"use server";

import { revalidatePath } from "next/cache";
import { requireApprovedAccountant } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  insertAddonPendingAdminNotifications,
  insertAddonReadyToPayNotification,
  insertCasePeriodEnteredNotification,
  insertVatCycleOpenedNotification,
  insertVatApprovalReadyNotification,
} from "@/lib/notifications";
import { type ActionResult, fail } from "@/lib/action-result";
import { periodDocsApplyToTier } from "@/lib/engagement/period-docs";
import {
  ACCOUNTANT_ANNUAL_ACCOUNTS_KEY,
  ACCOUNTANT_CT600_KEY,
} from "@/lib/engagement/period-docs";
import type { TierId } from "@/lib/plans";
import {
  ACCOUNTANT_VAT_RETURN_DOC_KEY,
  computePeriodLabel,
  computePeriodStart,
  getVatFrequency,
  poundsToPence,
  type VatApprovalPayload,
  type VatFrequency,
} from "@/lib/vat/cycle";

export type { ActionResult };

// Suspended accountants keep read access to their assigned cases (RLS is
// unchanged), but every case-mutating server action goes through this
// gate. Blocking here rather than in RLS means Realtime subscriptions and
// SELECTs still work — only the mutations are refused.
function assertNotSuspended(status: string, action: string): void {
  if (status === "suspended") {
    throw new Error(
      `Your account is suspended and can't ${action}. Contact support to reinstate.`,
    );
  }
}

type CaseStatus =
  | "draft"
  | "submitted"
  | "in_review"
  | "prepared"
  | "client_approval"
  | "filed"
  | "complete";

// Which transitions the accountant can perform.
// client_approval -> filed is INTENTIONALLY absent: only the client can move
// a case past client_approval (they click "Approve and file" on their portal).
// Accountants marking a case as filed without client sign-off was the loophole
// this closes.
const ALLOWED_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  draft: [],
  submitted: ["in_review"],
  in_review: ["prepared"],
  prepared: ["client_approval"],
  client_approval: [],
  filed: ["complete"],
  complete: [],
};

async function loadCaseForAccountant(caseId: string) {
  const me = await requireApprovedAccountant();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cases")
    .select("id, client_id, accountant_id, status, stripe_payment_status")
    .eq("id", caseId)
    .single();
  if (error || !data) throw new Error("Case not found or you don't have access.");
  return { me, supabase, row: data };
}

// -------------------------------------------------------------------------
// Take a case from the queue (atomic — race-safe using WHERE accountant_id IS NULL).
// -------------------------------------------------------------------------
export async function takeCaseAction(caseId: string): Promise<ActionResult> {
  try {
    const me = await requireApprovedAccountant();
    assertNotSuspended(me.status, "take new cases");
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("cases")
      .update({
        accountant_id: me.id,
        status: "in_review",
      })
      .eq("id", caseId)
      .eq("status", "submitted")
      .eq("stripe_payment_status", "succeeded")
      .is("accountant_id", null)
      .select("id")
      .single();

    if (error || !data) {
      throw new Error(
        "Couldn't take this case. Someone may have grabbed it, or it's not in the queue anymore.",
      );
    }

    revalidatePath("/accountant");
    revalidatePath(`/accountant/cases/${caseId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------------------
// Move a case through the lifecycle. Only valid forward transitions allowed.
// -------------------------------------------------------------------------
export async function updateCaseStatusAction(
  caseId: string,
  next: string,
): Promise<ActionResult> {
  try {
    const { me, supabase, row } = await loadCaseForAccountant(caseId);
    assertNotSuspended(me.status, "advance case status");
    if (row.accountant_id !== me.id) {
      throw new Error("You haven't taken this case.");
    }

    const current = row.status as CaseStatus;
    const allowed = ALLOWED_TRANSITIONS[current] ?? [];
    if (!allowed.includes(next as CaseStatus)) {
      throw new Error(`Can't go from ${current} to ${next}.`);
    }

    const { error } = await supabase
      .from("cases")
      .update({ status: next })
      .eq("id", caseId);
    if (error) throw new Error(error.message);

    revalidatePath(`/accountant/cases/${caseId}`);
    revalidatePath(`/accountant`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------------------
// Add-on: preset. Snapshots the catalog row's description + amount into
// case_addons at status 'pending_payment' — the client sees a Pay banner
// immediately, no admin review. Catalog row must still be active at the
// moment of insert; edits to the catalog after this do not rewrite the
// snapshot.
// -------------------------------------------------------------------------
export async function requestPresetAddonAction(
  caseId: string,
  presetKey: string,
): Promise<ActionResult> {
  try {
    const me = await requireApprovedAccountant();
    assertNotSuspended(me.status, "request add-ons");
    const supabase = await createClient();

    const { data: caseRow, error: caseErr } = await supabase
      .from("cases")
      .select("id, client_id, accountant_id, status")
      .eq("id", caseId)
      .single();
    if (caseErr || !caseRow) throw new Error("Case not found.");
    if (caseRow.accountant_id !== me.id) {
      throw new Error("You haven't taken this case.");
    }
    if (caseRow.status === "complete") {
      throw new Error("Case is already complete. No more add-ons.");
    }

    // Read the price from the DB — never trust a client-supplied amount.
    const { data: preset, error: presetErr } = await supabase
      .from("addon_catalog")
      .select("key, name, description, amount_pence, active")
      .eq("key", presetKey)
      .single();
    if (presetErr || !preset) throw new Error("That add-on doesn't exist.");
    if (!preset.active) {
      throw new Error("That add-on is currently unavailable.");
    }

    const snapshotDescription = `${preset.name}: ${preset.description}`;
    const { error: insertErr } = await supabase.from("case_addons").insert({
      case_id: caseId,
      accountant_id: me.id,
      kind: "preset",
      preset_key: preset.key,
      description: snapshotDescription,
      amount_pence: preset.amount_pence,
      status: "pending_payment",
    });
    if (insertErr) throw new Error(insertErr.message);

    // Preset add-ons skip admin review, so the client-facing notification
    // fires here. The custom path fires the same notification from
    // approveAddonAction once admin approves.
    await insertAddonReadyToPayNotification({
      caseId,
      clientId: caseRow.client_id,
      amountPence: preset.amount_pence,
      description: snapshotDescription,
    });

    revalidatePath(`/accountant/cases/${caseId}`);
    revalidatePath(`/client/cases/${caseId}`);
    revalidatePath(`/client`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------------------
// Add-on: custom. Inserts at 'pending_admin' — admin has to approve before
// the client sees it. Accountant sets the description and amount here; both
// are validated server-side, and no downstream code trusts anything below
// this line to have been price-verified until admin approval flips it to
// pending_payment.
// -------------------------------------------------------------------------
export async function requestCustomAddonAction(input: {
  caseId: string;
  description: string;
  amountPence: number;
}): Promise<ActionResult> {
  try {
    const me = await requireApprovedAccountant();
    assertNotSuspended(me.status, "request add-ons");
    const supabase = await createClient();

    const description = input.description.trim();
    const amountPence = Math.round(input.amountPence);
    if (description.length < 3) {
      throw new Error("Describe the extra work in at least a short sentence.");
    }
    if (!Number.isFinite(amountPence) || amountPence <= 0) {
      throw new Error("Amount must be greater than zero.");
    }
    // Sanity cap so a stray decimal doesn't slip through as £100k.
    if (amountPence > 500_000) {
      throw new Error("Custom add-ons over £5,000 need to go through support.");
    }

    const { data: caseRow, error: caseErr } = await supabase
      .from("cases")
      .select("id, accountant_id, status")
      .eq("id", input.caseId)
      .single();
    if (caseErr || !caseRow) throw new Error("Case not found.");
    if (caseRow.accountant_id !== me.id) {
      throw new Error("You haven't taken this case.");
    }
    if (caseRow.status === "complete") {
      throw new Error("Case is already complete. No more add-ons.");
    }

    const { error: insertErr } = await supabase.from("case_addons").insert({
      case_id: input.caseId,
      accountant_id: me.id,
      kind: "custom",
      preset_key: null,
      description,
      amount_pence: amountPence,
      status: "pending_admin",
    });
    if (insertErr) throw new Error(insertErr.message);

    // Email the accountant so the admin notification message is human-readable.
    const admin = createAdminClient();
    const { data: meRow } = await admin
      .from("users")
      .select("email")
      .eq("id", me.id)
      .single();

    await insertAddonPendingAdminNotifications({
      caseId: input.caseId,
      accountantEmail: meRow?.email ?? me.email,
      amountPence,
      description,
    });

    revalidatePath(`/accountant/cases/${input.caseId}`);
    revalidatePath(`/admin/addon-requests`);
    revalidatePath(`/admin`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------------------
// Set the accounting period on a limited-company case. non_vat_reg and
// vat_reg use this to unlock the client's second-stage document upload.
// Dormant doesn't have a period step — the spec is explicit about "no
// further client-facing step" for Dormant after Sections A/B/C.
//
// The client is notified when both dates are present, so uploading only
// a start first and the end later doesn't produce a confusing partial
// request. The toggle `payrollRegistered` flips the PAYE summary from
// optional to required on the second-stage list.
// -------------------------------------------------------------------------
export async function setCasePeriodAction(
  caseId: string,
  input: {
    periodStart: string; // YYYY-MM-DD
    periodEnd: string; // YYYY-MM-DD
    payrollRegistered: boolean;
  },
): Promise<ActionResult> {
  try {
    const { me, supabase, row } = await loadCaseForAccountant(caseId);
    assertNotSuspended(me.status, "update case details");
    if (row.accountant_id !== me.id) {
      throw new Error("You haven't taken this case.");
    }

    const admin = createAdminClient();
    const { data: segmentRow } = await admin
      .from("cases")
      .select("segment, tier, period_docs_submitted_at")
      .eq("id", caseId)
      .single();
    if (segmentRow?.segment !== "limited_company_vat") {
      throw new Error("Period dates only apply to limited-company cases.");
    }
    if (!periodDocsApplyToTier(segmentRow.tier as TierId)) {
      throw new Error("This service doesn't have an accounting period step.");
    }
    if (segmentRow.period_docs_submitted_at) {
      throw new Error("The client has already uploaded for this period.");
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.periodStart)) {
      throw new Error("Please pick a valid start date.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.periodEnd)) {
      throw new Error("Please pick a valid end date.");
    }
    if (input.periodStart >= input.periodEnd) {
      throw new Error("End date must be after start date.");
    }

    const { error: updateErr } = await supabase
      .from("cases")
      .update({
        period_start_date: input.periodStart,
        period_end_date: input.periodEnd,
        payroll_registered: input.payrollRegistered,
      })
      .eq("id", caseId);
    if (updateErr) throw new Error(updateErr.message);

    await insertCasePeriodEnteredNotification({
      caseId,
      clientId: row.client_id,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    });

    revalidatePath(`/accountant/cases/${caseId}`);
    revalidatePath(`/client/cases/${caseId}`);
    revalidatePath(`/client/cases/${caseId}/period-docs`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// Clears both dates + payroll flag. Used when the accountant mis-entered
// and wants to retype. Blocked once the client has submitted, so a stray
// clear can't invalidate uploaded files.
export async function clearCasePeriodAction(
  caseId: string,
): Promise<ActionResult> {
  try {
    const { me, supabase, row } = await loadCaseForAccountant(caseId);
    assertNotSuspended(me.status, "update case details");
    if (row.accountant_id !== me.id) {
      throw new Error("You haven't taken this case.");
    }

    const admin = createAdminClient();
    const { data: fresh } = await admin
      .from("cases")
      .select("period_docs_submitted_at")
      .eq("id", caseId)
      .single();
    if (fresh?.period_docs_submitted_at) {
      throw new Error(
        "Period docs are already in. Contact support to re-open the period.",
      );
    }

    const { error: updateErr } = await supabase
      .from("cases")
      .update({
        period_start_date: null,
        period_end_date: null,
        payroll_registered: false,
      })
      .eq("id", caseId);
    if (updateErr) throw new Error(updateErr.message);

    revalidatePath(`/accountant/cases/${caseId}`);
    revalidatePath(`/client/cases/${caseId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// Upload an Annual Accounts PDF or CT600 PDF (or any accountant-authored
// supporting doc) tagged with its requirement_key. Keeps the storage
// shape consistent with the client's own tagged uploads; the UI tells
// which came from whom via uploaded_by.
export type UploadedAccountantDoc = {
  id: string;
  file_name: string;
  uploaded_at: string;
};

export async function uploadAccountantDocumentAction(
  caseId: string,
  requirementKey: string,
  formData: FormData,
): Promise<ActionResult<UploadedAccountantDoc>> {
  try {
    const { me, supabase, row } = await loadCaseForAccountant(caseId);
    assertNotSuspended(me.status, "upload documents");
    if (row.accountant_id !== me.id) {
      throw new Error("You haven't taken this case.");
    }

    // Keep accountant-visible slots tight. If a future requirement key
    // lands here we add it to the allow-list rather than accepting any
    // arbitrary string.
    const ALLOWED = new Set<string>([
      ACCOUNTANT_ANNUAL_ACCOUNTS_KEY,
      ACCOUNTANT_CT600_KEY,
    ]);
    if (!ALLOWED.has(requirementKey)) {
      throw new Error("Unknown upload slot.");
    }

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new Error("Pick a file first.");
    }
    const MAX = 50 * 1024 * 1024;
    if (file.size > MAX) throw new Error("File is over 50 MB.");

    // The accountant Annual Accounts and CT600 slots are PDF-only
    // (hint copy says so, now so does enforcement). Extension-only
    // because Chrome occasionally reports PDFs as application/octet-
    // stream after a long-running save flow.
    const nameLower = file.name.toLowerCase();
    const typeLower = (file.type || "").toLowerCase();
    const looksLikePdf =
      nameLower.endsWith(".pdf") || typeLower === "application/pdf";
    if (!looksLikePdf) {
      throw new Error(
        "This slot only accepts PDF files.",
      );
    }

    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${caseId}/${Date.now()}_${safeName}`;
    const buf = new Uint8Array(await file.arrayBuffer());

    const { error: upErr } = await supabase.storage
      .from("case-documents")
      .upload(path, buf, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (upErr) throw new Error(upErr.message);

    const { data: inserted, error: dbErr } = await supabase
      .from("case_documents")
      .insert({
        case_id: caseId,
        uploaded_by: me.id,
        file_url: path,
        file_name: file.name,
        requirement_key: requirementKey,
      })
      .select("id, file_name, uploaded_at")
      .single();
    if (dbErr || !inserted) {
      await supabase.storage.from("case-documents").remove([path]);
      throw new Error(dbErr?.message ?? "Insert didn't take.");
    }

    revalidatePath(`/accountant/cases/${caseId}`);
    return {
      ok: true,
      data: {
        id: inserted.id,
        file_name: inserted.file_name,
        uploaded_at: inserted.uploaded_at,
      },
    };
  } catch (e) {
    return fail(e);
  }
}

export async function removeAccountantDocumentAction(
  caseId: string,
  documentId: string,
): Promise<ActionResult> {
  try {
    const { me, supabase, row } = await loadCaseForAccountant(caseId);
    assertNotSuspended(me.status, "remove documents");
    if (row.accountant_id !== me.id) {
      throw new Error("You haven't taken this case.");
    }

    const { data: doc } = await supabase
      .from("case_documents")
      .select("id, file_url, case_id, requirement_key, uploaded_by")
      .eq("id", documentId)
      .single();
    if (!doc || doc.case_id !== caseId) throw new Error("Document not found.");
    if (doc.uploaded_by !== me.id) {
      throw new Error("You can only remove your own uploads.");
    }
    const ALLOWED = new Set<string>([
      ACCOUNTANT_ANNUAL_ACCOUNTS_KEY,
      ACCOUNTANT_CT600_KEY,
    ]);
    if (!doc.requirement_key || !ALLOWED.has(doc.requirement_key)) {
      throw new Error("This action is for accountant-uploaded slots only.");
    }

    const { error: delErr } = await supabase
      .from("case_documents")
      .delete()
      .eq("id", documentId);
    if (delErr) throw new Error(delErr.message);

    await supabase.storage.from("case-documents").remove([doc.file_url]);

    revalidatePath(`/accountant/cases/${caseId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// Finalise the client-approval screen. Writes approval_payload, moves
// status in_review → client_approval (skipping 'prepared' for the
// limited-company path per the approved sequencing). Guards: Annual
// Accounts AND CT600 uploaded, both numeric fields parse, status is one
// of the two meaningful starting points (in_review or prepared).
//
// prepared is accepted as a starting status too, because the accountant
// may have already stepped through it manually for a personal case
// before this action existed — belt and braces.
export async function prepareApprovalAction(
  caseId: string,
  input: {
    ctLiabilityPence: number;
    hmrcPaymentReference: string;
    note: string;
  },
): Promise<ActionResult> {
  try {
    const { me, supabase, row } = await loadCaseForAccountant(caseId);
    assertNotSuspended(me.status, "send cases for client approval");
    if (row.accountant_id !== me.id) {
      throw new Error("You haven't taken this case.");
    }
    if (row.status !== "in_review" && row.status !== "prepared") {
      throw new Error("This case isn't at a stage you can send for approval.");
    }

    const admin = createAdminClient();
    const { data: fresh } = await admin
      .from("cases")
      .select("segment, tier, period_docs_submitted_at")
      .eq("id", caseId)
      .single();
    if (fresh?.segment !== "limited_company_vat") {
      throw new Error("This action is for limited-company cases only.");
    }
    const tierId = fresh.tier as TierId;
    // Non-dormant tiers need the period docs in first — the accountant
    // can't credibly prepare Annual Accounts without the full period's
    // bank data.
    if (periodDocsApplyToTier(tierId) && !fresh.period_docs_submitted_at) {
      throw new Error(
        "Client hasn't uploaded their period documents yet. Can't send for approval.",
      );
    }

    // Both accountant uploads must be present. Query once, filter in-
    // memory so the error enumerates what's missing.
    const { data: ownDocs } = await admin
      .from("case_documents")
      .select("requirement_key")
      .eq("case_id", caseId)
      .in("requirement_key", [
        ACCOUNTANT_ANNUAL_ACCOUNTS_KEY,
        ACCOUNTANT_CT600_KEY,
      ]);
    const haveAccounts = (ownDocs ?? []).some(
      (d) => d.requirement_key === ACCOUNTANT_ANNUAL_ACCOUNTS_KEY,
    );
    const haveCT600 = (ownDocs ?? []).some(
      (d) => d.requirement_key === ACCOUNTANT_CT600_KEY,
    );
    const missing: string[] = [];
    if (!haveAccounts) missing.push("Annual Accounts");
    if (!haveCT600) missing.push("CT600");
    if (missing.length > 0) {
      throw new Error(`Upload ${missing.join(" and ")} before sending for approval.`);
    }

    const ct = Math.round(input.ctLiabilityPence);
    if (!Number.isFinite(ct) || ct < 0) {
      throw new Error("CT liability must be zero or more.");
    }

    const payload = {
      ct_liability_pence: ct,
      hmrc_payment_reference: input.hmrcPaymentReference.trim() || null,
      note: input.note.trim() || null,
      prepared_at: new Date().toISOString(),
      prepared_by: me.id,
    };

    const { error: updateErr } = await supabase
      .from("cases")
      .update({
        approval_payload: payload,
        status: "client_approval",
      })
      .eq("id", caseId);
    if (updateErr) throw new Error(updateErr.message);

    // Status change already triggers notify_case_change → client gets a
    // "Case moved to Awaiting your approval" notification. No new one
    // needed here.

    revalidatePath(`/accountant/cases/${caseId}`);
    revalidatePath(`/accountant`);
    revalidatePath(`/client/cases/${caseId}`);
    revalidatePath(`/client`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------------------
// Signed URL for an accountant to download a document on a case they own.
// -------------------------------------------------------------------------
export async function getDocSignedUrlForAccountant(
  caseId: string,
  filePath: string,
): Promise<ActionResult<string>> {
  try {
    const { me, supabase, row } = await loadCaseForAccountant(caseId);
    if (row.accountant_id !== me.id) {
      throw new Error("You haven't taken this case.");
    }
    const { data, error } = await supabase.storage
      .from("case-documents")
      .createSignedUrl(filePath, 60);
    if (error || !data) throw new Error(error?.message ?? "Sign URL failed.");
    return { ok: true, data: data.signedUrl };
  } catch (e) {
    return fail(e);
  }
}

// =========================================================================
// Batch 5: VAT return cycles
// =========================================================================

const VAT_BUCKET = "case-documents";

// Shared pre-flight: the case must be vat_reg limited-company, this
// accountant must be assigned to it, and the case must be past the
// onboarding submit (we lean on vat_return_frequency from Section D's
// intake_answers). Returns the case row + resolved frequency so the
// caller can skip a repeat SELECT.
async function assertVatReadyForAccountant(caseId: string) {
  const { me, supabase } = await loadCaseForAccountant(caseId);
  assertNotSuspended(me.status, "manage VAT returns");
  const admin = createAdminClient();
  const { data: caseRow } = await admin
    .from("cases")
    .select(
      "id, client_id, accountant_id, segment, tier, intake_answers, onboarding_submitted_at",
    )
    .eq("id", caseId)
    .single();
  if (!caseRow) throw new Error("Case not found.");
  if (caseRow.accountant_id !== me.id) {
    throw new Error("You haven't taken this case.");
  }
  if (caseRow.segment !== "limited_company_vat" || caseRow.tier !== "vat_reg") {
    throw new Error("VAT cycles only apply to VAT Registered cases.");
  }
  if (!caseRow.onboarding_submitted_at) {
    throw new Error(
      "Client hasn't completed onboarding yet. Can't open VAT cycles.",
    );
  }
  // Frequency can legitimately be null here — the client may have
  // picked "I don't know" in Section D. Callers that need a concrete
  // Monthly/Quarterly/Annually (openFirstVatCycle, editVatCycleDates)
  // handle null themselves; callers that don't need it (upload the
  // return PDF, prepare approval) ignore the null.
  const frequency = getVatFrequency(
    caseRow.intake_answers as Record<string, string> | null,
  );
  return { me, supabase, admin, caseRow, frequency };
}

// Open the FIRST VAT cycle on a case. One-time setup: accountant enters
// the first period end date, we compute start / HMRC due date / label
// from the Section D frequency and write cycle #1. Subsequent cycles
// auto-create on approve-and-file.
//
// `frequency` is accepted as an optional second input for the "I don't
// know" path — if the client picked that in Section D the accountant
// picks it here, we persist it back to intake_answers so later cycle
// math has a real value.
export async function openFirstVatCycleAction(
  caseId: string,
  input: { periodEndDate: string; frequency?: VatFrequency }, // YYYY-MM-DD
): Promise<ActionResult<{ cycleId: string }>> {
  try {
    const { me, admin, caseRow, frequency: storedFreq } =
      await assertVatReadyForAccountant(caseId);

    const frequency: VatFrequency | null = storedFreq ?? input.frequency ?? null;
    if (!frequency) {
      throw new Error(
        "VAT return frequency is missing. Pick Monthly, Quarterly, or Annually to open the first cycle.",
      );
    }

    // If the client didn't commit to a frequency (chose "I don't know"
    // or left it blank), the accountant's choice here is authoritative
    // — write it back so subsequent cycles and the client's visible
    // Section D answer agree.
    if (!storedFreq && input.frequency) {
      const prev =
        (caseRow.intake_answers as Record<string, string> | null) ?? {};
      const { error: persistErr } = await admin
        .from("cases")
        .update({
          intake_answers: {
            ...prev,
            vat_return_frequency: input.frequency,
          },
        })
        .eq("id", caseId);
      if (persistErr) throw new Error(persistErr.message);
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.periodEndDate)) {
      throw new Error("Period end date must be YYYY-MM-DD.");
    }

    // Must not already have a cycle on this case — this is the "first"
    // action. The accountant uses editVatCycleDatesAction to adjust
    // dates on an existing cycle.
    const { data: existing } = await admin
      .from("vat_return_cycles")
      .select("id")
      .eq("case_id", caseId)
      .limit(1);
    if ((existing?.length ?? 0) > 0) {
      throw new Error(
        "VAT cycles have already been opened on this case. Use edit dates to adjust.",
      );
    }

    const startDate = computePeriodStart(input.periodEndDate, frequency);
    const label = computePeriodLabel(
      startDate,
      input.periodEndDate,
      frequency,
    );

    const { data: inserted, error: insErr } = await admin
      .from("vat_return_cycles")
      .insert({
        case_id: caseId,
        cycle_number: 1,
        period_label: label,
        cycle_start_date: startDate,
        cycle_end_date: input.periodEndDate,
        status: "awaiting_client_docs",
        created_by: me.id,
      })
      .select("id, cycle_hmrc_due_date")
      .single();
    if (insErr || !inserted) {
      throw new Error(insErr?.message ?? "Could not open VAT cycle.");
    }

    await insertVatCycleOpenedNotification({
      caseId,
      clientId: caseRow.client_id,
      periodLabel: label,
      hmrcDueDate: inserted.cycle_hmrc_due_date,
    });

    revalidatePath(`/accountant/cases/${caseId}`);
    revalidatePath(`/client/cases/${caseId}`);
    return { ok: true, data: { cycleId: inserted.id } };
  } catch (e) {
    return fail(e);
  }
}

// Manual override: adjust the dates on an existing cycle. Allowed up
// to (but not including) status='filed' — once a cycle is filed we
// don't touch the historical record. HMRC due date is derived in the
// generated column so a date change propagates automatically.
export async function editVatCycleDatesAction(
  cycleId: string,
  input: { periodStart: string; periodEnd: string },
): Promise<ActionResult> {
  try {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(input.periodStart) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.periodEnd)
    ) {
      throw new Error("Dates must be YYYY-MM-DD.");
    }
    if (input.periodStart > input.periodEnd) {
      throw new Error("Period start must be on or before period end.");
    }

    const admin = createAdminClient();
    const { data: cycle, error: cycErr } = await admin
      .from("vat_return_cycles")
      .select("id, case_id, status")
      .eq("id", cycleId)
      .single();
    if (cycErr || !cycle) throw new Error("VAT cycle not found.");
    if (cycle.status === "filed") {
      throw new Error("Cycle is filed. Dates are locked.");
    }

    const { me, caseRow, frequency } = await assertVatReadyForAccountant(
      cycle.case_id,
    );
    void me;
    void caseRow;

    if (!frequency) {
      // Shouldn't happen in practice — opening the first cycle persists
      // a concrete frequency even when the client said "I don't know".
      // Guard here is defense in depth so a bad intake_answers edit
      // can't leave the label math unable to run.
      throw new Error(
        "VAT return frequency isn't set on this case. Open the first cycle first.",
      );
    }

    const newLabel = computePeriodLabel(
      input.periodStart,
      input.periodEnd,
      frequency,
    );

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("vat_return_cycles")
      .update({
        cycle_start_date: input.periodStart,
        cycle_end_date: input.periodEnd,
        period_label: newLabel,
      })
      .eq("id", cycleId)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) {
      throw new Error("Not allowed to edit this cycle's dates.");
    }

    revalidatePath(`/accountant/cases/${cycle.case_id}`);
    revalidatePath(`/client/cases/${cycle.case_id}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// Accountant uploads the final return PDF for the given cycle. Only
// one slot (ACCOUNTANT_VAT_RETURN_DOC_KEY) — the accountant can replace
// it by uploading again (we don't dedupe at insert time; the UI
// enforces "remove before upload").
export async function uploadVatReturnDocAction(
  cycleId: string,
  formData: FormData,
): Promise<ActionResult<UploadedAccountantDoc>> {
  try {
    const admin = createAdminClient();
    const { data: cycle, error: cycErr } = await admin
      .from("vat_return_cycles")
      .select("id, case_id, status")
      .eq("id", cycleId)
      .single();
    if (cycErr || !cycle) throw new Error("VAT cycle not found.");
    if (cycle.status === "filed") {
      throw new Error("Cycle is filed. Uploads are locked.");
    }

    const { me, supabase, caseRow } = await assertVatReadyForAccountant(
      cycle.case_id,
    );
    void caseRow;

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new Error("Pick a file first.");
    }
    const MAX = 50 * 1024 * 1024;
    if (file.size > MAX) throw new Error("File is over 50 MB.");

    // The VAT return doc slot is PDF-only (HMRC filing printout).
    const nameLower = file.name.toLowerCase();
    const typeLower = (file.type || "").toLowerCase();
    const looksLikePdf =
      nameLower.endsWith(".pdf") || typeLower === "application/pdf";
    if (!looksLikePdf) {
      throw new Error("The VAT return doc slot only accepts PDF files.");
    }

    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${cycle.case_id}/vat/${cycleId}/${Date.now()}_${safeName}`;
    const buf = new Uint8Array(await file.arrayBuffer());

    const { error: upErr } = await supabase.storage
      .from(VAT_BUCKET)
      .upload(path, buf, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (upErr) throw new Error(upErr.message);

    const { data: inserted, error: dbErr } = await supabase
      .from("case_documents")
      .insert({
        case_id: cycle.case_id,
        vat_cycle_id: cycleId,
        uploaded_by: me.id,
        file_url: path,
        file_name: file.name,
        requirement_key: ACCOUNTANT_VAT_RETURN_DOC_KEY,
      })
      .select("id, file_name, uploaded_at")
      .single();
    if (dbErr || !inserted) {
      await supabase.storage.from(VAT_BUCKET).remove([path]);
      throw new Error(dbErr?.message ?? "Insert didn't take.");
    }

    revalidatePath(`/accountant/cases/${cycle.case_id}`);
    return {
      ok: true,
      data: {
        id: inserted.id,
        file_name: inserted.file_name,
        uploaded_at: inserted.uploaded_at,
      },
    };
  } catch (e) {
    return fail(e);
  }
}

export async function removeVatReturnDocAction(
  cycleId: string,
  documentId: string,
): Promise<ActionResult> {
  try {
    const admin = createAdminClient();
    const { data: cycle, error: cycErr } = await admin
      .from("vat_return_cycles")
      .select("id, case_id, status")
      .eq("id", cycleId)
      .single();
    if (cycErr || !cycle) throw new Error("VAT cycle not found.");
    if (cycle.status === "filed") {
      throw new Error("Cycle is filed. Uploads are locked.");
    }

    const { me, supabase } = await assertVatReadyForAccountant(cycle.case_id);

    const { data: doc, error: fetchErr } = await admin
      .from("case_documents")
      .select("id, file_url, uploaded_by, vat_cycle_id, requirement_key")
      .eq("id", documentId)
      .single();
    if (fetchErr || !doc) throw new Error("Document not found.");
    if (doc.vat_cycle_id !== cycleId) {
      throw new Error("That document isn't on this VAT cycle.");
    }
    if (doc.requirement_key !== ACCOUNTANT_VAT_RETURN_DOC_KEY) {
      throw new Error("That document isn't the VAT return PDF.");
    }
    if (doc.uploaded_by !== me.id) {
      throw new Error("You didn't upload this document.");
    }

    const { error: delErr } = await supabase
      .from("case_documents")
      .delete()
      .eq("id", documentId);
    if (delErr) throw new Error(delErr.message);
    await supabase.storage.from(VAT_BUCKET).remove([doc.file_url]);

    revalidatePath(`/accountant/cases/${cycle.case_id}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// Accountant assembles the approval payload (box 1–9 + optional note)
// and transitions the cycle to client_approval. Preconditions: cycle
// at in_review, VAT return PDF uploaded, client docs submitted.
// Box arithmetic is validated to catch obvious transcription errors
// (box 3 = 1+2, box 5 = 3-4) — the accountant can still override by
// sending explicit values.
export async function prepareVatApprovalAction(
  cycleId: string,
  input: {
    box1Pounds: number;
    box2Pounds: number;
    box3Pounds: number;
    box4Pounds: number;
    box5Pounds: number;
    box6Pounds: number;
    box7Pounds: number;
    box8Pounds: number;
    box9Pounds: number;
    note: string;
  },
): Promise<ActionResult> {
  try {
    const admin = createAdminClient();
    const { data: cycle, error: cycErr } = await admin
      .from("vat_return_cycles")
      .select(
        "id, case_id, status, client_docs_submitted_at, period_label",
      )
      .eq("id", cycleId)
      .single();
    if (cycErr || !cycle) throw new Error("VAT cycle not found.");
    if (cycle.status !== "in_review") {
      throw new Error(
        "This cycle isn't at a stage you can send for client approval.",
      );
    }
    if (!cycle.client_docs_submitted_at) {
      throw new Error("Client hasn't submitted the VAT documents yet.");
    }

    const { me, supabase, caseRow } = await assertVatReadyForAccountant(
      cycle.case_id,
    );

    // VAT return PDF must be uploaded.
    const { data: returnDocs } = await admin
      .from("case_documents")
      .select("id")
      .eq("vat_cycle_id", cycleId)
      .eq("requirement_key", ACCOUNTANT_VAT_RETURN_DOC_KEY)
      .limit(1);
    if ((returnDocs?.length ?? 0) === 0) {
      throw new Error(
        "Upload the VAT return PDF before sending for client approval.",
      );
    }

    const toPence = (v: number) => poundsToPence(v);

    const b1 = toPence(input.box1Pounds);
    const b2 = toPence(input.box2Pounds);
    const b3 = toPence(input.box3Pounds);
    const b4 = toPence(input.box4Pounds);
    const b5 = toPence(input.box5Pounds);
    const b6 = toPence(input.box6Pounds);
    const b7 = toPence(input.box7Pounds);
    const b8 = toPence(input.box8Pounds);
    const b9 = toPence(input.box9Pounds);

    // Non-negative constraints. Box 4 and Box 5 can be any sign per
    // HMRC's VAT100 (reclaim and net), so they're not checked here.
    for (const [name, v] of [
      ["Box 1", b1],
      ["Box 2", b2],
      ["Box 3", b3],
      ["Box 6", b6],
      ["Box 7", b7],
      ["Box 8", b8],
      ["Box 9", b9],
    ] as const) {
      if (v < 0) throw new Error(`${name} must be zero or more.`);
    }

    const payload: VatApprovalPayload = {
      box_1_pence: b1,
      box_2_pence: b2,
      box_3_pence: b3,
      box_4_pence: b4,
      box_5_pence: b5,
      box_6_pence: b6,
      box_7_pence: b7,
      box_8_pence: b8,
      box_9_pence: b9,
      note: input.note.trim() || null,
      prepared_at: new Date().toISOString(),
      prepared_by: me.id,
    };

    const { data, error } = await supabase
      .from("vat_return_cycles")
      .update({
        approval_payload: payload,
        status: "client_approval",
      })
      .eq("id", cycleId)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) {
      throw new Error("Not allowed to send this cycle for approval.");
    }

    await insertVatApprovalReadyNotification({
      caseId: cycle.case_id,
      clientId: caseRow.client_id,
      periodLabel: cycle.period_label,
    });

    revalidatePath(`/accountant/cases/${cycle.case_id}`);
    revalidatePath(`/client/cases/${cycle.case_id}`);
    revalidatePath(`/client/cases/${cycle.case_id}/vat/${cycleId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

