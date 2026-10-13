import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

// Audit view for the Reveal action on withdrawal_requests. Each row in
// admin_actions with action='withdrawal_bank_revealed' is one admin
// clicking "Reveal full number" on a request's bank details. This page
// is intentionally minimal: a reverse-chronological list showing who
// looked, whose details they looked at, and the note the action wrote
// (which embeds the withdrawal_request id + amount).
export default async function WithdrawalRevealsPage() {
  await requireRole("admin");
  const admin = createAdminClient();

  const { data: rows } = await admin
    .from("admin_actions")
    .select("id, admin_id, target_user_id, note, created_at")
    .eq("action", "withdrawal_bank_revealed")
    .order("created_at", { ascending: false })
    .limit(200);

  const userIds = Array.from(
    new Set(
      (rows ?? []).flatMap((r) => [r.admin_id, r.target_user_id]),
    ),
  );
  const { data: users } = userIds.length
    ? await admin.from("users").select("id, email, name").in("id", userIds)
    : { data: [] as { id: string; email: string; name: string | null }[] };
  const userById = new Map(
    (users ?? []).map((u) => [u.id, { email: u.email, name: u.name }]),
  );

  const list = rows ?? [];

  return (
    <>
      <AdminPageHeader
        eyebrow="Admin console"
        title="Reveal audit"
        description="Every time an admin reveals a withdrawal request's full bank details, we log who, when, and which request. 200 most recent rows."
      />

      <div className="mb-6 text-sm">
        <Link
          href="/admin/withdrawals"
          className="font-semibold text-navy-deep underline underline-offset-4 hover:text-sky"
        >
          ← Back to withdrawals
        </Link>
      </div>

      {list.length === 0 ? (
        <p className="card-sl border-dashed p-6 text-center text-sm text-slate">
          No reveal events logged yet.
        </p>
      ) : (
        <ul className="grid gap-3">
          {list.map((r) => {
            const actor = userById.get(r.admin_id);
            const target = userById.get(r.target_user_id);
            return (
              <li key={r.id} className="card-sl p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm text-slate">
                      <span className="font-semibold text-ink">
                        {actor?.name || actor?.email || r.admin_id}
                      </span>
                      {" revealed "}
                      <span className="font-semibold text-ink">
                        {target?.name || target?.email || r.target_user_id}
                      </span>
                      {"'s bank details"}
                    </div>
                    {r.note ? (
                      <p
                        className="mt-2 text-xs text-slate"
                        style={{ fontFamily: "var(--font-mono)" }}
                      >
                        {r.note}
                      </p>
                    ) : null}
                  </div>
                  <div
                    className="shrink-0 text-right text-[11px] uppercase tracking-wider text-slate"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {formatDateTime(r.created_at)}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
