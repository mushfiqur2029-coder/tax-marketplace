import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  approveProfileChangeAction,
  rejectProfileChangeAction,
} from "@/app/profile-actions";
import { DashboardShell } from "@/components/dashboard-shell";
import { formatDateTime } from "@/lib/format";
import { ReviewActions } from "./review-actions";
import { Avatar } from "@/components/avatar";
import { AdminNav } from "@/app/admin/admin-nav";
import { getAdminNavCounts } from "@/app/admin/admin-counts";
import { Bell } from "@/components/bell";

export const dynamic = "force-dynamic";

export default async function AdminProfileChangesPage() {
  const me = await requireRole("admin");
  const admin = createAdminClient();

  const [{ data: changes }, navCounts] = await Promise.all([
    admin
      .from("pending_profile_changes")
      .select(
        "id, user_id, role, proposed, status, requested_at, reviewed_at, review_note",
      )
      .order("requested_at", { ascending: false }),
    getAdminNavCounts(),
  ]);

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
    <DashboardShell
      eyebrow="Admin console"
      title="Profile change requests"
      description="Client and accountant edits require review before they apply to live profiles."
      name={me.name}
      email={me.email}
      role={me.role}
      subnav={<AdminNav active="profile-changes" counts={navCounts} />}
      bell={<Bell userId={me.id} role={me.role} />}
    >
      <section className="mb-10">
        <h2
          className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Pending ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="card-sl border-dashed p-6 text-center text-sm text-slate">
            No pending changes.
          </p>
        ) : (
          <ul className="grid gap-3">
            {pending.map((c) => {
              const proposed = c.proposed as Record<string, string>;
              return (
                <li key={c.id} className="card-sl p-5">
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold text-ink">
                      {emailById.get(c.user_id) ?? c.user_id}
                    </span>
                    <span
                      className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                      style={{
                        background: "rgba(15,30,77,0.08)",
                        color: "var(--navy-deep)",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      {c.role}
                    </span>
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
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2
          className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Reviewed ({reviewed.length})
        </h2>
        {reviewed.length === 0 ? (
          <p className="card-sl border-dashed p-6 text-center text-sm text-slate">
            No reviewed changes yet.
          </p>
        ) : (
          <ul className="grid gap-2">
            {reviewed.slice(0, 20).map((c) => (
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
                    {c.review_note ? <> · "{c.review_note}"</> : null}
                  </div>
                </div>
                <span
                  className="rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider"
                  style={{
                    background:
                      c.status === "approved"
                        ? "rgba(19,217,160,0.14)"
                        : "rgba(220,38,38,0.12)",
                    color: c.status === "approved" ? "#0E9E77" : "#B91C1C",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {c.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

    </DashboardShell>
  );
}
