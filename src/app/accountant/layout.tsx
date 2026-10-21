import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { Bell } from "@/components/bell";
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
      {/* Sidebar queue / mine badge counts are rendered server-side via
          getAccountantNavCounts and refresh on every navigation; live-
          merging the counts would require a client wrapper over
          AccountantShell. Accountant navigation is already route-heavy
          (open case → work → back to list), so stale-until-next-click
          is a reasonable tradeoff. */}
      {children}
    </AccountantShell>
  );
}
