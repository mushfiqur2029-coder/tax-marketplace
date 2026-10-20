import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  approveProfileChangeAction,
  rejectProfileChangeAction,
} from "@/app/profile-actions";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminSearchFilter } from "@/components/admin/admin-search-filter";
import { AdminPill } from "@/components/admin/admin-pill";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { formatDateTime } from "@/lib/format";
import { ReviewActions } from "./review-actions";
import { Avatar } from "@/components/avatar";

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
  const emailById = new Map((users ?? []).map((u) => [u.id, u.email]));

  const approve = async (id: string, note: string | null) => {
    "use server";
    return approveProfileChangeAction(id, note);
  };
  const reject = async (id: string, note: string | null) => {
    "use server";
    return rejectProfileChangeAction(id, note);
  };

  const pending = (changes ?? []).filter((c) => c.status === "pending");
  const reviewed = (changes ?? []).filter((c) => c.status !== "pending");

  return (
    <>
      <RealtimeRefresh
        channel="admin-profile-changes"
        subscriptions={[{ table: "pending_profile_changes" }]}
      />
      <AdminPageHeader
        eyebrow="Admin console"
        title="Profile change requests"
        description="Client and accountant edits require review before they apply to live profiles."
      />
      <AdminSearchFilter
        placeholder="Search by email or role"
        ariaLabel="Search profile change requests"
        groups={[
          {
            key: "pending",
            title: "Pending",
            emptyLine: "No pending changes.",
            items: pending.map((c) => {
              const proposed = c.proposed as Record<string, string>;
              return {
                searchText: [emailById.get(c.user_id), c.role]
                  .filter(Boolean)
                  .join(" "),
                node: (
                  <li key={c.id} className="card-sl p-5">
                    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-semibold text-ink">
                        {emailById.get(c.user_id) ?? c.user_id}
                      </span>
                      <AdminPill tone="grey" label={c.role} />
                      <span className="text-xs text-slate">
                        requested {formatDateTime(c.requested_at)}
                      </span>
                    </div>
                    <dl className="grid gap-2 text-sm sm:grid-cols-2">
                      {Object.entries(proposed).map(([k, v]) => (
                        <div key={k} className="rounded-lg border border-line bg-cloud/40 p-3">
                          <dt
                            className="text-[10px] font-semibold uppercase tracking-wider text-slate"
                            style={{ fontFamily: "var(--font-mono)" }}
                          >
                            {k.replace(/_/g, " ")}
                          </dt>
                          <dd className="mt-1 text-ink">
                            {k === "avatar_path" && v ? (
                              <Avatar path={String(v)} size={56} />
                            ) : String(v) ? (
                              String(v)
                            ) : (
                              <span className="italic text-slate">(empty)</span>
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <div className="mt-4">
                      <ReviewActions id={c.id} approve={approve} reject={reject} />
                    </div>
                  </li>
                ),
              };
            }),
          },
          {
            key: "reviewed",
            title: "Reviewed",
            emptyLine: "No reviewed changes yet.",
            items: reviewed.slice(0, 20).map((c) => ({
              searchText: [emailById.get(c.user_id), c.role]
                .filter(Boolean)
                .join(" "),
              node: (
                <li
                  key={c.id}
                  className="card-sl flex items-center justify-between p-4 text-sm"
                >
                  <div>
                    <div className="font-semibold text-ink">
                      {emailById.get(c.user_id) ?? c.user_id}
                    </div>
                    <div className="text-xs text-slate">
                      {c.role} · reviewed{" "}
                      {c.reviewed_at ? formatDateTime(c.reviewed_at) : "."}
                      {c.review_note ? <> · &ldquo;{c.review_note}&rdquo;</> : null}
                    </div>
                  </div>
                  <AdminPill
                    tone={c.status === "approved" ? "green" : "red"}
                    label={c.status}
                  />
                </li>
              ),
            })),
          },
        ]}
      />
    </>
  );
}
