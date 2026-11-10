import "server-only";
import * as XLSX from "xlsx";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  extractBulkIntakeDocument,
  type BulkExtractedItem,
  type BulkIntakeDocument,
} from "./bulk-intake-extract";
import {
  EXPENSE_FIXED_SLOTS,
  type ExpenseSlot,
  getExpenseSlotByLabel,
  getIncomeSlotByLabel,
} from "./intake-slots";

// Background job wired into uploadBulkIntakeDocumentAction. Picks up
// a pch_intake_uploads row, downloads the uploaded file from
// case-documents storage, runs the AI extractor on it, and writes
// the results into pch_income_lines / pch_expense_lines.
//
// Two write paths per returned item:
//
//   matched slot (suggestedSlot resolves to a FIXED_SLOTS entry):
//     this is a top-up to an existing fixed-slot row. The slot's
//     visible card accumulates every top-up amount; the extraction
//     note gets appended so the client can see where each pound
//     came from. auto_extracted + client_reviewed on the fixed row
//     drive the "Auto-read, not yet checked" badge until the client
//     looks at it.
//
//   unmatched (suggestedSlot === null):
//     this is a genuinely new, individually-visible row. Inserted
//     as a fresh pch_income_lines / pch_expense_lines row with the
//     item's label verbatim. For expenses the classification triple
//     is defaulted to the "Other expense" fixed slot's values -
//     these items are uncategorised, not a new tax category.
//
// Everything runs under the admin client (same pattern as every
// server-side write in this directory). On any thrown error the
// upload row flips to status='error' with the message so the
// client UI can show a friendly retry hint; nothing is left stuck
// on 'processing'.

// If someone renames the "Other expense" slot in intake-slots.ts, we
// want a loud failure at startup rather than silent misclassification.
// Two-step const + narrowing assignment because TS doesn't propagate
// a module-level if-throw into type narrowing on the exported symbol.
const EXPENSE_FALLBACK_SLOT_RAW = EXPENSE_FIXED_SLOTS.find((s) => s.label === "Other expense");
if (!EXPENSE_FALLBACK_SLOT_RAW) {
  throw new Error(
    "intake-slots.ts: 'Other expense' slot not found; bulk-intake-trigger needs it as the fallback for uncategorised expense items.",
  );
}
const EXPENSE_FALLBACK_SLOT = EXPENSE_FALLBACK_SLOT_RAW;

// Keep the extraction_note column from growing without bound: a
// single fixed-slot row can accumulate many top-ups over multiple
// uploads, but the review UI only needs the last few hints. 5 lines
// is enough to point the client at specific statement entries
// without the string becoming a wall of text.
const MAX_NOTE_LINES = 5;

export async function runBulkIntakeExtractionJob(uploadId: string): Promise<void> {
  const admin = createAdminClient();

  // Atomic claim: pending -> processing in one UPDATE, scoped to
  // status='pending' in the WHERE clause, instead of a SELECT to read
  // the status followed by a separate UPDATE. The previous two-step
  // version was a real race, not just a theoretical one: the platform
  // can replay/retry the same after() callback, and if two
  // invocations for the same uploadId both ran the SELECT before
  // either ran the UPDATE, both would see status='pending', both
  // would proceed, and both would call applyExtractedItem for every
  // line - and because topUpIncomeSlot/topUpExpenseSlot are designed
  // to ADD a top-up's pence onto the existing total, a duplicate run
  // doesn't fail or collide, it silently double-counts the entire
  // document. Scoping this single UPDATE's WHERE to status='pending'
  // means only the first invocation to reach the database gets a
  // non-empty result back; every other concurrent/retried invocation
  // sees zero rows affected and returns immediately below.
  const claim = await admin
    .from("pch_intake_uploads")
    .update({ status: "processing" })
    .eq("id", uploadId)
    .eq("status", "pending")
    .select("id, case_id, storage_path, file_name")
    .maybeSingle();
  if (!claim.data) return;
  const upload = claim.data;

  // Declared outside the try so the catch block can report how many
  // lines were actually written before a later item threw - see the
  // catch below.
  let written = 0;

  try {
    const dl = await admin.storage
      .from("case-documents")
      .download(upload.storage_path as string);
    if (dl.error || !dl.data) {
      throw new Error("Storage download failed: " + (dl.error?.message ?? "unknown"));
    }
    const rawBytes = new Uint8Array(await dl.data.arrayBuffer());
    const { bytes, mimeType } = toExtractableInput(upload.file_name as string, rawBytes);

    const result = await extractBulkIntakeDocument({ bytes, mimeType });

    for (const item of result.items) {
      const ok = await applyExtractedItem(admin, {
        caseId: upload.case_id as string,
        uploadId: upload.id as string,
        item,
      });
      if (ok) written++;
    }

    await admin
      .from("pch_intake_uploads")
      .update({
        status: "done",
        items_count: written,
        processed_at: new Date().toISOString(),
      })
      .eq("id", uploadId);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown extraction error";
    // If an item partway through the list threw (e.g. a retry-exhausted
    // top-up write), every item before it already landed in
    // pch_income_lines / pch_expense_lines - those amounts are real and
    // already applied to the case. Surfacing a bare "could not read"
    // error here would wrongly imply nothing happened, which risks the
    // client re-uploading the same file and double-counting the lines
    // that did succeed. Record how many actually wrote so both the
    // error text and the UI (bulk-document-upload.tsx) can say so.
    const prefix =
      written > 0
        ? `Added ${written} line${written === 1 ? "" : "s"} from this document before hitting an error: `
        : "";
    await admin
      .from("pch_intake_uploads")
      .update({
        status: "error",
        items_count: written,
        error_message: (prefix + message).slice(0, 1000),
        processed_at: new Date().toISOString(),
      })
      .eq("id", uploadId);
  }
}

