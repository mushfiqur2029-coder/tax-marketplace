import { requireApprovedAccountant } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { submitAccountantProfileChangeAction } from "@/app/profile-actions";
import { DashboardShell } from "@/components/dashboard-shell";
import { AccountantNav } from "@/app/accountant/accountant-nav";
import { AccountantProfileForm } from "./accountant-profile-form";

export const dynamic = "force-dynamic";

export default async function AccountantProfilePage() {
  const me = await requireApprovedAccountant();
  const admin = createAdminClient();

  const [{ data: profile }, { data: pending }] = await Promise.all([
    admin
      .from("accountant_profiles")
      .select("name, contact_number, company_name, company_email")
      .eq("user_id", me.id)
      .single(),
    admin
      .from("pending_profile_changes")
      .select("id, proposed, requested_at, status")
      .eq("user_id", me.id)
      .eq("status", "pending")
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const submit = async (edit: Parameters<typeof submitAccountantProfileChangeAction>[0]) => {
    "use server";
    await submitAccountantProfileChangeAction(edit);
  };

  return (
    <DashboardShell
      eyebrow="Your profile"
      title="Professional details"
      description="Edits go to Sterling Ledger admins for review, they take effect once approved."
      name={me.name}
      email={me.email}
      role={me.role}
      subnav={<AccountantNav active="profile" />}
    >
      <AccountantProfileForm
        current={{
          name: profile?.name ?? "",
          contact_number: profile?.contact_number ?? "",
          email: me.email,
          company_name: profile?.company_name ?? "",
          company_email: profile?.company_email ?? "",
        }}
        pending={pending ? (pending.proposed as Record<string, string>) : null}
        submit={submit}
      />
    </DashboardShell>
  );
}
