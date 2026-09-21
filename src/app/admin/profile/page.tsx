import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  updateAdminProfileAction,
  changePasswordAction,
} from "@/app/profile-actions";
import { DashboardShell } from "@/components/dashboard-shell";
import { ChangePasswordForm } from "@/components/change-password-form";
import { AdminProfileForm } from "./admin-profile-form";

export const dynamic = "force-dynamic";

export default async function AdminAccountPage() {
  const me = await requireRole("admin");
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("admin_profiles")
    .select("name, contact_number")
    .eq("user_id", me.id)
    .maybeSingle();

  const submit = async (edit: Parameters<typeof updateAdminProfileAction>[0]) => {
    "use server";
    await updateAdminProfileAction(edit);
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
          submit={submit}
        />
      </section>

      <section className="mb-10">
        <h2
          className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Change password
        </h2>
        <ChangePasswordForm change={change} />
      </section>

      <Link
        href="/admin"
        className="text-sm font-semibold text-navy-deep underline underline-offset-4 hover:text-sky"
      >
        ← Back to admin console
      </Link>
    </DashboardShell>
  );
}
