"use client";

import { useMemo } from "react";
import { AdminSearchFilter } from "@/components/admin/admin-search-filter";
import { AdminPill } from "@/components/admin/admin-pill";
import { Avatar } from "@/components/avatar";
import { formatDateTime } from "@/lib/format";
import { useLiveList } from "@/lib/realtime-live-merge";
import type { ActionResult } from "@/lib/action-result";
import { ReviewActions } from "./review-actions";

export type ProfileChangeRow = {
  id: string;
  user_id: string;
  role: string;
  proposed: Record<string, string>;
  status: string;
  requested_at: string;
  reviewed_at: string | null;
  review_note: string | null;
};

export function AdminProfileChangesLive({
  initial,
  emailById,
  approve,
  reject,
}: {
  initial: ProfileChangeRow[];
  emailById: Record<string, string>;
  approve: (id: string, note: string | null) => Promise<ActionResult>;
  reject: (id: string, note: string | null) => Promise<ActionResult>;
}) {
  const rows = useLiveList<ProfileChangeRow>(initial, {
    table: "pending_profile_changes",
    channel: "admin-profile-changes-live",
    map: (row) => ({
      id: row.id as string,
      user_id: row.user_id as string,
      role: row.role as string,
      proposed: (row.proposed as Record<string, string>) ?? {},
      status: row.status as string,
      requested_at: row.requested_at as string,
      reviewed_at: (row.reviewed_at as string | null) ?? null,
      review_note: (row.review_note as string | null) ?? null,
    }),
  });

  const groups = useMemo(() => {
    const pending = rows.filter((r) => r.status === "pending");
    const reviewed = rows.filter((r) => r.status !== "pending");
    return [
      {
        key: "pending",
        title: "Pending",
        emptyLine: "No pending changes.",
        items: pending.map((c) => ({
          searchText: [emailById[c.user_id], c.role].filter(Boolean).join(" "),
          node: (
            <li key={c.id} className="card-sl p-5">
              <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-ink">
                  {emailById[c.user_id] ?? c.user_id}
                </span>
                <AdminPill tone="grey" label={c.role} />
                <span className="text-xs text-slate">
                  requested {formatDateTime(c.requested_at)}
                </span>
              </div>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                {Object.entries(c.proposed).map(([k, v]) => (
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
        })),
      },
      {
        key: "reviewed",
        title: "Reviewed",
        emptyLine: "No reviewed changes yet.",
        items: reviewed.slice(0, 20).map((c) => ({
          searchText: [emailById[c.user_id], c.role].filter(Boolean).join(" "),
          node: (
            <li
              key={c.id}
              className="card-sl flex items-center justify-between p-4 text-sm"
            >
              <div>
                <div className="font-semibold text-ink">
                  {emailById[c.user_id] ?? c.user_id}
                </div>
                <div className="text-xs text-slate">
                  {c.role} reviewed{" "}
                  {c.reviewed_at ? formatDateTime(c.reviewed_at) : "."}
                  {c.review_note ? <> {" "}&ldquo;{c.review_note}&rdquo;</> : null}
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
    ];
  }, [rows, emailById, approve, reject]);

  return (
    <AdminSearchFilter
      placeholder="Search by email or role"
      ariaLabel="Search profile change requests"
      groups={groups}
    />
  );
}
