import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  extractForSlot,
  SLOT_DEFINITIONS,
  type DocumentInput,
  type ExtractionContext,
} from "./ai-extract";

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
  photoIdSide?: "front" | "back" | null;
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
      photo_id_side: opts.photoIdSide ?? null,
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
      .select("id, case_id, slot_code, document_id, photo_id_side")
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

    // Build the extraction context. For PCH-24 we pull the up-front
    // passport-vs-licence choice off pch_cases so the vision prompt
    // knows which side it's looking at.
    const ctx = await buildContext(admin, ext.case_id, ext.slot_code, ext.photo_id_side);

    // Run the extraction.
    const started = Date.now();
    const result = await extractForSlot(
      ext.slot_code,
      { bytes, mimeType } as DocumentInput,
      ctx,
    );
    if (!result) {
      // Should not happen because schedulePchExtraction already filters
      // skip-mode slots, but belt and braces.
      await admin
        .from("pch_doc_extractions")
        .update({ status: "skipped", extracted_at: new Date().toISOString() })
        .eq("id", extractionId);
      return;
    }

    // For PCH-24 licence sides, pre-populate field_states to auto-skip
    // the fields we already know won't be on this image (name/DOB are on
    // the front, address is on the back). The review UI hides these
    // auto-skipped rows entirely so the client doesn't tap Skip on each
    // one; the summary panel still counts them as resolved. The server
    // marker (actedBy='system:auto-skip') is what the review filter
    // keys on.
    const autoSkipStates = buildAutoSkipFieldStates(ext.slot_code, ext.photo_id_side, result.fields);

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
        ...(Object.keys(autoSkipStates).length > 0 ? { field_states: autoSkipStates } : {}),
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

// Fields that are known to never be on a given side of a UK driving
// licence. Pre-marked rejected (actedBy = system marker) so the review
// UI can hide them without the client needing to tap Skip on each. Keys
// match the AI extraction schema for PCH-24.
//
// A UK photocard licence prints name, DOB, licence number AND the
// residential address all on the FRONT; the back carries only the
// vehicle-category entitlement table, no personal data at all. (This
// previously had front/back reversed, which is what caused address and
// postcode to go unextracted even when plainly visible on the front.)
const LICENCE_OFF_SIDE_FIELDS: Record<"front" | "back", readonly string[]> = {
  // Everything in our schema is genuinely on the front.
  front: [],
  // Nothing in our schema is on the back; it's captured for record only.
  back: ["documentNumber", "fullName", "dateOfBirth", "address", "postcode"],
};

function buildAutoSkipFieldStates(
  slotCode: string,
  photoIdSide: string | null,
  fields: Record<string, unknown>,
): Record<string, { status: "rejected"; actedAt: string; actedBy: string }> {
  if (slotCode !== "PCH-24") return {};
  if (photoIdSide !== "front" && photoIdSide !== "back") return {};
  const now = new Date().toISOString();
  const states: Record<string, { status: "rejected"; actedAt: string; actedBy: string }> = {};
  for (const key of LICENCE_OFF_SIDE_FIELDS[photoIdSide]) {
    states[key] = { status: "rejected", actedAt: now, actedBy: "system:auto-skip" };
  }
  // Belt and braces: a field this side is expected to carry (e.g.
  // address on the back) sometimes just isn't legible on the photo a
  // client actually took, old/damaged card, poor lighting, a cropped
  // shot. When the AI genuinely found nothing there, don't make the
  // client tap Skip on a field with nothing in it; auto-resolve it the
  // same way as the known off-side fields. A field the AI did read, at
  // any confidence, still goes to the client for Confirm/Edit as usual.
  for (const [key, raw] of Object.entries(fields)) {
    if (states[key]) continue;
    const field = raw as { value?: unknown } | null | undefined;
    if (field && typeof field === "object" && "value" in field && field.value == null) {
      states[key] = { status: "rejected", actedAt: now, actedBy: "system:auto-skip" };
    }
  }
  return states;
}

async function buildContext(
  admin: ReturnType<typeof createAdminClient>,
  caseId: string,
  slotCode: string,
  photoIdSide: string | null,
): Promise<ExtractionContext> {
  if (slotCode !== "PCH-24") return {};
  const { data: head } = await admin
    .from("pch_cases")
    .select("photo_id_kind")
    .eq("case_id", caseId)
    .maybeSingle();
  const kind = head?.photo_id_kind as "passport" | "licence" | null | undefined;
  const side = (photoIdSide === "front" || photoIdSide === "back") ? photoIdSide : undefined;
  return {
    idKind: kind === "passport" || kind === "licence" ? kind : undefined,
    idSide: side,
  };
}
