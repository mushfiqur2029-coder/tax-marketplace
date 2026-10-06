import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { Bell } from "@/components/bell";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { AccountantShell } from "./accountant-shell";
import { getAccountantNavCounts } from "./accountant-counts";

// Nested layout for /accountant/**. Hosts the shared portal shell
// (sidebar + mobile drawer + identity footer) so every signed-in
// accountant page sits inside the same chrome.
//
// Pages themselves emit <PortalPageHeader> + content directly instead
// of the retired <DashboardShell>.
//
// Note: this layout uses requireRole (not requireApprovedAccountant)
// so the /accountant/pending page can still render for pending signups.
// Approved-only pages re-gate inside their own page component.
export default async function AccountantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await requireRole("accountant");
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("accountant_profiles")
    .select("avatar_path")
    .eq("user_id", me.id)
    .maybeSingle<{ avatar_path: string | null }>();

  // Only fetch counts for approved accountants; pending accountants
  // see "Available cases" with no badge anyway.
  const counts =
    me.approvalStatus === "approved"
      ? await getAccountantNavCounts(me.id)
      : { queue: 0, mine: 0 };

  return (
    <AccountantShell
      counts={counts}
      me={{
        id: me.id,
        name: me.name ?? null,
        email: me.email,
        role: me.role,
        avatarPath: profile?.avatar_path ?? null,
      }}
      bell={<Bell userId={me.id} role={me.role} />}
    >
      {/* Layout-level subscription keeps the sidebar queue / mine
          badges fresh when other accountants take cases or the user's
          own case progresses. Filtered subscriptions wouldn't help
          here — any cases change may flip either count. */}
      <RealtimeRefresh
        channel={`accountant-layout-${me.id}`}
        subscriptions={[{ table: "cases" }]}
      />
      {children}
    </AccountantShell>
  );
}
