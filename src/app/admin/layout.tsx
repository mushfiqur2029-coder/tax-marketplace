import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { Bell } from "@/components/bell";
import { AdminShell } from "@/components/admin/admin-sidebar";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { getAdminNavCounts } from "./admin-counts";

// Nested layout for /admin/**. Owns the sidebar + main-area frame so
// every admin page renders inside a consistent chrome and the sidebar
// doesn't re-render on client-side navigation.
//
// Pages themselves stop using DashboardShell — they emit
// <AdminPageHeader> + content directly and this layout wraps them.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await requireRole("admin");
  // Avatar for the sidebar identity footer. Admin profiles are
  // optional (admins created via SQL don't have one), so fall back
  // gracefully when the row is missing.
  const supabase = createAdminClient();
  const { data: profile } = await supabase
    .from("admin_profiles")
    .select("avatar_path")
    .eq("user_id", me.id)
    .maybeSingle<{ avatar_path: string | null }>();
  const counts = await getAdminNavCounts();
  const avatarPath: string | null = profile?.avatar_path ?? null;

  return (
    <AdminShell
      counts={counts}
      me={{
        id: me.id,
        name: me.name ?? null,
        email: me.email,
        role: me.role,
        avatarPath,
      }}
      bell={<Bell userId={me.id} role={me.role} />}
    >
      {/* Layout-level subscription so sidebar badge counts refresh
          when their source tables change (any admin page). The counts
          come from Promise.all over these tables in admin-counts.ts;
          adding more subscriptions here will keep them in sync.
          Tables not yet in the realtime publication (users, accountant_
          profiles) stale until next navigation — acceptable since
          admins typically navigate to the page they want to action. */}
      <RealtimeRefresh
        channel={`admin-layout-${me.id}`}
        subscriptions={[
          { table: "withdrawal_requests" },
          { table: "pending_profile_changes" },
          { table: "case_addons" },
          { table: "service_enquiries" },
        ]}
      />
      {children}
    </AdminShell>
  );
}
