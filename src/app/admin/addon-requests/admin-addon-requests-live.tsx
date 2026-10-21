"use client";

import Link from "next/link";
import { useMemo } from "react";
import { AdminSearchFilter } from "@/components/admin/admin-search-filter";
import { AdminPill, type AdminPillTone } from "@/components/admin/admin-pill";
import { ReviewActions } from "@/app/admin/profile-changes/review-actions";
import { formatDateTime } from "@/lib/format";
import { useLiveList } from "@/lib/realtime-live-merge";
import type { ActionResult } from "@/lib/action-result";

export type AddonRow = {
  id: string;
  case_id: string;
  accountant_id: string;
  kind: string;
  description: string;
  amount_pence: number;
  status: string;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
};

const money = (pence: number) => `£${(pence / 100).toFixed(2)}`;

export function AdminAddonRequestsLive({
  initial,
  accEmail,
  approve,
  reject,
}: {
  initial: AddonRow[];
  accEmail: Record<string, string>;
  approve: (id: string, note: string | null) => Promise<ActionResult>;
  reject: (id: string, note: string | null) => Promise<ActionResult>;
}) {
  const rowsAll = useLiveList<AddonRow>(initial, {
    table: "case_addons",
    channel: "admin-addon-requests-live",
    map: (row) => ({
      id: row.id as string,
      case_id: row.case_id as string,
      accountant_id: row.accountant_id as string,
      kind: row.kind as string,
      description: row.description as string,
      amount_pence: Number(row.amount_pence ?? 0),
      status: row.status as string,
      review_note: (row.review_note as string | null) ?? null,
      created_at: row.created_at as string,
      reviewed_at: (row.reviewed_at as string | null) ?? null,
      reviewed_by: (row.reviewed_by as string | null) ?? null,
    }),
  });

  const groups = useMemo(() => {
    // Admin only cares about custom addons (preset ones skip review).
    const rows = rowsAll.filter((r) => r.kind === "custom");
    const pending = rows.filter((r) => r.status === "pending_admin");
    const reviewed = rows.filter((r) => r.status !== "pending_admin");
    return [
      {
        key: "pending",
        title: "Pending",
        emptyLine: "No pending add-on requests.",
        items: pending.map((r) => ({
          searchText: [accEmail[r.accountant_id], r.description]
            .filter(Boolean)
            .join(" "),
          node: (
            <li key={r.id} className="card-sl p-5">
              <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-ink">
                  {accEmail[r.accountant_id] ?? r.accountant_id}
                </span>
                <span
                  className="text-lg font-bold text-ink"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {money(r.amount_pence)}
                </span>
                <Link
                  href={`/admin/cases/${r.case_id}`}
                  className="text-xs font-semibold text-navy-deep underline underline-offset-4 hover:text-sky"
                >
                  View case
                </Link>
                <span className="ml-auto text-xs text-slate">
                  requested {formatDateTime(r.created_at)}
                </span>
              </div>
              <p className="rounded-lg border border-line bg-cloud/40 p-3 text-sm text-ink">
                {r.description}
              </p>
              <div className="mt-4">
                <ReviewActions id={r.id} approve={approve} reject={reject} />
              </div>
            </li>
          ),
        })),
      },
      {
        key: "reviewed",
        title: "Reviewed",
        emptyLine: "Nothing reviewed yet.",
        items: reviewed.slice(0, 30).map((r) => ({
          searchText: [accEmail[r.accountant_id], r.description]
            .filter(Boolean)
            .join(" "),
          node: (
            <li
              key={r.id}
              className="card-sl flex items-center justify-between gap-3 p-4 text-sm"
            >
              <div className="min-w-0">
                <div className="font-semibold text-ink">
                  {money(r.amount_pence)} {" "}
                  {accEmail[r.accountant_id] ?? r.accountant_id}
                </div>
                <div className="truncate text-xs text-slate">
                  {r.description}
                </div>
                <div className="text-[11px] text-slate">
                  reviewed{" "}
                  {r.reviewed_at ? formatDateTime(r.reviewed_at) : "."}
                  {r.review_note ? <> {" "}&ldquo;{r.review_note}&rdquo;</> : null}
                </div>
              </div>
              <StatusPill status={r.status} />
            </li>
          ),
        })),
      },
    ];
  }, [rowsAll, accEmail, approve, reject]);

  return (
    <AdminSearchFilter
      placeholder="Search by accountant email or description"
      ariaLabel="Search add-on requests"
      groups={groups}
    />
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: AdminPillTone }> = {
    pending_payment: { label: "Approved", tone: "green" },
    paid: { label: "Paid", tone: "blue" },
    rejected: { label: "Rejected", tone: "red" },
  };
  const cfg = map[status] ?? { label: status, tone: "grey" as const };
  return <AdminPill tone={cfg.tone} label={cfg.label} />;
}
