import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  submitClientProfileChangeAction,
  changePasswordAction,
} from "@/app/profile-actions";
import { PortalPageHeader } from "@/components/portal-page-header";
import { ClientSuspensionBanner } from "@/app/client/suspension-banner";
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
    <>
      <PortalPageHeader
        eyebrow="Account settings"
        title="Your account"
        description="Update your personal details or change your password."
      />
      <ClientSuspensionBanner />
      {/* Admin approval of a pending profile change takes hours to days;
          an F5 or navigation back to this page is a better fit than a
          mounted realtime watcher that pays the connection cost just to
          surface a slow-loop flip. */}
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
    </>
  );
}
