import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { Bell } from "@/components/bell";
import { ClientShell } from "./client-shell";

// Nested layout for /client/**. Hosts the shared portal shell (sidebar +
// mobile drawer + identity footer) so every signed-in client page sits
// inside the same chrome and the sidebar doesn't re-render on navigation.
//
// Pages themselves emit <PortalPageHeader> + content directly instead of
// the retired <DashboardShell>.
export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await requireRole("client");
  // Avatar for the sidebar identity footer. Client profiles always
  // exist (registration seeds the row), but guard anyway so the shell
  // doesn't crash on a half-provisioned account.
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("client_profiles")
    .select("avatar_path")
    .eq("user_id", me.id)
    .maybeSingle<{ avatar_path: string | null }>();

  return (
    <ClientShell
      me={{
        id: me.id,
        name: me.name ?? null,
        email: me.email,
        role: me.role,
        avatarPath: profile?.avatar_path ?? null,
      }}
      bell={<Bell userId={me.id} role={me.role} />}
    >
      {/* No layout-level RealtimeRefresh yet — no sidebar badges.
          Per-page RealtimeRefresh handles each page's own refreshes.
          Add a layout-level subscription here when client-nav badges
          land. */}
      {children}
    </ClientShell>
  );
}
