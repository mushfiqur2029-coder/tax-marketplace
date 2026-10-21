import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  approveAddonAction,
  rejectAddonAction,
} from "@/app/admin/actions";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import {
  AdminAddonRequestsLive,
  type AddonRow,
} from "./admin-addon-requests-live";

export const dynamic = "force-dynamic";

export default async function AdminAddonRequestsPage() {
  await requireRole("admin");
  const admin = createAdminClient();

  // Only custom add-ons ever enter admin review. Presets go straight to
  // pending_payment at insert. Include reviewed rows in a second section
  // so admins can see history + the reviewer's note.
  const { data: rows } = await admin
    .from("case_addons")
    .select(
      "id, case_id, accountant_id, kind, description, amount_pence, status, review_note, created_at, reviewed_at, reviewed_by",
    )
    .eq("kind", "custom")
    .order("created_at", { ascending: false });

  const all = (rows ?? []) as AddonRow[];

  // Fetch accountant emails so the queue is readable at a glance.
  const accountantIds = Array.from(
    new Set(all.map((r) => r.accountant_id).filter(Boolean)),
  );
  const { data: accountants } = accountantIds.length
    ? await admin.from("users").select("id, email").in("id", accountantIds)
    : { data: [] as { id: string; email: string }[] };
  const accEmail: Record<string, string> = Object.fromEntries(
    (accountants ?? []).map((a) => [a.id, a.email as string]),
  );

  const approve = async (id: string, note: string | null) => {
    "use server";
    return approveAddonAction(id, note);
  };
  const reject = async (id: string, note: string | null) => {
    "use server";
    return rejectAddonAction(id, note);
  };

  return (
    <>
      <AdminPageHeader
        eyebrow="Admin console"
        title="Add-on requests"
        description="Custom add-ons that need approval before the client sees them. Preset add-ons skip review and go straight to the client."
      />
      <AdminAddonRequestsLive
        initial={all}
        accEmail={accEmail}
        approve={approve}
        reject={reject}
      />
    </>
  );
}
