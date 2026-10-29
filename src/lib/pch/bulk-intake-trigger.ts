import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  extractBulkIntakeDocument,
  type BulkExtractedItem,
  type BulkIntakeDocument,
} from "./bulk-intake-extract";
import {
  EXPENSE_FIXED_SLOTS,
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

  // Mark the row processing BEFORE we start downloading / calling the
  // model, so the client's live-row chip flips off "pending" the
  // moment the job picks up (same pattern runPchExtractionJob uses).
  const { data: upload } = await admin
    .from("pch_intake_uploads")
    .select("id, case_id, storage_path, file_name, status")
    .eq("id", uploadId)
    .single();
  if (!upload) return;

  // Belt-and-braces: if a second after() fires for the same row
  // (e.g. retry via a replayed request), don't re-run on top of a
  // completed/errored row.
  if (upload.status === "done" || upload.status === "error") return;

  await admin
    .from("pch_intake_uploads")
    .update({ status: "processing" })
    .eq("id", uploadId);

  try {
    const dl = await admin.storage
      .from("case-documents")
      .download(upload.storage_path as string);
    if (dl.error || !dl.data) {
      throw new Error("Storage download failed: " + (dl.error?.message ?? "unknown"));
    }
    const bytes = new Uint8Array(await dl.data.arrayBuffer());
    const mimeType = inferMimeType(upload.file_name as string);

    const result = await extractBulkIntakeDocument({ bytes, mimeType });

    let written = 0;
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
    await admin
      .from("pch_intake_uploads")
      .update({
        status: "error",
        error_message: message.slice(0, 1000),
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
      // Fixed-slot top-up. Find or create the existing row (there
      // should be exactly one per label; create a zero-amount row
      // on the fly if the client somehow has no row yet for this
      // slot, mirroring upsertPchIncomeLineAction's insert branch).
      const existing = await findSlotIncomeRow(admin, caseId, matchedSlot.label);
      const base = existing ?? (await insertSeedIncomeRow(admin, caseId, matchedSlot.label));
      if (!base) return false;

      const nextPence = Number(base.gross_takings_pence ?? 0) + pence;
      const nextNote = appendNote(base.extraction_note as string | null, noteLine);
      const nextConfidence = lowerConfidence(
        base.extraction_confidence as "high" | "medium" | "low" | null,
        item.confidence,
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
        .eq("id", base.id as string);
      if (upd.error) throw new Error(upd.error.message);
      return true;
    }

    // Unmatched: visible extra income row.
    const sortOrder = await nextSortOrder(admin, "pch_income_lines", caseId);
    const ins = await admin.from("pch_income_lines").insert({
      case_id: caseId,
      source: item.label.slice(0, 80),
      gross_takings_pence: pence,
      platform_fee_pence: 0,
      on_trip_miles: 0,
      dead_miles: 0,
      // "Other" (not "Fares") routes this into pl.rows.otherTrading
      // in the engine, matching how the accountant portal's
      // addAccountantIncomeLineAction classifies freeform rows.
      line_type: "Other",
      sort_order: sortOrder,
      auto_extracted: true,
      client_reviewed: false,
      source_upload_id: uploadId,
      extraction_confidence: item.confidence,
      extraction_note: noteLine,
    });
    if (ins.error) throw new Error(ins.error.message);
    return true;
  }

  // Expense.
  const matchedSlot = item.suggestedSlot
    ? getExpenseSlotByLabel(item.suggestedSlot)
    : null;

  if (matchedSlot) {
    const existing = await findSlotExpenseRow(admin, caseId, matchedSlot.label);
    const base = existing ?? (await insertSeedExpenseRow(admin, caseId, matchedSlot));
    if (!base) return false;

    const nextPence = Number(base.amount_paid_pence ?? 0) + pence;
    const nextNote = appendNote(base.extraction_note as string | null, noteLine);
    const nextConfidence = lowerConfidence(
      base.extraction_confidence as "high" | "medium" | "low" | null,
      item.confidence,
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
      .eq("id", base.id as string);
    if (upd.error) throw new Error(upd.error.message);
    return true;
  }

  // Unmatched expense: visible extra expense row. Classification
  // triple defaults to the "Other expense" slot (category "Other
  // expenses", sa103s_box 19, car_cost "No") - these are
  // uncategorised items that the accountant can re-slot later, NOT
  // a new tax category.
  const fallback = EXPENSE_FALLBACK_SLOT;
  const sortOrder = await nextSortOrder(admin, "pch_expense_lines", caseId);
  const ins = await admin.from("pch_expense_lines").insert({
    case_id: caseId,
    label: item.label.slice(0, 80),
    amount_paid_pence: pence,
    category: fallback.category,
    sa103s_box: fallback.sa103s_box,
    car_cost: fallback.car_cost,
    sort_order: sortOrder,
    auto_extracted: true,
    client_reviewed: false,
    source_upload_id: uploadId,
    extraction_confidence: item.confidence,
    extraction_note: noteLine,
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

async function insertSeedIncomeRow(
  admin: ReturnType<typeof createAdminClient>,
  caseId: string,
  label: string,
): Promise<Record<string, unknown> | null> {
  const sortOrder = await nextSortOrder(admin, "pch_income_lines", caseId);
  // All five fixed income slots use line_type: "Fares" in the manual
  // path (see upsertPchIncomeLineAction) so the engine routes them
  // through pl.rows.fares. Match that here so a bulk-created seed
  // row for e.g. "Uber" classifies identically to a client-typed one.
  const ins = await admin
    .from("pch_income_lines")
    .insert({
      case_id: caseId,
      source: label,
      gross_takings_pence: 0,
      platform_fee_pence: 0,
      on_trip_miles: 0,
      dead_miles: 0,
      line_type: "Fares",
      sort_order: sortOrder,
    })
    .select("id, gross_takings_pence, extraction_note, extraction_confidence")
    .single();
  if (ins.error) throw new Error(ins.error.message);
  return ins.data as Record<string, unknown> | null;
}

async function insertSeedExpenseRow(
  admin: ReturnType<typeof createAdminClient>,
  caseId: string,
  slot: typeof EXPENSE_FIXED_SLOTS[number],
): Promise<Record<string, unknown> | null> {
  const sortOrder = await nextSortOrder(admin, "pch_expense_lines", caseId);
  const ins = await admin
    .from("pch_expense_lines")
    .insert({
      case_id: caseId,
      label: slot.label,
      amount_paid_pence: 0,
      category: slot.category,
      sa103s_box: slot.sa103s_box,
      car_cost: slot.car_cost,
      sort_order: sortOrder,
    })
    .select("id, amount_paid_pence, extraction_note, extraction_confidence")
    .single();
  if (ins.error) throw new Error(ins.error.message);
  return ins.data as Record<string, unknown> | null;
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

// Same shape as inferMimeType in extraction-trigger.ts - keep behaviour
// identical so the two pipelines treat the same filename the same way.
function inferMimeType(filename: string): BulkIntakeDocument["mimeType"] {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}
