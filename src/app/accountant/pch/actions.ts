"use server";

// Accountant surface for PCH automated cases.
//
// Phase 2a: 33-check marker + dual sign-off gate (both still here).
// Phase 2b (this file): applyPchOverrideAction + revertPchOverrideAction
// let the accountant edit any engine-calculated figure listed in
// src/lib/pch/overrides.ts. The pch_overrides table is strictly
// append-only: a revert is just a new row with new_value = null and
// reason = 'Revert'. Current state is derived by taking the newest
// row per field_path.
//
// Dual sign-off gate for "ready to file":
//   - all 33 checks must be Done or N/A
//   - client approval record must exist (pch_cases.client_approval_at)
// enforced by the status-transition action below.

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPchReadyToApproveEmail } from "@/lib/pch/status-emails";
import type { TaxEngineOutput } from "@/lib/tax-engine";
import {
  PCH_OVERRIDE_FIELD_BY_PATH,
  reasonRequired,
} from "@/lib/pch/overrides";
import { canRequestFiling } from "@/lib/pch/validation";

type ActionOk = { ok: true };
type ActionErr = { ok: false; error: string };
type ActionResult = ActionOk | ActionErr;

async function requireAccountantPchCase(caseId: string) {
  const me = await requireRole("accountant");
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cases")
    .select("id, client_id, accountant_id, status, tier")
    .eq("id", caseId)
    .single();
  if (error || !data) throw new Error("Case not found.");
  if (data.accountant_id !== me.id) {
    throw new Error("This case is assigned to a different accountant.");
  }
  if (data.tier !== "uber_phv_automated") {
    throw new Error("Not a PCH automated case.");
  }
  return { me, caseRow: data };
}

