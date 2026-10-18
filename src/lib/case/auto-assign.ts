import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Pick the least-loaded approved accountant and assign them to a case.
// Load = count of cases where the accountant is assigned AND the case is
// not yet closed (status not in filed/complete). Ties broken randomly so
// a single-tie startup rotation doesn't always pick the same person.
//
// Returns the assigned accountant_id on success, or null when:
//   - no approved accountants exist (admin needs to onboard one)
//   - the case already had an accountant (we respect that assignment)
//   - the DB write failed
//
// Call sites use the null return to decide whether to block the flow
// (no accountants = cannot auto-queue) or quietly skip (already assigned).

type AssignOutcome =
  | { assigned: true; accountantId: string }
  | { assigned: false; reason: "already_assigned" | "no_accountants" | "db_error"; detail?: string };

export async function autoAssignAccountant(caseId: string): Promise<AssignOutcome> {
  const admin = createAdminClient();

  const { data: caseRow } = await admin
    .from("cases")
    .select("accountant_id")
    .eq("id", caseId)
    .single();
  if (caseRow?.accountant_id) {
    return { assigned: false, reason: "already_assigned" };
  }

  const { data: profiles } = await admin
    .from("accountant_profiles")
    .select("user_id")
    .eq("approval_status", "approved");
  const accountantIds = (profiles ?? []).map((p) => p.user_id);
  if (accountantIds.length === 0) {
    return { assigned: false, reason: "no_accountants" };
  }

  const { data: openCases } = await admin
    .from("cases")
    .select("accountant_id")
    .in("accountant_id", accountantIds)
    .not("status", "in", "(complete,filed)");

  const loadByAccountant = new Map<string, number>();
  for (const id of accountantIds) loadByAccountant.set(id, 0);
  for (const c of openCases ?? []) {
    if (c.accountant_id) {
      loadByAccountant.set(
        c.accountant_id,
        (loadByAccountant.get(c.accountant_id) ?? 0) + 1,
      );
    }
  }

  const sorted = Array.from(loadByAccountant.entries()).sort((a, b) => {
    if (a[1] !== b[1]) return a[1] - b[1];
    return Math.random() - 0.5;
  });
  const chosen = sorted[0]?.[0];
  if (!chosen) return { assigned: false, reason: "no_accountants" };

  const { error } = await admin
    .from("cases")
    .update({ accountant_id: chosen })
    .eq("id", caseId);
  if (error) {
    return { assigned: false, reason: "db_error", detail: error.message };
  }
  return { assigned: true, accountantId: chosen };
}
