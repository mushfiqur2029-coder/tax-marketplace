import { requireApprovedAccountant } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  submitAccountantProfileChangeAction,
  changePasswordAction,
} from "@/app/profile-actions";
import { DashboardShell } from "@/components/dashboard-shell";
import { Bell } from "@/components/bell";
import { AccountantNav } from "@/app/accountant/accountant-nav";
import { AccountantProfileForm } from "./accountant-profile-form";
import { ChangePasswordForm } from "@/components/change-password-form";

export const dynamic = "force-dynamic";

export default async function AccountantAccountPage() {
  const me = await requireApprovedAccountant();
  const admin = createAdminClient();

  const [{ data: profile }, { data: pending }] = await Promise.all([
    admin
      .from("accountant_profiles")
      .select("name, contact_number, company_name, company_email, avatar_path")
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

  const submit = async (
    edit: Parameters<typeof submitAccountantProfileChangeAction>[0],
    avatar: File | null,
  ) => {
    "use server";
    await submitAccountantProfileChangeAction(edit, avatar);
  };

  const change = async (current: string, next: string, confirm: string) => {
    "use server";
    return changePasswordAction(current, next, confirm);
  };

  return (
    <DashboardShell
      eyebrow="Account settings"
      title="Your account"
      description="Update your professional details or change your password."
      name={me.name}
      email={me.email}
      role={me.role}
      subnav={<AccountantNav active="profile" />}
      bell={<Bell userId={me.id} role={me.role} />}
    >
      <section className="mb-10">
        <h2
          className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Professional details
        </h2>
        <p className="mb-4 max-w-2xl text-sm text-slate">
          Edits go to Sterling Ledger admins for review and take effect once
          approved.
        </p>
        <AccountantProfileForm
          current={{
            name: profile?.name ?? "",
            contact_number: profile?.contact_number ?? "",
            email: me.email,
            company_name: profile?.company_name ?? "",
            company_email: profile?.company_email ?? "",
          }}
          currentAvatarPath={profile?.avatar_path ?? null}
          pending={pending ? (pending.proposed as Record<string, string>) : null}
          submit={submit}
        />
      </section>

      <section>
        <h2
          className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Change password
        </h2>
        <ChangePasswordForm change={change} />
      </section>
    </DashboardShell>
  );
}
