import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  approveProfileChangeAction,
  rejectProfileChangeAction,
} from "@/app/profile-actions";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import {
  AdminProfileChangesLive,
  type ProfileChangeRow,
} from "./admin-profile-changes-live";

export const dynamic = "force-dynamic";

export default async function AdminProfileChangesPage() {
  await requireRole("admin");
  const admin = createAdminClient();

  const { data: changes } = await admin
    .from("pending_profile_changes")
    .select(
      "id, user_id, role, proposed, status, requested_at, reviewed_at, review_note",
    )
    .order("requested_at", { ascending: false });

  const userIds = Array.from(new Set((changes ?? []).map((c) => c.user_id)));
  const { data: users } = userIds.length
    ? await admin.from("users").select("id, email").in("id", userIds)
    : { data: [] as { id: string; email: string }[] };
  const emailById: Record<string, string> = Object.fromEntries(
    (users ?? []).map((u) => [u.id, u.email as string]),
  );

  const approve = async (id: string, note: string | null) => {
    "use server";
    return approveProfileChangeAction(id, note);
  };
  const reject = async (id: string, note: string | null) => {
    "use server";
    return rejectProfileChangeAction(id, note);
  };

  const initial: ProfileChangeRow[] = (changes ?? []).map((c) => ({
    id: c.id as string,
    user_id: c.user_id as string,
    role: c.role as string,
    proposed: (c.proposed as Record<string, string>) ?? {},
    status: c.status as string,
    requested_at: c.requested_at as string,
    reviewed_at: (c.reviewed_at as string | null) ?? null,
    review_note: (c.review_note as string | null) ?? null,
  }));

  return (
    <>
      <AdminPageHeader
        eyebrow="Admin console"
        title="Profile change requests"
        description="Client and accountant edits require review before they apply to live profiles."
      />
      <AdminProfileChangesLive
        initial={initial}
        emailById={emailById}
        approve={approve}
        reject={reject}
      />
    </>
  );
}
