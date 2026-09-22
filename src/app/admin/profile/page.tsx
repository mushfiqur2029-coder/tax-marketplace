import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  updateAdminProfileAction,
  changePasswordAction,
} from "@/app/profile-actions";
import { DashboardShell } from "@/components/dashboard-shell";
import { ChangePasswordForm } from "@/components/change-password-form";
import { AdminProfileForm } from "./admin-profile-form";
import { AdminNav } from "@/app/admin/admin-nav";
import { getAdminNavCounts } from "@/app/admin/admin-counts";
import { Bell } from "@/components/bell";

export const dynamic = "force-dynamic";

export default async function AdminAccountPage() {
  const me = await requireRole("admin");
  const admin = createAdminClient();

  const [{ data: profile }, navCounts] = await Promise.all([
    admin
      .from("admin_profiles")
      .select("name, contact_number, avatar_path")
      .eq("user_id", me.id)
      .maybeSingle(),
    getAdminNavCounts(),
  ]);

  const submit = async (
    edit: Parameters<typeof updateAdminProfileAction>[0],
    avatar: File | null,
  ) => {
    "use server";
    await updateAdminProfileAction(edit, avatar);
  };

  const change = async (current: string, next: string, confirm: string) => {
    "use server";
    return changePasswordAction(current, next, confirm);
  };

  return (
    <DashboardShell
      eyebrow="Account settings"
      title="Your account"
      description="Update your details or change your password."
      name={me.name}
      email={me.email}
      role={me.role}
      subnav={<AdminNav active="profile" counts={navCounts} />}
      bell={<Bell userId={me.id} role={me.role} />}
    >
      <section className="mb-10">
        <h2
          className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Personal details
        </h2>
        <AdminProfileForm
          current={{
            name: profile?.name ?? "",
            contact_number: profile?.contact_number ?? "",
            email: me.email,
          }}
          currentAvatarPath={profile?.avatar_path ?? null}
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
