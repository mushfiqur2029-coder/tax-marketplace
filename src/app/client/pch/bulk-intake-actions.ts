"use server";

// Phase B server surface: the auto_upload intake path.
//
//   uploadBulkIntakeDocumentAction(caseId, formData)
//     Validates (PDF/JPG/PNG/WebP, 25 MB cap, <= 25 uploads per case),
//     uploads to case-documents storage, inserts a pch_intake_uploads
//     row, kicks off the extraction job via Next's after() so the
//     upload response doesn't block on Claude.
//
//   listBulkIntakeUploadsAction(caseId)
//     Reads the uploads list for a case, newest first, for the panel.
//
//   deleteBulkIntakeUploadAction(caseId, uploadId)
//     Removes the stored file + the pch_intake_uploads row. Does NOT
//     reverse any amount already applied to income/expense rows -
//     same accepted limitation as deleteIntakeAttachmentAction
//     elsewhere in this directory.
//
//   markLineReviewedAction(caseId, table, lineId)
//     Flips client_reviewed=true on an auto-extracted row. Called
//     when the client taps "Looks right" or edits an auto-row by
//     hand (clearing the amber "check this" badge).
//
//   addExtraIncomeLineAction / addExtraExpenseLineAction
//     The "+ Add income/expense row" buttons. Thin wrappers around
//     the same insert shape upsertPchIncomeLineAction /
//     upsertPchExpenseLineAction use, but client-typed (auto_
//     extracted=false, client_reviewed=true) and - for expenses -
//     defaulted to the "Other expense" classification triple so the
//     client never has to pick a tax box.
//
//   deleteIncomeLineAction / deleteExpenseLineAction
//     Row-level delete. Used by both the "remove a wrongly-extracted
//     extra row" and "remove a row I added by mistake" flows.
//
// Every action here routes through requirePchIntakeEditable (shared
// with the rest of client intake-actions) so the submit-lock + status
// guards apply uniformly, and additionally gates on
// pch_cases.intake_method === 'auto_upload' for the actions that
// only make sense in that flow.

import { after } from "next/server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePchIntakeEditable } from "@/app/client/pch/intake-actions";
import { runBulkIntakeExtractionJob } from "@/lib/pch/bulk-intake-trigger";
import {
  EXPENSE_FIXED_SLOTS,
} from "@/lib/pch/intake-slots";

type ActionOk = { ok: true };
type ActionErr = { ok: false; error: string };
type ActionResult = ActionOk | ActionErr;
type ActionResultWith<T> = (ActionOk & T) | ActionErr;

const BUCKET = "case-documents";
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_UPLOADS_PER_CASE = 25;

// Non-null assertion after a module-level guard: TS doesn't propagate
// a startup throw into type narrowing on the exported symbol, so
// EXPENSE_FALLBACK remains Slot | undefined for consumers. The throw
// below ensures the module simply fails to load if the slot is ever
// renamed in intake-slots.ts, which is loud enough on its own.
const EXPENSE_FALLBACK_RAW = EXPENSE_FIXED_SLOTS.find((s) => s.label === "Other expense");
if (!EXPENSE_FALLBACK_RAW) {
  throw new Error("intake-slots.ts: 'Other expense' slot not found; needed as the fallback classification for client-added extra expense rows.");
}
const EXPENSE_FALLBACK = EXPENSE_FALLBACK_RAW;

async function assertAutoUploadMethod(
  admin: ReturnType<typeof createAdminClient>,
  caseId: string,
): Promise<ActionErr | null> {
  const { data } = await admin
    .from("pch_cases")
    .select("intake_method")
    .eq("case_id", caseId)
    .maybeSingle();
  if (data?.intake_method !== "auto_upload") {
    return {
      ok: false,
      error: "Switch to document upload first.",
    };
  }
  return null;
}

