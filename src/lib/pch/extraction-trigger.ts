import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractForSlot, SLOT_DEFINITIONS, type DocumentInput } from "./ai-extract";

// Trigger wired into uploadPchDocumentAction. For every uploaded doc:
//   1. If the slot is skip-mode, do nothing.
//   2. Else insert a pch_doc_extractions row with status='pending'
//      so the client UI immediately shows "reading this document...".
//   3. Hand off the AI call to Next's after() so it runs after the
//      action's response is sent (the upload must not block 10s on
//      Claude). The background job updates the row to 'done' / 'error'.
//
// Rate limit: refuse to create a new extraction when the case already
// has >= 3 extractions within the last 60s. Guards against a client
// re-upload loop ballooning the AI bill, with a tolerance that lets
// genuine fast re-uploads through.

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 3;

export type ScheduledExtraction =
  | { skipped: true; reason: "slot_skipped" | "rate_limited" }
  | { skipped: false; extractionId: string };

// Insert the row synchronously (so the client UI immediately shows
// a pending card for the just-uploaded doc) and return the id so the
// caller can hand it to runExtractionJob() inside after().
export async function schedulePchExtraction(opts: {
  caseId: string;
  slotCode: string;
  documentId: string;
}): Promise<ScheduledExtraction> {
  const def = SLOT_DEFINITIONS[opts.slotCode];
  if (!def || def.mode === "skip") {
    return { skipped: true, reason: "slot_skipped" };
  }

  const admin = createAdminClient();

  // Rate limit per case.
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count } = await admin
    .from("pch_doc_extractions")
    .select("id", { count: "exact", head: true })
    .eq("case_id", opts.caseId)
    .gte("created_at", windowStart);
  if ((count ?? 0) >= RATE_LIMIT_MAX) {
    return { skipped: true, reason: "rate_limited" };
  }

  // Previous extraction for this document? Replace it. One extraction
  // per uploaded case_document row keeps the client UI simple.
  await admin
    .from("pch_doc_extractions")
    .delete()
    .eq("document_id", opts.documentId);

  const { data, error } = await admin
    .from("pch_doc_extractions")
    .insert({
      case_id: opts.caseId,
      slot_code: opts.slotCode,
      document_id: opts.documentId,
      status: "pending",
      source: "document",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error("Could not schedule extraction: " + error?.message);
  }
  return { skipped: false, extractionId: data.id };
}

// Downloads the uploaded doc from storage, runs the model, writes the
// result back to pch_doc_extractions. Called from Next's after() so it
// runs after the response is sent. Any thrown error is caught and
// stored on the extraction row so the client UI can show a friendly
// "we could not read this" message.
export async function runPchExtractionJob(extractionId: string): Promise<void> {
  const admin = createAdminClient();

  try {
    // Load the extraction row + the underlying case_document row (we
    // need the storage path).
    const { data: ext } = await admin
      .from("pch_doc_extractions")
      .select("id, slot_code, document_id")
      .eq("id", extractionId)
      .single();
    if (!ext) return;

    const { data: doc } = await admin
      .from("case_documents")
      .select("id, file_url, file_name")
      .eq("id", ext.document_id)
      .single();
    if (!doc) throw new Error("case_document row missing");

    // Download the uploaded file bytes from storage.
    const dl = await admin.storage.from("case-documents").download(doc.file_url);
    if (dl.error || !dl.data) {
      throw new Error("storage download failed: " + dl.error?.message);
    }
    const bytes = new Uint8Array(await dl.data.arrayBuffer());
    const mimeType = inferMimeType(doc.file_name);

    // Run the extraction.
    const started = Date.now();
    const result = await extractForSlot(ext.slot_code, { bytes, mimeType } as DocumentInput);
    if (!result) {
      // Should not happen because schedulePchExtraction already filters
      // skip-mode slots, but belt and braces.
      await admin
        .from("pch_doc_extractions")
        .update({ status: "skipped", extracted_at: new Date().toISOString() })
        .eq("id", extractionId);
      return;
    }

    await admin
      .from("pch_doc_extractions")
      .update({
        status: "done",
        extracted_at: new Date().toISOString(),
        model: SLOT_DEFINITIONS[ext.slot_code]?.model ?? "claude-sonnet-4-6",
        overall_confidence: result.overallConfidence,
        document_type: result.documentType,
        fields: result.fields,
        raw_json: result.rawJson,
        usage: { latency_ms: Date.now() - started },
      })
      .eq("id", extractionId);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown extraction error";
    await admin
      .from("pch_doc_extractions")
      .update({
        status: "error",
        extracted_at: new Date().toISOString(),
        error_message: message.slice(0, 1000),
      })
      .eq("id", extractionId);
  }
}

function inferMimeType(filename: string): DocumentInput["mimeType"] {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  // Default to jpeg (covers .jpg + .jpeg + anything odd).
  return "image/jpeg";
}
