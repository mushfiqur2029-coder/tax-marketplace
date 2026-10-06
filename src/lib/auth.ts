import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type Role = "client" | "accountant" | "admin";
export type AccountantApproval = "pending" | "approved" | "rejected";

// The permanent primary admin. Can never be deleted, demoted, or have
// their email changed, by anyone (including themselves). Enforced in
// three places that MUST stay in sync:
//   1. Server actions that touch admin accounts check isPrimaryAdmin()
//      and refuse.
//   2. Only this account can call removeAdminAction.
//   3. A BEFORE UPDATE/DELETE trigger on public.users (migration 0056,
//      public.protect_primary_admin) hardcodes the same email as a
//      final defense against direct SQL / service-role manipulation.
// If the email ever needs to change, update it here AND in the
// trigger body in a single migration — one without the other opens a
// bypass window.
export const PRIMARY_ADMIN_EMAIL = "ritzbd.com@gmail.com";

export function isPrimaryAdmin(user: {
  email: string;
  role: string;
}): boolean {
  return user.role === "admin" && user.email.toLowerCase() === PRIMARY_ADMIN_EMAIL;
}

export type CurrentUser = {
  id: string;
  email: string;
  role: Role;
  status: "active" | "warned" | "suspended";
  name?: string | null;                 // fetched from role-specific profile
  approvalStatus?: AccountantApproval;  // only populated for accountants
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userRow } = await supabase
    .from("users")
    .select("id, email, role, status")
    .eq("id", user.id)
    .single();

  if (!userRow) return null;

  const me: CurrentUser = {
    id: userRow.id,
    email: userRow.email,
    role: userRow.role as Role,
    status: userRow.status,
  };

  // Fetch role-specific profile to get the display name (and, for accountants,
  // the approval status). Use the admin client so this doesn't depend on any
  // specific RLS path.
  const admin = createAdminClient();
  if (me.role === "accountant") {
    const { data: prof } = await admin
      .from("accountant_profiles")
      .select("name, approval_status")
      .eq("user_id", me.id)
      .single();
    me.name = prof?.name ?? null;
    me.approvalStatus = (prof?.approval_status ?? "pending") as AccountantApproval;
  } else if (me.role === "client") {
    const { data: prof } = await admin
      .from("client_profiles")
      .select("name")
      .eq("user_id", me.id)
      .single();
    me.name = prof?.name ?? null;
  } else if (me.role === "admin") {
    const { data: prof } = await admin
      .from("admin_profiles")
      .select("name")
      .eq("user_id", me.id)
      .maybeSingle();
    me.name = prof?.name ?? null;
  }

  return me;
}

export async function requireRole(expected: Role) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== expected) redirect(`/${me.role}`);
  return me;
}

// Any accountant page that shows queue / cases / wallet requires an approved
// accountant. Pending or rejected accountants get bounced to /accountant/pending.
export async function requireApprovedAccountant() {
  const me = await requireRole("accountant");
  if (me.approvalStatus !== "approved") {
    redirect("/accountant/pending");
  }
  return me;
}