export async function uploadBulkIntakeDocumentAction(
  caseId: string,
  formData: FormData,
): Promise<ActionResultWith<{ uploadId: string }>> {
  try {
    const { me, admin } = await requirePchIntakeEditable(caseId);
    const methodErr = await assertAutoUploadMethod(admin, caseId);
    if (methodErr) return methodErr;

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "Pick a file first." };
    }
    if (file.size > MAX_FILE_BYTES) {
      return { ok: false, error: "File is over 25 MB." };
    }
    const typeLower = (file.type || "").toLowerCase();
    const nameLower = file.name.toLowerCase();
    const isPdf = typeLower === "application/pdf" || nameLower.endsWith(".pdf");
    const isJpeg = typeLower === "image/jpeg" || /\.jpe?g$/.test(nameLower);
    const isPng = typeLower === "image/png" || /\.png$/.test(nameLower);
    const isWebp = typeLower === "image/webp" || /\.webp$/.test(nameLower);
    const isCsv = typeLower === "text/csv" || /\.csv$/.test(nameLower);
    // .xls (old binary format) is accepted too; the xlsx package reads
    // both, same as export-xlsx.ts's reader does not need to care.
    const isExcel =
      typeLower === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      || typeLower === "application/vnd.ms-excel"
      || /\.xlsx?$/.test(nameLower);
    if (!isPdf && !isJpeg && !isPng && !isWebp && !isCsv && !isExcel) {
      return { ok: false, error: "Upload a PDF, JPG, PNG, WebP, CSV or Excel file." };
    }

    // Per-case cap so a runaway loop can't fill storage or blow the
    // AI bill. Message mirrors the deleteIntakeAttachmentAction
    // limitation pattern used elsewhere.
    const { count } = await admin
      .from("pch_intake_uploads")
      .select("id", { count: "exact", head: true })
      .eq("case_id", caseId);
    if ((count ?? 0) >= MAX_UPLOADS_PER_CASE) {
      return {
        ok: false,
        error: "You've reached the upload limit for this case, message your accountant if you need to add more.",
      };
    }

    const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, "_");
    const storagePath = `${caseId}/intake-auto/${randomUUID()}-${safe}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const up = await admin.storage
      .from(BUCKET)
      .upload(storagePath, bytes, {
        contentType: file.type || "application/octet-stream",
      });
    if (up.error) {
      return { ok: false, error: "Upload failed: " + up.error.message };
    }

    const ins = await admin
      .from("pch_intake_uploads")
      .insert({
        case_id: caseId,
        storage_path: storagePath,
        file_name: file.name,
        status: "pending",
      })
      .select("id")
      .single();
    if (ins.error) return { ok: false, error: ins.error.message };

    const uploadId = ins.data.id as string;

    // Hand the actual extraction + write off to after() so the upload
    // response isn't blocked on the 10-60s Claude call (same deferred
    // pattern schedulePchExtraction / runPchExtractionJob use in
    // extraction-trigger.ts).
    after(async () => {
      await runBulkIntakeExtractionJob(uploadId);
    });

    void me;
    revalidatePath(`/client/cases/${caseId}/pch`);
    return { ok: true, uploadId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Upload failed." };
  }
}

export type BulkIntakeUploadView = {
  id: string;
  file_name: string;
  status: "pending" | "processing" | "done" | "error";
  items_count: number | null;
  error_message: string | null;
  uploaded_at: string;
};

export async function listBulkIntakeUploadsAction(
  caseId: string,
): Promise<ActionResultWith<{ uploads: BulkIntakeUploadView[] }>> {
  try {
    const { admin } = await requirePchIntakeEditable(caseId);
    const { data, error } = await admin
      .from("pch_intake_uploads")
      .select("id, file_name, status, items_count, error_message, uploaded_at")
      .eq("case_id", caseId)
      .order("uploaded_at", { ascending: false });
    if (error) return { ok: false, error: error.message };
    const uploads = (data ?? []).map((r) => ({
      id: r.id as string,
      file_name: r.file_name as string,
      status: r.status as BulkIntakeUploadView["status"],
      items_count: (r.items_count as number | null) ?? null,
      error_message: (r.error_message as string | null) ?? null,
      uploaded_at: r.uploaded_at as string,
    }));
    return { ok: true, uploads };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Read failed." };
  }
}

export async function deleteBulkIntakeUploadAction(
  caseId: string,
  uploadId: string,
): Promise<ActionResult> {
  try {
    const { admin } = await requirePchIntakeEditable(caseId);
    const { data: row } = await admin
      .from("pch_intake_uploads")
      .select("id, storage_path, case_id")
      .eq("id", uploadId)
      .maybeSingle();
    if (!row) return { ok: false, error: "Upload not found." };
    if (row.case_id !== caseId) return { ok: false, error: "Not your upload." };

    const path = row.storage_path as string | null;
    if (path) {
      await admin.storage.from(BUCKET).remove([path]);
    }
    const del = await admin
      .from("pch_intake_uploads")
      .delete()
      .eq("id", uploadId)
      .eq("case_id", caseId);
    if (del.error) return { ok: false, error: del.error.message };
    revalidatePath(`/client/cases/${caseId}/pch`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Remove failed." };
  }
}

type ReviewableTable = "income" | "expense";

export async function markLineReviewedAction(
  caseId: string,
  table: ReviewableTable,
  lineId: string,
): Promise<ActionResult> {
  try {
    const { admin } = await requirePchIntakeEditable(caseId);
    const tableName =
      table === "income" ? "pch_income_lines" : "pch_expense_lines";
    const upd = await admin
      .from(tableName)
      .update({ client_reviewed: true })
      .eq("id", lineId)
      .eq("case_id", caseId);
    if (upd.error) return { ok: false, error: upd.error.message };
    revalidatePath(`/client/cases/${caseId}/pch`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

// Bulk toggle used by the "Not related to my driving work" and
// "Move to my review list" actions on the review screen. personal=true
// routes the row into the collapsed tray; personal=false moves it
// back into the main review list. Does not delete anything, so a
// wrong guess (by the model or the client) is always reversible.
export async function setLinesPersonalAction(
  caseId: string,
  table: ReviewableTable,
  lineIds: string[],
  personal: boolean,
): Promise<ActionResult> {
  try {
    const { admin } = await requirePchIntakeEditable(caseId);
    if (lineIds.length === 0) return { ok: true };
    const tableName =
      table === "income" ? "pch_income_lines" : "pch_expense_lines";
    const upd = await admin
      .from(tableName)
      .update({ likely_personal: personal, client_reviewed: true })
      .eq("case_id", caseId)
      .in("id", lineIds);
    if (upd.error) return { ok: false, error: upd.error.message };
    revalidatePath(`/client/cases/${caseId}/pch`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

export async function addExtraIncomeLineAction(
  caseId: string,
  patch: { label: string; amount_pence: number },
): Promise<ActionResultWith<{ id: string }>> {
  try {
    const { admin } = await requirePchIntakeEditable(caseId);
    const label = (patch.label ?? "").trim().slice(0, 80);
    const pence = Math.max(0, Math.round(patch.amount_pence ?? 0));
    const sortOrder = await nextSortOrder(admin, "pch_income_lines", caseId);
    const ins = await admin
      .from("pch_income_lines")
      .insert({
        case_id: caseId,
        source: label,
        gross_takings_pence: pence,
        platform_fee_pence: 0,
        on_trip_miles: 0,
        dead_miles: 0,
        // Match the accountant-side addAccountantIncomeLineAction:
        // freeform extra rows are "Other", routing through
        // pl.rows.otherTrading in the engine, not pl.rows.fares.
        line_type: "Other",
        sort_order: sortOrder,
        // Client typed this directly: not AI output, no "check this"
        // badge needed.
        auto_extracted: false,
        client_reviewed: true,
      })
      .select("id")
      .single();
    if (ins.error) return { ok: false, error: ins.error.message };
    revalidatePath(`/client/cases/${caseId}/pch`);
    return { ok: true, id: ins.data.id as string };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

export async function addExtraExpenseLineAction(
  caseId: string,
  patch: { label: string; amount_pence: number },
): Promise<ActionResultWith<{ id: string }>> {
  try {
    const { admin } = await requirePchIntakeEditable(caseId);
    const label = (patch.label ?? "").trim().slice(0, 80);
    const pence = Math.max(0, Math.round(patch.amount_pence ?? 0));
    const sortOrder = await nextSortOrder(admin, "pch_expense_lines", caseId);
    const fallback = EXPENSE_FALLBACK;
    const ins = await admin
      .from("pch_expense_lines")
      .insert({
        case_id: caseId,
        label,
        amount_paid_pence: pence,
        // Same classification triple as the "Other expense" fixed
        // slot. Clients never see or pick a tax box; the accountant
        // can re-slot on review if needed.
        category: fallback.category,
        sa103s_box: fallback.sa103s_box,
        car_cost: fallback.car_cost,
        sort_order: sortOrder,
        auto_extracted: false,
        client_reviewed: true,
      })
      .select("id")
      .single();
    if (ins.error) return { ok: false, error: ins.error.message };
    revalidatePath(`/client/cases/${caseId}/pch`);
    return { ok: true, id: ins.data.id as string };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

export async function deleteIncomeLineAction(
  caseId: string,
  lineId: string,
): Promise<ActionResult> {
  try {
    const { admin } = await requirePchIntakeEditable(caseId);
    const del = await admin
      .from("pch_income_lines")
      .delete()
      .eq("id", lineId)
      .eq("case_id", caseId);
    if (del.error) return { ok: false, error: del.error.message };
    revalidatePath(`/client/cases/${caseId}/pch`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Remove failed." };
  }
}

export async function deleteExpenseLineAction(
  caseId: string,
  lineId: string,
): Promise<ActionResult> {
  try {
    const { admin } = await requirePchIntakeEditable(caseId);
    const del = await admin
      .from("pch_expense_lines")
      .delete()
      .eq("id", lineId)
      .eq("case_id", caseId);
    if (del.error) return { ok: false, error: del.error.message };
    revalidatePath(`/client/cases/${caseId}/pch`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Remove failed." };
  }
}

export async function updateExtraIncomeLineAction(
  caseId: string,
  lineId: string,
  patch: { label?: string; amount_pence?: number },
): Promise<ActionResult> {
  try {
    const { admin } = await requirePchIntakeEditable(caseId);
    const row: Record<string, unknown> = {};
    if (patch.label !== undefined) row.source = patch.label.trim().slice(0, 80);
    if (patch.amount_pence !== undefined) {
      row.gross_takings_pence = Math.max(0, Math.round(patch.amount_pence));
    }
    // Any client edit also clears the "check this" flag, since the
    // row's figure now reflects an active decision by the client.
    row.client_reviewed = true;
    const upd = await admin
      .from("pch_income_lines")
      .update(row)
      .eq("id", lineId)
      .eq("case_id", caseId);
    if (upd.error) return { ok: false, error: upd.error.message };
    revalidatePath(`/client/cases/${caseId}/pch`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

export async function updateExtraExpenseLineAction(
  caseId: string,
  lineId: string,
  patch: { label?: string; amount_pence?: number },
): Promise<ActionResult> {
  try {
    const { admin } = await requirePchIntakeEditable(caseId);
    const row: Record<string, unknown> = {};
    if (patch.label !== undefined) row.label = patch.label.trim().slice(0, 80);
    if (patch.amount_pence !== undefined) {
      row.amount_paid_pence = Math.max(0, Math.round(patch.amount_pence));
    }
    row.client_reviewed = true;
    const upd = await admin
      .from("pch_expense_lines")
      .update(row)
      .eq("id", lineId)
      .eq("case_id", caseId);
    if (upd.error) return { ok: false, error: upd.error.message };
    revalidatePath(`/client/cases/${caseId}/pch`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

async function nextSortOrder(
  admin: ReturnType<typeof createAdminClient>,
  table: "pch_income_lines" | "pch_expense_lines",
  caseId: string,
): Promise<number> {
  const { data } = await admin
    .from(table)
    .select("sort_order")
    .eq("case_id", caseId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  return ((data?.sort_order as number | undefined) ?? -1) + 1;
}