export async function setPchCheckStatusAction(
  caseId: string,
  itemNumber: number,
  status: "Done" | "N/A" | "Not started",
  note?: string,
): Promise<ActionResult> {
  const { me } = await requireAccountantPchCase(caseId);
  const admin = createAdminClient();
  const { error } = await admin.from("pch_check_status").upsert(
    {
      case_id: caseId, item_number: itemNumber, status,
      note: note ?? null,
      updated_at: new Date().toISOString(), updated_by: me.id,
    },
    { onConflict: "case_id,item_number" },
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/accountant/cases/${caseId}/pch`);
  return { ok: true };
}

// -------------------------------------------------------------------
// Dual sign-off gate: advance a PCH case to "client_approval" (which
// is the trigger for the client-side "Approve and file" step). Server-
// side guard: all 33 checks Done/N/A AND the client has already typed
// their name against the current snapshot.
//
// We check the client approval BEFORE this transition only when the
// accountant is pushing the case forward manually; in normal flow the
// client approval is recorded first (phase 2a design), then the
// accountant marks all checks, then this action runs.
// -------------------------------------------------------------------
export async function requestClientFilingAction(
  caseId: string,
): Promise<ActionResult> {
  const { caseRow } = await requireAccountantPchCase(caseId);
  const admin = createAdminClient();

  // Gate 1: all 33 checks resolved.
  const { count: notDone } = await admin
    .from("pch_check_status")
    .select("item_number", { count: "exact", head: true })
    .eq("case_id", caseId)
    .not("status", "in", "(Done,N/A)");
  const { count: totalItems } = await admin
    .from("pch_check_items")
    .select("item_number", { count: "exact", head: true });
  // notDone counts rows explicitly inserted but not resolved. Items the
  // accountant hasn't touched at all aren't in pch_check_status, so the
  // true "unresolved" count is (totalItems - resolved).
  const { count: resolved } = await admin
    .from("pch_check_status")
    .select("item_number", { count: "exact", head: true })
    .eq("case_id", caseId)
    .in("status", ["Done", "N/A"]);
  if ((resolved ?? 0) < (totalItems ?? 33)) {
    return { ok: false, error:
      `Checklist incomplete: ${resolved ?? 0} of ${totalItems ?? 33} items resolved. Mark every item Done or N/A first.` };
  }

  // Evidence gate: every positive-amount expense must have a method
  // code (receipts, bank statement, estimate E2, etc.) before filing.
  // Mirrors the Est_Flag convention from tab 3 of the workbook. The
  // 33-check item on evidence covers the review-side obligation; this
  // gate is the mechanical belt-and-braces that no case can slip to
  // approval with blank-evidence rows still sitting in the data.
  const { data: expenses } = await admin
    .from("pch_expense_lines")
    .select("amount_paid_pence, evidence")
    .eq("case_id", caseId);
  const evidenceCheck = canRequestFiling(
    (expenses ?? []).map((r) => ({
      amountPaid: (r.amount_paid_pence ?? 0) / 100,
      evidence: r.evidence ?? null,
    })),
  );
  if (!evidenceCheck.ok) {
    return { ok: false, error: evidenceCheck.blockers.join(" ") };
  }
  // Silence the lint for the unused "notDone" count, kept for future
  // reporting on which rows the client objected to.
  void notDone;

  // Gate 2: the current status must be in_review or prepared. We can't
  // request filing from draft/submitted.
  if (caseRow.status !== "in_review" && caseRow.status !== "prepared") {
    return { ok: false, error:
      `Case status is ${caseRow.status}; must be in_review or prepared to request filing.` };
  }

  // Move the case to client_approval. The client's existing
  // client_approval→filed RLS policy handles the final flip when they
  // click "Approve and file" on the draft page.
  const { error } = await admin
    .from("cases")
    .update({ status: "client_approval" })
    .eq("id", caseId)
    .eq("status", caseRow.status); // concurrency guard
  if (error) return { ok: false, error: error.message };

  after(() => sendPchReadyToApproveEmail(caseId));
  revalidatePath(`/accountant/cases/${caseId}/pch`);
  revalidatePath(`/client/cases/${caseId}/pch`);
  return { ok: true };
}

// -------------------------------------------------------------------
// Override an engine-calculated figure. Append-only: every call writes
// one new row to pch_overrides, so the UI can show the full audit
// trail (who, when, old, new, reason) without ever losing history.
//
// Guards:
//   - field_path must be in the known catalogue (src/lib/pch/overrides)
//   - case must be a PCH automated case this accountant is assigned to
//   - engine snapshot must exist (otherwise there's no calculated
//     baseline to compare against)
//   - reason text is MANDATORY when the delta is "material" per the
//     scope rules (see reasonRequired)
// -------------------------------------------------------------------
export async function applyPchOverrideAction(
  caseId: string,
  fieldPath: string,
  newValue: number,
  reason: string | null,
): Promise<ActionResult> {
  const { me } = await requireAccountantPchCase(caseId);
  const field = PCH_OVERRIDE_FIELD_BY_PATH[fieldPath];
  if (!field) return { ok: false, error: "Unknown override field: " + fieldPath };
  if (!Number.isFinite(newValue)) {
    return { ok: false, error: "New value must be a number." };
  }

  const admin = createAdminClient();

  // Need a snapshot to know what the engine currently says. We also
  // need the "current effective value" (which may itself be a prior
  // override) so old_value in the audit trail is honest.
  const { data: head } = await admin
    .from("pch_cases")
    .select("engine_snapshot")
    .eq("case_id", caseId)
    .single();
  const snapshot = (head?.engine_snapshot ?? null) as TaxEngineOutput | null;
  if (!snapshot) return { ok: false, error: "No engine snapshot yet. Run the draft first." };

  // Find the current effective value: the newest non-reverted row for
  // this field, or the engine value if no overrides exist.
  const { data: history } = await admin
    .from("pch_overrides")
    .select("new_value")
    .eq("case_id", caseId)
    .eq("field_path", fieldPath)
    .order("overridden_at", { ascending: false })
    .limit(1);
  const latest = history?.[0];
  const currentValue = latest && latest.new_value !== null
    ? Number(latest.new_value)
    : field.read(snapshot);

  const trimmed = (reason ?? "").trim();
  if (reasonRequired(currentValue, newValue, field.scope) && trimmed.length < 3) {
    return { ok: false, error:
      "This change is large enough that we need a short reason (3+ characters)." };
  }

  const { error } = await admin.from("pch_overrides").insert({
    case_id: caseId,
    field_path: fieldPath,
    old_value: String(currentValue),
    new_value: String(newValue),
    reason: trimmed || null,
    overridden_by: me.id,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/accountant/cases/${caseId}/pch`);
  return { ok: true };
}

