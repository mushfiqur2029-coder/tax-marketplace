import { createClient } from "@/lib/supabase/server";

// Counts that show as badges on the accountant sidebar nav so queue
// state is visible without opening /accountant. Called once per request
// from the accountant layout; cheap head-only count queries.
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
  const [{ count: queue }, { count: mine }] = await Promise.all([
    sb
      .from("cases")
      .select("id", { count: "exact", head: true })
      .eq("status", "submitted")
      .eq("stripe_payment_status", "succeeded")
      .is("accountant_id", null),
    sb
      .from("cases")
      .select("id", { count: "exact", head: true })
      .eq("accountant_id", accountantId)
      .in("status", LIVE_STATUSES),
  ]);
  return {
    queue: queue ?? 0,
    mine: mine ?? 0,
  };
}
