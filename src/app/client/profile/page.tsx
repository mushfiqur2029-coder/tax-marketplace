import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { submitClientProfileChangeAction } from "@/app/profile-actions";
import { DashboardShell } from "@/components/dashboard-shell";
import { ClientNav } from "@/app/client/client-nav";
import { ClientProfileForm } from "./client-profile-form";

export const dynamic = "force-dynamic";

export default async function ClientProfilePage() {
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

  const submit = async (edit: Parameters<typeof submitClientProfileChangeAction>[0]) => {
    "use server";
    await submitClientProfileChangeAction(edit);
  };

  return (
    <DashboardShell
      eyebrow="Your profile"
      title="Personal details"
      description="Edits go to Sterling Ledger admins for review, they take effect once approved."
      name={me.name}
      email={me.email}
      role={me.role}
      subnav={<ClientNav active="profile" />}
    >
      <ClientProfileForm
        current={{
          name: profile?.name ?? "",
          contact_number: profile?.contact_number ?? "",
          email: me.email,
          address: profile?.address ?? "",
        }}
        pending={pending ? (pending.proposed as Record<string, string>) : null}
        submit={submit}
      />
    </DashboardShell>
  );
}
