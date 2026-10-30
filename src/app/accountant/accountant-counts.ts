import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Counts that show as badges on the accountant sidebar nav so queue
// state is visible without opening /accountant. Called once per request
// from the accountant layout.
export type AccountantNavCounts = {
  // Paid cases waiting for someone to take them.
  queue: number;
  // Rows the current accountant owns that need their attention
  // (status in LIVE_STATUSES: in_review / prepared / filed).
  mine: number;
};

const LIVE_STATUSES = ["in_review", "prepared", "filed"];

export async function getAccountantNavCounts(
  accountantId: string,
): Promise<AccountantNavCounts> {
  const sb = await createClient();
  const [{ data: queueRows }, { count: mine }] = await Promise.all([
    // Selecting id + tier (not a head-only count) so the PCH
    // intake-ready filter below can mirror the actual queue page
    // (src/app/accountant/page.tsx) exactly - a head-count here used
    // to include PCH cases the client has paid for but not yet
    // submitted for review, which the queue page deliberately hides
    // until engine_snapshot_at is set. That mismatch showed a sidebar
    // badge like "Queue (3)" when clicking in only found 1 or 2 cases
    // actually takeable, confusing to an accountant checking the
    // badge before opening the page.
    sb
      .from("cases")
      .select("id, tier")
      .eq("status", "submitted")
      .eq("stripe_payment_status", "succeeded")
      .is("accountant_id", null),
    sb
      .from("cases")
      .select("id", { count: "exact", head: true })
      .eq("accountant_id", accountantId)
      .in("status", LIVE_STATUSES),
  ]);

  const rows = queueRows ?? [];
  const pchIds = rows.filter((r) => r.tier === "uber_phv_automated").map((r) => r.id);
  let pchReadyIds = new Set<string>();
  if (pchIds.length > 0) {
    // Service-role read, same reason as the queue page: RLS on
    // pch_cases only allows SELECT once an accountant is already
    // assigned, and these are by definition unassigned.
    const admin = createAdminClient();
    const { data: pchHeads } = await admin
      .from("pch_cases")
      .select("case_id, engine_snapshot_at")
      .in("case_id", pchIds);
    pchReadyIds = new Set(
      (pchHeads ?? []).filter((h) => h.engine_snapshot_at).map((h) => h.case_id as string),
    );
  }
  const queue = rows.filter(
    (r) => r.tier !== "uber_phv_automated" || pchReadyIds.has(r.id),
  ).length;

  return {
    queue,
    mine: mine ?? 0,
  };
}
