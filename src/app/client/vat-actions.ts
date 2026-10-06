"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { type ActionResult, fail } from "@/lib/action-result";
import {
  insertVatDocsSubmittedNotification,
  insertVatFiledNotification,
  insertVatCycleOpenedNotification,
} from "@/lib/notifications";
import {
  VAT_CYCLE_UPLOAD_FIELDS,
  computeNextCycleDates,
  computePeriodLabel,
  getVatFrequency,
  isVatUploadRequired,
} from "@/lib/vat/cycle";

const BUCKET = "case-documents";
const VALID_UPLOAD_KEYS = new Set(VAT_CYCLE_UPLOAD_FIELDS.map((f) => f.id));

// Shared pre-flight for all client VAT cycle actions. The client must
// own the case, the cycle must belong to that case, and the case must
// still be in a flow state (not filed on this cycle). Returns both the
// cycle and the case row.
async function assertClientOnCycle(cycleId: string) {
  const me = await requireRole("client");
  const admin = createAdminClient();
  const { data: cycle, error: cycErr } = await admin
    .from("vat_return_cycles")
    .select(
      "id, case_id, status, period_label, cycle_start_date, cycle_end_date, cycle_hmrc_due_date, client_docs_submitted_at",
    )
    .eq("id", cycleId)
    .single();
  if (cycErr || !cycle) throw new Error("VAT cycle not found.");

  const { data: caseRow, error: caseErr } = await admin
    .from("cases")
    .select(
      "id, client_id, accountant_id, segment, tier, intake_answers",
    )
    .eq("id", cycle.case_id)
    .single();
  if (caseErr || !caseRow) throw new Error("Case not found.");
  if (caseRow.client_id !== me.id) throw new Error("Not your case.");
  if (caseRow.segment !== "limited_company_vat" || caseRow.tier !== "vat_reg") {
    throw new Error("VAT cycles only apply to VAT Registered cases.");
  }

  const supabase = await createClient();
  return { me, admin, supabase, cycle, caseRow };
}

// -------------------------------------------------------------------------
// Upload a VAT cycle document (client).
// -------------------------------------------------------------------------
export type UploadedVatCycleDoc = {
  id: string;
  file_name: string;
  uploaded_at: string;
};

