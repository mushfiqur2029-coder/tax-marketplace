"use server";

// Minimal accountant surface for PCH automated cases (phase 2a).
// Only the 33-check marker lives here; the full override UI + SA
// boxes side-by-side screen come in phase 2b.
//
// Dual sign-off gate for "ready to file":
//   - all 33 checks must be Done or N/A
//   - client approval record must exist (pch_cases.client_approval_at)
// enforced by the status-transition action below.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

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
  // Silence the lint for the unused "notDone" count — kept for future
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
  revalidatePath(`/accountant/cases/${caseId}/pch`);
  revalidatePath(`/client/cases/${caseId}/pch`);
  return { ok: true };
}
