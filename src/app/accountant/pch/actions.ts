"use server";

// Accountant surface for PCH automated cases.
//
// Phase I: this file was aggressively pruned when the AI-bank-parse /
// override / SA302-comparison / 33-check pipeline was deleted. The old
// per-line edit, override-apply, SA302-comparison, bookkeeping-confirm,
// rerun-snapshot and final-pack actions all went with it. New Phase I
// server surface for the 4-document send/approve/file flow lives
// alongside this file (pl-actions.ts, final-docs-actions.ts), scoped
// to the new UI and nothing else.
//
// requestClientFilingAction below is the one survivor from the old
// surface; its gate will shift from "the 33-check checklist is
// resolved" to "all four final-pack doc paths are populated" in a
// later Phase I step.

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPchReadyToApproveEmail } from "@/lib/pch/status-emails";

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

// -------------------------------------------------------------------
// Advance a PCH case to "client_approval" so the client's approve-and-
// file card shows up on their dashboard. Status gate: the case must be
// at in_review or prepared when we flip it. The old 33-check /
// expense-evidence gate was removed with the rest of the deleted
// pipeline; the Phase I gate (all four final-pack doc paths populated)
// is enforced by the caller (FinalDocumentsPanel's "Send for client
// confirmation" button) rather than being baked in here.
// -------------------------------------------------------------------
export async function requestClientFilingAction(
  caseId: string,
): Promise<ActionResult> {
  const { caseRow } = await requireAccountantPchCase(caseId);
  const admin = createAdminClient();

  if (caseRow.status !== "in_review" && caseRow.status !== "prepared") {
    return {
      ok: false,
      error: `Case status is ${caseRow.status}; must be in_review or prepared to request filing.`,
    };
  }

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