export async function uploadVatCycleDocAction(
  cycleId: string,
  requirementKey: string,
  formData: FormData,
): Promise<ActionResult<UploadedVatCycleDoc>> {
  try {
    const { me, supabase, cycle } = await assertClientOnCycle(cycleId);
    if (cycle.status !== "awaiting_client_docs") {
      throw new Error("This VAT period is no longer open for client uploads.");
    }
    if (!VALID_UPLOAD_KEYS.has(requirementKey)) {
      throw new Error("That upload slot isn't part of the VAT cycle.");
    }

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new Error("Pick a file first.");
    }
    const MAX = 50 * 1024 * 1024;
    if (file.size > MAX) throw new Error("File is over 50 MB.");

    // Bank statement slot is PDF-only per spec. Other slots accept any
    // common format — we don't police content types further.
    if (requirementKey === "vat_bank_statement_pdf") {
      const name = file.name.toLowerCase();
      const type = (file.type || "").toLowerCase();
      const looksLikePdf = name.endsWith(".pdf") || type === "application/pdf";
      if (!looksLikePdf) {
        throw new Error(
          "Bank statement must be a PDF. Export from your bank's website if needed.",
        );
      }
    }

    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${cycle.case_id}/vat/${cycleId}/${Date.now()}_${safeName}`;
    const buf = new Uint8Array(await file.arrayBuffer());

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
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
        requirement_key: requirementKey,
      })
      .select("id, file_name, uploaded_at")
      .single();
    if (dbErr || !inserted) {
      await supabase.storage.from(BUCKET).remove([path]);
      throw new Error(dbErr?.message ?? "Insert didn't take.");
    }

    revalidatePath(`/client/cases/${cycle.case_id}/vat/${cycleId}`);
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

export async function removeVatCycleDocAction(
  cycleId: string,
  documentId: string,
): Promise<ActionResult> {
  try {
    const { supabase, admin, cycle } = await assertClientOnCycle(cycleId);
    if (cycle.status !== "awaiting_client_docs") {
      throw new Error("This VAT period is no longer open for client edits.");
    }

    const { data: doc, error: fetchErr } = await admin
      .from("case_documents")
      .select("id, file_url, vat_cycle_id, requirement_key")
      .eq("id", documentId)
      .single();
    if (fetchErr || !doc) throw new Error("Document not found.");
    if (doc.vat_cycle_id !== cycleId) {
      throw new Error("That document isn't on this VAT cycle.");
    }
    if (!VALID_UPLOAD_KEYS.has(doc.requirement_key ?? "")) {
      throw new Error("That isn't a client-uploaded VAT document.");
    }

    const { error: delErr } = await supabase
      .from("case_documents")
      .delete()
      .eq("id", documentId);
    if (delErr) throw new Error(delErr.message);
    await supabase.storage.from(BUCKET).remove([doc.file_url]);

    revalidatePath(`/client/cases/${cycle.case_id}/vat/${cycleId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// Stamp client_docs_submitted_at + flip the cycle to in_review. Guards
// against missing required slots (bank statement + sales invoices).
export async function submitVatCycleDocsAction(
  cycleId: string,
): Promise<ActionResult> {
  try {
    const { admin, supabase, cycle, caseRow, me } =
      await assertClientOnCycle(cycleId);
    if (cycle.status !== "awaiting_client_docs") {
      throw new Error("This VAT period isn't open for submission.");
    }

    const { data: docs } = await admin
      .from("case_documents")
      .select("requirement_key")
      .eq("vat_cycle_id", cycleId);
    const uploaded = new Set(
      (docs ?? [])
        .map((d) => d.requirement_key)
        .filter((k): k is string => !!k),
    );

    const missing = VAT_CYCLE_UPLOAD_FIELDS.filter(
      (f) => isVatUploadRequired(f.id) && !uploaded.has(f.id),
    );
    if (missing.length > 0) {
      throw new Error(
        `Still missing: ${missing.map((f) => f.label).join(", ")}.`,
      );
    }

    const { data: updated, error: updErr } = await supabase
      .from("vat_return_cycles")
      .update({
        client_docs_submitted_at: new Date().toISOString(),
        status: "in_review",
      })
      .eq("id", cycleId)
      .eq("status", "awaiting_client_docs")
      .select("id");
    if (updErr) throw new Error(updErr.message);
    if (!updated || updated.length === 0) {
      throw new Error("Couldn't submit. The cycle may have moved on.");
    }

    if (caseRow.accountant_id) {
      const { data: meRow } = await admin
        .from("users")
        .select("email")
        .eq("id", me.id)
        .single();
      await insertVatDocsSubmittedNotification({
        caseId: cycle.case_id,
        accountantId: caseRow.accountant_id,
        clientEmail: meRow?.email ?? "The client",
        periodLabel: cycle.period_label,
      });
    }

    revalidatePath(`/client/cases/${cycle.case_id}`);
    revalidatePath(`/client/cases/${cycle.case_id}/vat/${cycleId}`);
    revalidatePath(`/accountant/cases/${cycle.case_id}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// Approve and file the current cycle. Terminal for this cycle; the
// server then auto-creates the next cycle using the Section D frequency
// (next.start = this.end + 1 day; next.end = next.start + period - 1 day).
// New cycle inherits status='awaiting_client_docs'.
export async function approveAndFileVatCycleAction(
  cycleId: string,
): Promise<ActionResult> {
  try {
    const { me, admin, supabase, cycle, caseRow } =
      await assertClientOnCycle(cycleId);
    if (cycle.status !== "client_approval") {
      throw new Error("This cycle isn't ready for your approval.");
    }

    const frequency = getVatFrequency(
      caseRow.intake_answers as Record<string, string> | null,
    );
    if (!frequency) {
      throw new Error(
        "VAT return frequency is missing from onboarding. Can't open the next cycle.",
      );
    }

    const nowIso = new Date().toISOString();
    const { data: filed, error: fileErr } = await supabase
      .from("vat_return_cycles")
      .update({
        status: "filed",
        filed_at: nowIso,
      })
      .eq("id", cycleId)
      .eq("status", "client_approval")
      .select("id");
    if (fileErr) throw new Error(fileErr.message);
    if (!filed || filed.length === 0) {
      throw new Error("Approval didn't take. Try again.");
    }

    // Compute + insert the next cycle via the admin client — RLS
    // doesn't give clients insert on vat_return_cycles, but this is a
    // trusted server-side continuation of their approve-and-file.
    const next = computeNextCycleDates(cycle.cycle_end_date, frequency);
    const label = computePeriodLabel(next.startDate, next.endDate, frequency);

    const { data: maxRow } = await admin
      .from("vat_return_cycles")
      .select("cycle_number")
      .eq("case_id", cycle.case_id)
      .order("cycle_number", { ascending: false })
      .limit(1)
      .single();
    const nextNumber = (maxRow?.cycle_number ?? 1) + 1;

    const { data: inserted, error: insErr } = await admin
      .from("vat_return_cycles")
      .insert({
        case_id: cycle.case_id,
        cycle_number: nextNumber,
        period_label: label,
        cycle_start_date: next.startDate,
        cycle_end_date: next.endDate,
        status: "awaiting_client_docs",
        // created_by is set to the client here; this is the only path
        // where a non-accountant creates a cycle, and it's a trusted
        // server-side flow (not a user-initiated open).
        created_by: me.id,
      })
      .select("id, cycle_hmrc_due_date")
      .single();
    if (insErr) {
      // Non-fatal for the current approval — the accountant can
      // manually open the next cycle if auto-create fails. Log and
      // continue so the client's filed action still succeeds.
      console.error("Auto-open next VAT cycle failed:", insErr.message);
    } else if (inserted) {
      await insertVatCycleOpenedNotification({
        caseId: cycle.case_id,
        clientId: me.id,
        periodLabel: label,
        hmrcDueDate: inserted.cycle_hmrc_due_date,
      });
    }

    // Notify the accountant that the just-filed cycle was approved.
    if (caseRow.accountant_id) {
      const { data: meRow } = await admin
        .from("users")
        .select("email")
        .eq("id", me.id)
        .single();
      await insertVatFiledNotification({
        caseId: cycle.case_id,
        accountantId: caseRow.accountant_id,
        clientEmail: meRow?.email ?? "The client",
        periodLabel: cycle.period_label,
      });
    }

    revalidatePath(`/client/cases/${cycle.case_id}`);
    revalidatePath(`/client/cases/${cycle.case_id}/vat/${cycleId}`);
    revalidatePath(`/accountant/cases/${cycle.case_id}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// Signed URL for a VAT cycle document (either the client's upload or
// the accountant's return PDF). Scoped to this cycle so a path probe
// from another case can't signed-url its way out.
export async function getVatCycleDocSignedUrl(
  cycleId: string,
  filePath: string,
): Promise<ActionResult<string>> {
  try {
    const { supabase, admin, cycle } = await assertClientOnCycle(cycleId);

    const { data: doc } = await admin
      .from("case_documents")
      .select("case_id, vat_cycle_id, file_url")
      .eq("file_url", filePath)
      .single();
    if (!doc || doc.vat_cycle_id !== cycleId || doc.case_id !== cycle.case_id) {
      return { ok: false, error: "Document not on this VAT cycle." };
    }

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(filePath, 60);
    if (error || !data) {
      return { ok: false, error: error?.message ?? "Could not sign URL." };
    }
    return { ok: true, data: data.signedUrl };
  } catch (e) {
    return fail(e);
  }
}
