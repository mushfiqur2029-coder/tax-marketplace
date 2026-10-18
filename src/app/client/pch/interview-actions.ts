"use server";

// Server actions for the AI income-reconstruction interview (Slice 3).
//
// Flow:
//   1. Client clicks "I don't have this document" on a slot card.
//   2. UI calls startInterviewAction → gets the deterministic opener.
//   3. For each client reply, UI calls advanceInterviewAction with the
//      full transcript so far. We either return the next assistant
//      message, or signal that the interview is finished and hand back
//      the final structured fields (same shape as a document extraction).
//   4. When done, UI calls commitInterviewAction which:
//        - Writes a pch_doc_extractions row with source='ai_interview',
//          document_id null, fields in the same shape, raw_json holding
//          the full transcript (per the operator's audit decision).
//        - If any field came back `missing`, flips the slot's
//          pch_doc_status to 'Awaiting accountant' so the accountant
//          sees the slot needs chasing without hunting through the
//          review UI. (Same philosophy as the prior-year anomaly
//          flagging shipped in Phase 4.)
//
// All conversation state lives in the UI, not here. The server is
// stateless between turns, which also means an abandoned interview
// costs us nothing beyond its token spend.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getInterviewFlow,
  hasInterviewFor,
  openInterview,
  runInterviewTurn,
  type InterviewMessage,
  type InterviewTurnResult,
} from "@/lib/pch/ai-interview";

type ActionOk<T = Record<string, never>> = { ok: true } & T;
type ActionErr = { ok: false; error: string };
type ActionResult<T = Record<string, never>> = ActionOk<T> | ActionErr;

// Shared ownership guard. Mirrors requirePchCase() in actions.ts but
// kept local to this file to avoid widening that module's exports and
// to keep the error strings tailored to the interview surface.
async function requireClientPchCase(caseId: string) {
  const me = await requireRole("client");
  const admin = createAdminClient();
  const { data } = await admin
    .from("cases")
    .select("id, client_id, status, tier")
    .eq("id", caseId)
    .single();
  if (!data) throw new Error("Case not found.");
  if (data.client_id !== me.id) throw new Error("Not your case.");
  if (data.tier !== "uber_phv_automated") {
    throw new Error("Not a PCH automated case.");
  }
  return { me, caseRow: data, admin };
}

function assertEditable(status: string): ActionErr | null {
  if (status === "submitted") return null;
  return {
    ok: false,
    error:
      "Your return is already with your accountant. Message them if something needs to change.",
  };
}

export async function startInterviewAction(
  caseId: string,
  slotCode: string,
): Promise<ActionResult<{ opener: InterviewMessage }>> {
  try {
    const { caseRow } = await requireClientPchCase(caseId);
    const lock = assertEditable(caseRow.status);
    if (lock) return lock;
    if (!hasInterviewFor(slotCode)) {
      return {
        ok: false,
        error: "No AI interview is available for this slot yet.",
      };
    }
    return { ok: true, opener: openInterview(slotCode) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Interview failed to start." };
  }
}

export async function advanceInterviewAction(
  caseId: string,
  slotCode: string,
  transcript: InterviewMessage[],
): Promise<ActionResult<{ turn: InterviewTurnResult }>> {
  try {
    const { caseRow } = await requireClientPchCase(caseId);
    const lock = assertEditable(caseRow.status);
    if (lock) return lock;
    if (!hasInterviewFor(slotCode)) {
      return { ok: false, error: "No AI interview is available for this slot." };
    }
    // Light defensive shaping: trim whitespace, drop empties. The runTurn
    // function also validates length upstream.
    const cleaned = transcript
      .map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content.trim() : "" }))
      .filter((m) => m.content.length > 0);
    if (cleaned.length === 0 || cleaned[0].role !== "assistant") {
      return {
        ok: false,
        error: "Transcript must start with the opener message.",
      };
    }
    const turn = await runInterviewTurn(slotCode, cleaned);
    return { ok: true, turn };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "AI interview failed." };
  }
}

export async function commitInterviewAction(
  caseId: string,
  slotCode: string,
  transcript: InterviewMessage[],
): Promise<ActionResult<{ extractionId: string }>> {
  try {
    const { me, caseRow, admin } = await requireClientPchCase(caseId);
    const lock = assertEditable(caseRow.status);
    if (lock) return lock;
    const flow = getInterviewFlow(slotCode);
    if (!flow) {
      return { ok: false, error: "No AI interview is available for this slot." };
    }

    // Re-run the final turn on the server so the committed values are
    // the model's own output, not something the client could have hand
    // crafted in the browser. This is why we don't accept the finalized
    // fields as an action argument.
    const final = await runInterviewTurn(slotCode, transcript);
    if (final.kind !== "done") {
      return {
        ok: false,
        error:
          "The AI isn't finished yet, there are still fields to confirm. Keep going in the chat.",
      };
    }

    // Pre-seed field_states so the review UI treats every field as
    // 'proposed' (same default as document extractions). Keeps the apply
    // step consistent whether the row came from a doc or an interview.
    const fieldStates: Record<string, { status: "proposed" }> = {};
    for (const key of Object.keys(final.fields)) {
      fieldStates[key] = { status: "proposed" };
    }

    // One extraction row per interview run. If the client re-runs the
    // interview on the same slot, replace the prior interview row so
    // the review UI doesn't accumulate stale drafts. We ONLY delete
    // prior interview rows for this slot; document extractions for the
    // same slot are preserved (the client may have uploaded a doc
    // between runs).
    await admin
      .from("pch_doc_extractions")
      .delete()
      .eq("case_id", caseId)
      .eq("slot_code", slotCode)
      .eq("source", "ai_interview");

    const { data: inserted, error: insertError } = await admin
      .from("pch_doc_extractions")
      .insert({
        case_id: caseId,
        slot_code: slotCode,
        document_id: null,
        source: "ai_interview",
        model: "claude-sonnet-4-6",
        status: "done",
        extracted_at: new Date().toISOString(),
        overall_confidence: final.overallConfidence,
        document_type: final.documentType,
        fields: final.fields,
        field_states: fieldStates,
        // Audit column reuse per the operator's call: transcript is
        // part of the audit trail, same as document raw_json.
        raw_json: { transcript },
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      return {
        ok: false,
        error: insertError?.message ?? "Could not save the interview result.",
      };
    }

    // Slot-status update. Any missing field flips the slot into the
    // new 'Awaiting accountant' state (surface it proactively per the
    // Phase 4 anomaly-flagging pattern). All fields answered? Mark the
    // slot 'Uploaded' so the client's checklist shows the slot as done.
    const anyMissing = Object.values(final.fields).some(
      (f) => f.confidence === "missing" || f.value == null,
    );
    const nextStatus = anyMissing ? "Awaiting accountant" : "Uploaded";
    const noteParts = [
      "Captured via AI interview on " + new Date().toISOString().slice(0, 10) + ".",
    ];
    if (anyMissing) {
      const missingKeys = Object.entries(final.fields)
        .filter(([, f]) => f.confidence === "missing" || f.value == null)
        .map(([k]) => k);
      noteParts.push("Needs accountant input: " + missingKeys.join(", ") + ".");
    }
    await admin.from("pch_doc_status").upsert(
      {
        case_id: caseId,
        slot_code: slotCode,
        status: nextStatus,
        note: noteParts.join(" "),
        updated_at: new Date().toISOString(),
        updated_by: me.id,
      },
      { onConflict: "case_id,slot_code" },
    );

    revalidatePath(`/client/cases/${caseId}/pch`);
    return { ok: true, extractionId: inserted.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not commit interview." };
  }
}