type ApplyCtx = {
  caseId: string;
  uploadId: string;
  item: BulkExtractedItem;
};

// Returns true on write, false on reject (e.g. non-positive amount
// slipped through from the extractor, or no matched slot but kind
// means we need the fallback - handled by caller). Separated so the
// trigger's main loop can count writes cleanly.
async function applyExtractedItem(
  admin: ReturnType<typeof createAdminClient>,
  ctx: ApplyCtx,
): Promise<boolean> {
  const { caseId, uploadId, item } = ctx;
  const pence = Math.round(item.amountPounds * 100);
  if (!Number.isFinite(pence) || pence <= 0) return false;

  const noteLine = buildNoteLine(item);

  if (item.kind === "income") {
    const matchedSlot = item.suggestedSlot
      ? getIncomeSlotByLabel(item.suggestedSlot)
      : null;

    if (matchedSlot) {
      // Fixed-slot top-up. The retry-safe helper handles both races:
      // concurrent inserts of the first row (closed via partial unique
      // index + 23505 retry) and concurrent updates that would lose
      // one addition (closed via WHERE .eq on the old pence value).
      return await topUpIncomeSlot(
        admin,
        caseId,
        uploadId,
        matchedSlot.label,
        pence,
        item.confidence,
        noteLine,
      );
    }

    // Unmatched: visible extra income row. sort_order is computed and
    // assigned inside pch_insert_income_unmatched_row (migration 0128)
    // under a per-case advisory lock, not read here and passed in -
    // several uploads for the same case can now run concurrently
    // (bulk-document-upload.tsx uploads them in parallel), and a plain
    // "read max, add 1, insert" from this process would race with
    // another concurrent insert for the same case doing the same read.
    // "Other" (not "Fares") routes this into pl.rows.otherTrading in
    // the engine, matching how the accountant portal's
    // addAccountantIncomeLineAction classifies freeform rows.
    const ins = await admin.rpc("pch_insert_income_unmatched_row", {
      p_case_id: caseId,
      p_source: item.label.slice(0, 80),
      p_gross_takings_pence: pence,
      p_upload_id: uploadId,
      p_confidence: item.confidence,
      p_note: noteLine,
      p_likely_personal: item.likelyPersonal,
    });
    if (ins.error) throw new Error(ins.error.message);
    return true;
  }

  // Expense.
  const matchedSlot = item.suggestedSlot
    ? getExpenseSlotByLabel(item.suggestedSlot)
    : null;

  if (matchedSlot) {
    return await topUpExpenseSlot(
      admin,
      caseId,
      uploadId,
      matchedSlot,
      pence,
      item.confidence,
      noteLine,
    );
  }

  // Unmatched expense: visible extra expense row. Classification
  // triple defaults to the "Other expense" slot (category "Other
  // expenses", sa103s_box 19, car_cost "No") - these are
  // uncategorised items that the accountant can re-slot later, NOT
  // a new tax category.
  // sort_order assigned inside pch_insert_expense_unmatched_row
  // (migration 0128) under a per-case advisory lock - see the income
  // branch above for why this can no longer be a plain read-then-insert.
  const fallback = EXPENSE_FALLBACK_SLOT;
  const ins = await admin.rpc("pch_insert_expense_unmatched_row", {
    p_case_id: caseId,
    p_label: item.label.slice(0, 80),
    p_amount_paid_pence: pence,
    p_category: fallback.category,
    p_sa103s_box: fallback.sa103s_box,
    p_car_cost: fallback.car_cost,
    p_upload_id: uploadId,
    p_confidence: item.confidence,
    p_note: noteLine,
    p_likely_personal: item.likelyPersonal,
  });
  if (ins.error) throw new Error(ins.error.message);
  return true;
}

