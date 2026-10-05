"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { type ActionResult, fail } from "@/lib/action-result";
import { getTier, type TierId } from "@/lib/plans";
import { insertPeriodDocsSubmittedNotification } from "@/lib/notifications";
import {
  periodDocsApplyToTier,
  periodDocFieldsForCase,
  requiredPeriodDocFieldsForCase,
  readNeedsPayeRegistration,
  SECTION_A_PAYE_UPLOAD_ID,
} from "@/lib/engagement/period-docs";
import type { ChecklistField } from "@/lib/engagement/checklist";

const BUCKET = "case-documents";

// Guard: client owns the case, limited-company non-dormant, paid,
// onboarding submitted, period dates set, period docs not yet submitted.
async function assertCaseInPeriodUpload(caseId: string) {
  const me = await requireRole("client");
  const supabase = await createClient();
  const { data: caseRow, error } = await supabase
    .from("cases")
    .select(
      "id, client_id, accountant_id, segment, tier, stripe_payment_status, onboarding_submitted_at, period_start_date, period_end_date, payroll_registered, period_docs_submitted_at, intake_answers",
    )
    .eq("id", caseId)
    .single();
  if (error || !caseRow) throw new Error("Case not found.");
  if (caseRow.client_id !== me.id) throw new Error("Not your case.");
  if (caseRow.segment !== "limited_company_vat") {
    throw new Error("Period documents only apply to limited-company cases.");
  }
  const tier = getTier(caseRow.tier) as unknown as { id: TierId } | null;
  if (!tier || !periodDocsApplyToTier(tier.id)) {
    throw new Error("Your service doesn't have a period-docs step.");
  }
  if (caseRow.stripe_payment_status !== "succeeded") {
    throw new Error("Please complete payment first.");
  }
  if (!caseRow.onboarding_submitted_at) {
    throw new Error("Please submit the onboarding checklist first.");
  }
  if (!caseRow.period_start_date || !caseRow.period_end_date) {
    throw new Error(
      "Your accountant hasn't set the accounting period yet. We'll let you know when they do.",
    );
  }
  if (caseRow.period_docs_submitted_at) {
    throw new Error("You've already submitted your period documents.");
  }

  return {
    me,
    supabase,
    admin: createAdminClient(),
    caseRow,
    tier: tier.id,
  };
}

// Section A PAYE presence check — used to promote the period PAYE
// summary from optional to required, matching the spec's "shows
// automatically if they uploaded a PAYE Certificate earlier".
async function sectionAPayeUploaded(
  caseId: string,
  admin: ReturnType<typeof createAdminClient>,
): Promise<boolean> {
  const { data } = await admin
    .from("case_documents")
    .select("id")
    .eq("case_id", caseId)
    .eq("requirement_key", SECTION_A_PAYE_UPLOAD_ID)
    .limit(1);
  return (data ?? []).length > 0;
}

