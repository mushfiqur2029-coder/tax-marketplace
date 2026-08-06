import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type Role = "client" | "accountant" | "admin";
export type AccountantApproval = "pending" | "approved" | "rejected";

export type CurrentUser = {
  id: string;
  email: string;
  role: Role;
  status: "active" | "warned" | "suspended";
  approvalStatus?: AccountantApproval; // only populated for accountants
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

  if (me.role === "accountant") {
    // Use admin client so we don't depend on any specific RLS policy path.
    const admin = createAdminClient();
    const { data: prof } = await admin
      .from("accountant_profiles")
      .select("approval_status")
      .eq("user_id", me.id)
      .single();
    me.approvalStatus = (prof?.approval_status ?? "pending") as AccountantApproval;
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