function buildNoteLine(item: BulkExtractedItem): string {
  // Prefix with the extractor's own hint; prepend the date if visible
  // so the client can line it up against their records faster.
  const parts: string[] = [];
  if (item.date) parts.push(item.date);
  if (item.note) parts.push(item.note);
  return parts.join(" ") || "From your upload";
}

function appendNote(prev: string | null, line: string): string {
  const prevLines = prev ? prev.split("\n").filter((s) => s.length > 0) : [];
  const next = [...prevLines, line].slice(-MAX_NOTE_LINES);
  return next.join("\n");
}

// If the row has previously accumulated at "high" and this top-up is
// "low", we want the row to say "low" overall - the review UI should
// flag the row at the lowest confidence anything that touched it.
function lowerConfidence(
  prev: "high" | "medium" | "low" | null,
  next: "high" | "medium" | "low",
): "high" | "medium" | "low" {
  if (prev === null) return next;
  const rank: Record<"high" | "medium" | "low", number> = { high: 3, medium: 2, low: 1 };
  return rank[prev] <= rank[next] ? prev : next;
}

async function findSlotIncomeRow(
  admin: ReturnType<typeof createAdminClient>,
  caseId: string,
  label: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await admin
    .from("pch_income_lines")
    .select("id, gross_takings_pence, extraction_note, extraction_confidence")
    .eq("case_id", caseId)
    .eq("source", label)
    .limit(1)
    .maybeSingle();
  return data as Record<string, unknown> | null;
}

async function findSlotExpenseRow(
  admin: ReturnType<typeof createAdminClient>,
  caseId: string,
  label: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await admin
    .from("pch_expense_lines")
    .select("id, amount_paid_pence, extraction_note, extraction_confidence")
    .eq("case_id", caseId)
    .eq("label", label)
    .limit(1)
    .maybeSingle();
  return data as Record<string, unknown> | null;
}

// Retry-safe fixed-slot top-up: closes the two races documented at the
// top of this file + in migration 0125. On a fresh case the slot's row
// does not yet exist, so attempt an INSERT; the partial unique index
// on (case_id, source) means a concurrent job trying the same insert
// gets 23505 and we retry (next iteration finds the row the winner
// created). Once the row exists, we optimistically UPDATE with the
// old amount pinned in the WHERE clause: if a concurrent writer
// changed it between read and update, 0 rows are affected and we
// retry from a fresh read. Caps at 8 attempts to avoid pathological
// loops under sustained contention; well above anything two or three
// parallel per-upload jobs will realistically produce.
async function topUpIncomeSlot(
  admin: ReturnType<typeof createAdminClient>,
  caseId: string,
  uploadId: string,
  slotLabel: string,
  addPence: number,
  confidence: "high" | "medium" | "low",
  noteLine: string,
): Promise<boolean> {
  const MAX_ATTEMPTS = 8;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const existing = await findSlotIncomeRow(admin, caseId, slotLabel);
    if (!existing) {
      // line_type: "Fares" matches upsertPchIncomeLineAction's manual
      // path so the engine routes this through pl.rows.fares the same
      // way a client-typed row would. sort_order is computed and
      // assigned inside pch_insert_income_topup_row (migration 0128)
      // under a per-case advisory lock, not read here - several
      // uploads for the same case can run concurrently now, so a
      // plain "read max, add 1" from this process would race with
      // another concurrent insert for the same case.
      const ins = await admin.rpc("pch_insert_income_topup_row", {
        p_case_id: caseId,
        p_source: slotLabel,
        p_gross_takings_pence: addPence,
        p_upload_id: uploadId,
        p_confidence: confidence,
        p_note: noteLine,
      });
      if (!ins.error) return true;
      if (ins.error.code === "23505") {
        await jitterDelay(attempt);
        continue;
      }
      throw new Error(ins.error.message);
    }
    const nextPence = Number(existing.gross_takings_pence ?? 0) + addPence;
    const nextNote = appendNote(existing.extraction_note as string | null, noteLine);
    const nextConfidence = lowerConfidence(
      existing.extraction_confidence as "high" | "medium" | "low" | null,
      confidence,
    );
    const upd = await admin
      .from("pch_income_lines")
      .update({
        gross_takings_pence: nextPence,
        auto_extracted: true,
        client_reviewed: false,
        source_upload_id: uploadId,
        extraction_confidence: nextConfidence,
        extraction_note: nextNote,
      })
      .eq("id", existing.id as string)
      .eq("gross_takings_pence", existing.gross_takings_pence as number)
      .select("id");
    if (upd.error) throw new Error(upd.error.message);
    if (upd.data && upd.data.length > 0) return true;
    await jitterDelay(attempt);
  }
  throw new Error(
    `Could not update "${slotLabel}" after repeated concurrent-write retries.`,
  );
}

