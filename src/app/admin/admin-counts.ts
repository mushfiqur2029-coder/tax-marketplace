import { createAdminClient } from "@/lib/supabase/admin";

// Counts that show as badges on the admin nav so admins spot queues without
// opening each tab. Fetched from every admin page via the DashboardShell
// subnav prop; kept lightweight (three count-only queries).
export type AdminNavCounts = {
  accountants: number;
  withdrawals: number;
  profileChanges: number;
};

export async function getAdminNavCounts(): Promise<AdminNavCounts> {
  const admin = createAdminClient();
  const [{ count: accountants }, { count: withdrawals }, { count: profileChanges }] =
    await Promise.all([
      admin
        .from("accountant_profiles")
        .select("user_id", { count: "exact", head: true })
        .eq("approval_status", "pending"),
      admin
        .from("withdrawal_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
      admin
        .from("pending_profile_changes")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
    ]);

  return {
    accountants: accountants ?? 0,
    withdrawals: withdrawals ?? 0,
    profileChanges: profileChanges ?? 0,
  };
}
