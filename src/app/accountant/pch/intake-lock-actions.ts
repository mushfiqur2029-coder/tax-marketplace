"use server";

// Phase M+4: assigned accountant can briefly re-open a locked client
// intake (pch_cases.intake_submitted_at, migration 0119) so the client
// can correct a field the accountant has no edit surface for -
// identity (cl_* columns), a declaration toggle/amount, a vehicle
// detail, Section 15. The client workspace live-syncs intake_submitted
// _at and re-enables its inputs the moment the DB flips to null; the
// client re-submits with the same button they used the first time
// which stamps the column back and re-locks.
//
// Guard rails:
//   - must be the assigned accountant on this case
//   - tier must be uber_phv_automated
//   - case must still be pre-approval. Once the client has signed off
//     and figures are locked (client_approval / filed / complete),
//     refuse - re-opening at that point would silently invalidate
//     numbers the client has approved.

import { revalidatePath } from "next/cache";
import { requireRole, assertNotSuspended } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

type ActionResult = { ok: true } | { ok: false; error: string };

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
  assertNotSuspended(me.status, "work on this case");
  return { me, admin, caseRow: data };
}

export async function reopenClientIntakeAction(
  caseId: string,
): Promise<ActionResult> {
  try {
    const { admin, caseRow } = await requireAccountantPchCase(caseId);
    if (
      caseRow.status === "client_approval"
      || caseRow.status === "filed"
      || caseRow.status === "complete"
    ) {
      return {
        ok: false,
        error:
          "This case has already moved past client approval. Re-opening the intake would invalidate figures the client has signed off on.",
      };
    }
    const upd = await admin
      .from("pch_cases")
      .update({ intake_submitted_at: null })
      .eq("case_id", caseId);
    if (upd.error) return { ok: false, error: upd.error.message };
    revalidatePath(`/accountant/cases/${caseId}/pch`);
    revalidatePath(`/client/cases/${caseId}/pch`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Reopen failed." };
  }
}