// Mirror of topUpIncomeSlot for pch_expense_lines. category / sa103s_box
// / car_cost are set ONCE at creation (an existing row's classification
// never changes under a top-up, so the update branch does not rewrite
// those columns).
async function topUpExpenseSlot(
  admin: ReturnType<typeof createAdminClient>,
  caseId: string,
  uploadId: string,
  slot: ExpenseSlot,
  addPence: number,
  confidence: "high" | "medium" | "low",
  noteLine: string,
): Promise<boolean> {
  const MAX_ATTEMPTS = 8;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const existing = await findSlotExpenseRow(admin, caseId, slot.label);
    if (!existing) {
      // sort_order computed and assigned inside
      // pch_insert_expense_topup_row (migration 0128) under a
      // per-case advisory lock - see topUpIncomeSlot above for why.
      const ins = await admin.rpc("pch_insert_expense_topup_row", {
        p_case_id: caseId,
        p_label: slot.label,
        p_amount_paid_pence: addPence,
        p_category: slot.category,
        p_sa103s_box: slot.sa103s_box,
        p_car_cost: slot.car_cost,
        p_upload_id: uploadId,
        p_confidence: confidence,
        p_note: noteLine,
      });
      if (!ins.error) return true;
      if (ins.error.code === "23505") {
        await jitterDelay(attempt);
        continue;
      }
      throw new Error(ins.error.message);
    }
    const nextPence = Number(existing.amount_paid_pence ?? 0) + addPence;
    const nextNote = appendNote(existing.extraction_note as string | null, noteLine);
    const nextConfidence = lowerConfidence(
      existing.extraction_confidence as "high" | "medium" | "low" | null,
      confidence,
    );
    const upd = await admin
      .from("pch_expense_lines")
      .update({
        amount_paid_pence: nextPence,
        auto_extracted: true,
        client_reviewed: false,
        source_upload_id: uploadId,
        extraction_confidence: nextConfidence,
        extraction_note: nextNote,
      })
      .eq("id", existing.id as string)
      .eq("amount_paid_pence", existing.amount_paid_pence as number)
      .select("id");
    if (upd.error) throw new Error(upd.error.message);
    if (upd.data && upd.data.length > 0) return true;
    await jitterDelay(attempt);
  }
  throw new Error(
    `Could not update "${slot.label}" after repeated concurrent-write retries.`,
  );
}

async function jitterDelay(attempt: number): Promise<void> {
  const ms = Math.min(50 * 2 ** attempt, 800) + Math.random() * 50;
  await new Promise((resolve) => setTimeout(resolve, ms));
}


// Routes a downloaded upload to the right extractable input. PDF and
// image files pass through unchanged (same inference extraction-
// trigger.ts uses for filenames it doesn't recognise, falling back to
// JPEG). A .csv file is already plain text, so it is passed through
// as-is with mimeType "text/csv". A .xlsx/.xls file is a zip/binary
// spreadsheet format the model cannot read directly, so it is parsed
// here and converted to CSV text first (every sheet, in case a
// platform export has more than one tab); only the converted text
// ever reaches extractBulkIntakeDocument.
function toExtractableInput(
  filename: string,
  rawBytes: Uint8Array,
): { bytes: Uint8Array; mimeType: BulkIntakeDocument["mimeType"] } {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return { bytes: rawBytes, mimeType: "application/pdf" };
  if (lower.endsWith(".png")) return { bytes: rawBytes, mimeType: "image/png" };
  if (lower.endsWith(".webp")) return { bytes: rawBytes, mimeType: "image/webp" };
  if (lower.endsWith(".csv")) return { bytes: rawBytes, mimeType: "text/csv" };
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const workbook = XLSX.read(rawBytes, { type: "array" });
    const csvParts = workbook.SheetNames.map((sheetName) =>
      `Sheet: ${sheetName}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName])}`,
    );
    const csvText = csvParts.join("\n\n");
    return { bytes: new TextEncoder().encode(csvText), mimeType: "text/csv" };
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return { bytes: rawBytes, mimeType: "image/jpeg" };
  }
  return { bytes: rawBytes, mimeType: "image/jpeg" };
}
