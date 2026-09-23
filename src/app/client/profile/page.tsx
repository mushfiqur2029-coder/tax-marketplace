import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  submitClientProfileChangeAction,
  changePasswordAction,
} from "@/app/profile-actions";
import { DashboardShell } from "@/components/dashboard-shell";
import { Bell } from "@/components/bell";
import { ClientSuspensionBanner } from "@/app/client/suspension-banner";
import { ClientNav } from "@/app/client/client-nav";
import { ClientProfileForm } from "./client-profile-form";
import { ChangePasswordForm } from "@/components/change-password-form";

export const dynamic = "force-dynamic";

export default async function ClientAccountPage() {
  const me = await requireRole("client");
  const admin = createAdminClient();

  const [{ data: profile }, { data: pending }] = await Promise.all([
    admin
      .from("client_profiles")
      .select("name, contact_number, address, avatar_path")
      .eq("user_id", me.id)
      .single(),
    admin
      .from("pending_profile_changes")
      .select("id, proposed, requested_at, status, review_note")
      .eq("user_id", me.id)
      .eq("status", "pending")
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const submit = async (
    edit: Parameters<typeof submitClientProfileChangeAction>[0],
    avatar: File | null,
  ) => {
    "use server";
    return submitClientProfileChangeAction(edit, avatar);
  };

  const change = async (current: string, next: string, confirm: string) => {
    "use server";
    return changePasswordAction(current, next, confirm);
  };

  return (
    <DashboardShell
      eyebrow="Account settings"
      title="Your account"
      description="Update your personal details or change your password."
      name={me.name}
      email={me.email}
      role={me.role}
      subnav={<ClientNav active="profile" />}
      bell={<Bell userId={me.id} role={me.role} />}
    >
      <ClientSuspensionBanner />
      <section className="mb-10">
        <h2
          className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Personal details
        </h2>
        <p className="mb-4 max-w-2xl text-sm text-slate">
          Edits go to Sterling Ledger admins for review and take effect once
          approved.
        </p>
        <ClientProfileForm
          current={{
            name: profile?.name ?? "",
            contact_number: profile?.contact_number ?? "",
            email: me.email,
            address: profile?.address ?? "",
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