export async function uploadPeriodDocumentAction(
  caseId: string,
  requirementKey: string,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const { me, supabase, tier, caseRow } = await assertCaseInPeriodUpload(caseId);

    // Visibility respects the Section C PAYE answer — if the client
    // said "No" to PAYE registration, the PAYE summary slot
    // disappears entirely, so an upload posted against that key is
    // rejected with "slot doesn't exist".
    const needsPayeRegistration = readNeedsPayeRegistration(
      (caseRow as unknown as { intake_answers: Record<string, string> | null })
        .intake_answers,
    );
    const visible = periodDocFieldsForCase({
      payrollRegistered: false, // required-flag filter, not visibility
      payeCertificateUploadedInSectionA: false,
      needsPayeRegistration,
    });
    const slot = visible.find(
      (f: ChecklistField) => f.id === requirementKey && f.kind === "upload",
    );
    if (!slot) throw new Error("That upload slot doesn't exist on your service.");
    // Belt and braces: only non-dormant tiers (checked in the guard too)
    // have period docs.
    void tier;

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new Error("Pick a file first.");
    }
    const MAX = 50 * 1024 * 1024;
    if (file.size > MAX) throw new Error("File is over 50 MB.");

    // Server-side type enforcement for the bank-statement slots —
    // mirror of the client-side `accept` so a crafted multipart POST
    // can't dump a PDF into the CSV slot or vice versa. Extension-only
    // check: MIME varies by OS (Excel exports often come through as
    // application/vnd.ms-excel OR application/octet-stream), filename
    // extension is the stable signal.
    const nameLower = file.name.toLowerCase();
    const typeLower = (file.type || "").toLowerCase();
    if (requirementKey === "period_bank_statements_pdf") {
      const looksLikePdf =
        nameLower.endsWith(".pdf") || typeLower === "application/pdf";
      if (!looksLikePdf) {
        throw new Error(
          "The PDF bank statement slot only accepts PDF files. The CSV slot below is for spreadsheet exports.",
        );
      }
    }
    if (requirementKey === "period_bank_statements_csv") {
      const looksLikeSpreadsheet =
        nameLower.endsWith(".csv") ||
        nameLower.endsWith(".xlsx") ||
        nameLower.endsWith(".xls");
      if (!looksLikeSpreadsheet) {
        throw new Error(
          "The CSV bank statement slot only accepts CSV or spreadsheet files (XLSX / XLS). Use the PDF slot above for PDF statements.",
        );
      }
    }

    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${caseId}/${Date.now()}_${safeName}`;
    const buf = new Uint8Array(await file.arrayBuffer());

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, buf, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (upErr) throw new Error(upErr.message);

    const { error: dbErr } = await supabase.from("case_documents").insert({
      case_id: caseId,
      uploaded_by: me.id,
      file_url: path,
      file_name: file.name,
      requirement_key: requirementKey,
    });
    if (dbErr) {
      await supabase.storage.from(BUCKET).remove([path]);
      throw new Error(dbErr.message);
    }

    revalidatePath(`/client/cases/${caseId}/period-docs`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function removePeriodDocumentAction(
  caseId: string,
  documentId: string,
): Promise<ActionResult> {
  try {
    const { supabase } = await assertCaseInPeriodUpload(caseId);

    const { data: doc, error: fetchErr } = await supabase
      .from("case_documents")
      .select("id, file_url, case_id, requirement_key")
      .eq("id", documentId)
      .single();
    if (fetchErr || !doc || doc.case_id !== caseId) {
      throw new Error("Document not found.");
    }
    if (!doc.requirement_key?.startsWith("period_")) {
      throw new Error("That document isn't part of the period upload.");
    }

    const { error: delErr } = await supabase
      .from("case_documents")
      .delete()
      .eq("id", documentId);
    if (delErr) throw new Error(delErr.message);

    await supabase.storage.from(BUCKET).remove([doc.file_url]);

    revalidatePath(`/client/cases/${caseId}/period-docs`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// Server-side re-validation of required period-doc slots: every required
// field (per tier and the payroll flag) must have at least one uploaded
// document with the matching requirement_key. On pass, stamps
// period_docs_submitted_at and notifies the assigned accountant.
export async function submitPeriodDocsAction(
  caseId: string,
): Promise<ActionResult> {
  try {
    const { supabase, admin, caseRow, tier } = await assertCaseInPeriodUpload(
      caseId,
    );

    const payeInSectionA = await sectionAPayeUploaded(caseId, admin);
    const needsPayeRegistration = readNeedsPayeRegistration(
      (caseRow as unknown as { intake_answers: Record<string, string> | null })
        .intake_answers,
    );
    const required = requiredPeriodDocFieldsForCase({
      tier,
      payrollRegistered:
        (caseRow as unknown as { payroll_registered: boolean }).payroll_registered,
      payeCertificateUploadedInSectionA: payeInSectionA,
      needsPayeRegistration,
    });

    const { data: docs } = await admin
      .from("case_documents")
      .select("requirement_key")
      .eq("case_id", caseId);
    const uploadedKeys = new Set(
      (docs ?? [])
        .map((d) => d.requirement_key)
        .filter((k): k is string => !!k),
    );

    const missing = required.filter((f) => !uploadedKeys.has(f.id));
    if (missing.length > 0) {
      throw new Error(
        `Still missing: ${missing.map((f) => f.label).join(", ")}.`,
      );
    }

    const { data: updData, error: updateErr } = await supabase
      .from("cases")
      .update({ period_docs_submitted_at: new Date().toISOString() })
      .eq("id", caseId)
      .select("id");
    if (updateErr) throw new Error(updateErr.message);
    if (!updData || updData.length === 0) {
      throw new Error(
        "Submit didn't take — the database refused the write. Reload the page and try again.",
      );
    }

    if (caseRow.accountant_id) {
      const { data: meRow } = await admin
        .from("users")
        .select("email")
        .eq("id", caseRow.client_id)
        .single();
      await insertPeriodDocsSubmittedNotification({
        caseId,
        accountantId: caseRow.accountant_id,
        clientEmail: meRow?.email ?? "the client",
      });
    }

    revalidatePath(`/client/cases/${caseId}/period-docs`);
    revalidatePath(`/client/cases/${caseId}`);
    revalidatePath(`/accountant/cases/${caseId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
