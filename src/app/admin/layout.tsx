import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { Bell } from "@/components/bell";
import { AdminShell } from "@/components/admin/admin-sidebar";
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
      {children}
    </AdminShell>
  );
}