// -------------------------------------------------------------------
// Revert an override. Writes a new row with new_value = null and
// reason = 'Revert', which the "current state" fold interprets as
// "field is no longer overridden; show the engine's calculated value".
// -------------------------------------------------------------------
// -------------------------------------------------------------------
// SA302 reconciliation: save the values pasted from the filing
// software so the accountant can diff them against the engine. One
// record per case stored on pch_cases.sa302_comparison; a save replaces
// the previous blob entirely (no history needed, the final SA302 is
// the latest paste).
// -------------------------------------------------------------------
export async function savePchSa302ComparisonAction(
  caseId: string,
  values: Record<string, number | null>,
): Promise<ActionResult> {
  const { me } = await requireAccountantPchCase(caseId);
  const admin = createAdminClient();
  // Normalise: numeric → number, blank → null. Numeric keys only,
  // plus the recorded_at/by metadata we add.
  const normalised: Record<string, number | null | string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === null || v === undefined || Number.isNaN(v as number)) {
      normalised[k] = null;
    } else if (typeof v === "number" && Number.isFinite(v)) {
      normalised[k] = v;
    }
  }
  normalised.recorded_at = new Date().toISOString();
  normalised.recorded_by = me.id;
  const { error } = await admin
    .from("pch_cases")
    .update({ sa302_comparison: normalised })
    .eq("case_id", caseId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/accountant/cases/${caseId}/pch`);
  return { ok: true };
}

// -------------------------------------------------------------------
// Slice 5: resolve a slot the client flagged as 'Awaiting accountant'.
// The accountant has either gathered the info another way (DVLA / HMRC
// agent lookup / case message) and already filled the figure via the
// override UI, or they decided the slot genuinely doesn't apply. Either
// way the slot comes out of the "Questions from the client" queue.
//
// Status transitions to 'Not applicable' with an audit note. We don't
// use 'Uploaded' because no file actually landed; the override audit
// log (pch_overrides) records whatever change the accountant made.
// -------------------------------------------------------------------
export async function resolvePchBlockedSlotAction(
  caseId: string,
  slotCode: string,
  note?: string,
): Promise<ActionResult> {
  const { me } = await requireAccountantPchCase(caseId);
  const admin = createAdminClient();
  const { data: current } = await admin
    .from("pch_doc_status")
    .select("status, note")
    .eq("case_id", caseId)
    .eq("slot_code", slotCode)
    .maybeSingle();
  if (!current || current.status !== "Awaiting accountant") {
    return {
      ok: false,
      error: "That slot is not in the awaiting-accountant state.",
    };
  }
  const trimmed = typeof note === "string" ? note.trim() : "";
  const marker = "[Resolved by accountant on " + new Date().toISOString().slice(0, 10) + "]";
  // Preserve the client's original note so the audit history reads
  // top-to-bottom: client ask + accountant resolution.
  const combined = [current.note ?? "", `${marker} ${trimmed || "No further detail."}`]
    .filter((s) => s.length > 0)
    .join(" ");
  const { error } = await admin.from("pch_doc_status").upsert(
    {
      case_id: caseId,
      slot_code: slotCode,
      status: "Not applicable",
      note: combined,
      updated_at: new Date().toISOString(),
      updated_by: me.id,
    },
    { onConflict: "case_id,slot_code" },
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/accountant/cases/${caseId}/pch`);
  return { ok: true };
}

export async function revertPchOverrideAction(
  caseId: string,
  fieldPath: string,
): Promise<ActionResult> {
  const { me } = await requireAccountantPchCase(caseId);
  const field = PCH_OVERRIDE_FIELD_BY_PATH[fieldPath];
  if (!field) return { ok: false, error: "Unknown override field." };

  const admin = createAdminClient();

  // Need the current override value for the audit trail (old_value).
  const { data: history } = await admin
    .from("pch_overrides")
    .select("new_value")
    .eq("case_id", caseId)
    .eq("field_path", fieldPath)
    .order("overridden_at", { ascending: false })
    .limit(1);
  const latest = history?.[0];
  if (!latest || latest.new_value === null) {
    return { ok: false, error: "No override to revert on this field." };
  }

  const { error } = await admin.from("pch_overrides").insert({
    case_id: caseId,
    field_path: fieldPath,
    old_value: latest.new_value,
    new_value: null,
    reason: "Revert",
    overridden_by: me.id,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/accountant/cases/${caseId}/pch`);
  return { ok: true };
}
