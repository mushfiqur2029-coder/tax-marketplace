import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Counts that show as badges on the admin nav so admins spot queues without
// opening each tab. Fetched from every admin page via the DashboardShell
// subnav prop.
export type AdminNavCounts = {
  accountants: number;
  clients: number;
  suspendedClients: number;
  withdrawals: number;
  profileChanges: number;
  unreadNotifications: number;
};

export async function getAdminNavCounts(): Promise<AdminNavCounts> {
  const admin = createAdminClient();
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  const [
    { count: accountants },
    { count: clients },
    { count: suspendedClients },
    { count: withdrawals },
    { count: profileChanges },
    { count: unreadNotifications },
  ] = await Promise.all([
    admin
      .from("accountant_profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("approval_status", "pending"),
    admin
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("role", "client"),
    admin
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("role", "client")
      .eq("status", "suspended"),
    admin
      .from("withdrawal_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    admin
      .from("pending_profile_changes")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    user
      ? admin
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("recipient_id", user.id)
          .eq("read", false)
      : Promise.resolve({ count: 0 } as { count: number }),
  ]);

  return {
    accountants: accountants ?? 0,
    clients: clients ?? 0,
    suspendedClients: suspendedClients ?? 0,
    withdrawals: withdrawals ?? 0,
    profileChanges: profileChanges ?? 0,
    unreadNotifications: unreadNotifications ?? 0,
  };
}
