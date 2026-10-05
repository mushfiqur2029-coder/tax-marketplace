import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  updateAdminProfileAction,
  changePasswordAction,
} from "@/app/profile-actions";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { ChangePasswordForm } from "@/components/change-password-form";
import { AdminProfileForm } from "./admin-profile-form";

export const dynamic = "force-dynamic";

export default async function AdminAccountPage() {
  const me = await requireRole("admin");
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("admin_profiles")
    .select("name, contact_number, avatar_path")
    .eq("user_id", me.id)
    .maybeSingle();

  const submit = async (
    edit: Parameters<typeof updateAdminProfileAction>[0],
    avatar: File | null,
  ) => {
    "use server";
    return updateAdminProfileAction(edit, avatar);
  };

  const change = async (current: string, next: string, confirm: string) => {
    "use server";
    return changePasswordAction(current, next, confirm);
  };

  return (
    <>
      <AdminPageHeader
        eyebrow="Account settings"
        title="Your account"
        description="Update your details or change your password."
      />
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
    </>
  );
}
