"use client";

import Link from "next/link";
import { useMemo } from "react";
import { getSegment } from "@/lib/segments";
import type { PlanTier } from "@/lib/plans";
import { effectiveFeePence, formatFeeGbp } from "@/lib/case/pricing";
import { companyNameFromAnswers } from "@/lib/case/company-label";
import { EmptyState } from "@/components/empty-state";
import { StatusPill } from "@/components/case/status-pill";
import { DeadlinePill } from "@/components/case/deadline-pill";
import { UrgentPill } from "@/components/case/urgent-pill";
import { useLiveList } from "@/lib/realtime-live-merge";
import {
  AdminCasesFilter,
  type AdminCaseView,
  type AdminCaseCounts,
} from "./cases-filter";
import { STALE_DRAFT_DAYS } from "@/app/admin/constants";
import { DeleteStaleDraftButton } from "./delete-stale-draft-button";
import type { ActionResult } from "@/lib/action-result";

export type Row = {
  id: string;
  segment: string;
  tier: string;
  status: string;
  stripe_payment_status: string;
  created_at: string;
  submitted_at: string | null;
  deadline: string | null;
  client_id: string;
  accountant_id: string | null;
  is_urgent: boolean;
  intake_answers: Record<string, string> | null;
  custom_fee_pence: number | null;
};

// Mirrors the server-side set so client partitioning matches the counts
// query. Kept in step with src/app/client/page.tsx:IN_PROGRESS plus
// 'filed' (admin treats a filed case as still in progress until the
// accountant marks it complete).
const IN_PROGRESS_STATUSES = new Set([
  "submitted",
  "in_review",
  "prepared",
  "client_approval",
  "filed",
]);

function rowFromPayload(r: Record<string, unknown>): Row {
  return {
    id: r.id as string,
    segment: (r.segment as string) ?? "",
    tier: (r.tier as string) ?? "",
    status: (r.status as string) ?? "",
    stripe_payment_status: (r.stripe_payment_status as string) ?? "",
    created_at: r.created_at as string,
    submitted_at: (r.submitted_at as string | null) ?? null,
    deadline: (r.deadline as string | null) ?? null,
    client_id: r.client_id as string,
    accountant_id: (r.accountant_id as string | null) ?? null,
    is_urgent: !!r.is_urgent,
    intake_answers: (r.intake_answers as Record<string, string> | null) ?? null,
    custom_fee_pence: (r.custom_fee_pence as number | null) ?? null,
  };
}

export function AdminDashboardLive({
  initial,
  initialCounts,
  view,
  callerIsPrimary,
  tierEntries,
  emailById,
  deleteStaleDraft,
}: {
  initial: Row[];
  initialCounts: AdminCaseCounts;
  view: AdminCaseView;
  callerIsPrimary: boolean;
  tierEntries: Array<[string, PlanTier]>;
  emailById: Record<string, string>;
  deleteStaleDraft: (id: string) => Promise<ActionResult>;
}) {
  const tierMap = useMemo(() => new Map(tierEntries), [tierEntries]);

  const all = useLiveList<Row>(initial, {
    table: "cases",
    channel: `admin-dash-cases`,
    map: (row) => rowFromPayload(row),
  });

  // Keep the dashboard capped at the same most-recent-N window the
  // server rendered. Live INSERTs land at the top (useLiveList
  // prepends by default), so a persistent dashboard that absorbs a
  // steady stream of new cases stays bounded.
  const DASHBOARD_LIMIT = 100;
  const capped = all.slice(0, DASHBOARD_LIMIT);

  // eslint-disable-next-line react-hooks/purity -- stale-draft cutoff ticks once per render, which is the whole point.
  const staleCutoffMs = Date.now() - STALE_DRAFT_DAYS * 24 * 60 * 60 * 1000;
  const isStaleDraft = (c: Row) =>
    c.status === "draft" &&
    c.stripe_payment_status !== "succeeded" &&
    new Date(c.created_at).getTime() < staleCutoffMs;

  const filteredCases = capped.filter((c) => {
    if (view === "all") return true;
    if (view === "in_progress") return IN_PROGRESS_STATUSES.has(c.status);
    if (view === "completed") return c.status === "complete";
    if (view === "pending") return c.status === "draft";
    if (view === "stale_drafts") return isStaleDraft(c);
    return true;
  });

  // Live counts: derived from the capped list so the number next to
  // each tab matches what the user sees. The server-rendered counts
  // (which hit COUNT(*) over the whole table) still back the stat
  // cards above; this bucket pill count is a live reflection of what's
  // in the capped window and is close enough for the at-a-glance tabs.
  const liveCounts: AdminCaseCounts = useMemo(() => ({
    all: Math.max(capped.length, initialCounts.all),
    in_progress: capped.filter((c) => IN_PROGRESS_STATUSES.has(c.status)).length,
    completed: capped.filter((c) => c.status === "complete").length,
    pending: capped.filter((c) => c.status === "draft").length,
    stale_drafts: capped.filter(isStaleDraft).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [capped, initialCounts.all]);

  const totalCases = initialCounts.all;

  return (
    <>
      <AdminCasesFilter active={view} counts={liveCounts} />
      {view === "stale_drafts" ? <StaleDraftIntro callerIsPrimary={callerIsPrimary} /> : null}
      {filteredCases.length === 0 ? (
        <EmptyState
          title={
            totalCases === 0
              ? "No cases yet."
              : view === "stale_drafts"
                ? "No stale drafts."
                : "Nothing to show in this view."
          }
          hint={
            totalCases === 0
              ? "Cases will appear here as clients submit them."
              : view === "stale_drafts"
                ? `Clients' draft cases that sit unpaid for more than ${STALE_DRAFT_DAYS} days will show up here.`
                : "Switch tabs above to see cases in other states."
          }
        />
      ) : view === "stale_drafts" ? (
        <ul className="grid gap-3">
          {filteredCases.map((c) => (
            <li key={c.id}>
              <StaleDraftRow
                c={c}
                tier={tierMap.get(c.tier) ?? null}
                clientEmail={emailById[c.client_id] ?? null}
                callerIsPrimary={callerIsPrimary}
                deleteCase={deleteStaleDraft}
              />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="grid gap-3">
          {filteredCases.map((c) => (
            <li key={c.id}>
              <CaseCard
                c={c}
                tier={tierMap.get(c.tier) ?? null}
                clientEmail={emailById[c.client_id] ?? null}
                accountantEmail={c.accountant_id ? emailById[c.accountant_id] ?? null : null}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function CaseCard({
  c, tier, clientEmail, accountantEmail,
}: {
  c: Row;
  tier: PlanTier | null;
  clientEmail: string | null;
  accountantEmail: string | null;
}) {
  const seg = getSegment(c.segment);
  const companyName = companyNameFromAnswers(c.intake_answers, c.segment);
  return (
    <Link
      href={`/admin/cases/${c.id}`}
      className="card-sl group flex items-center gap-4 p-5 transition hover:border-sky/40 hover:-translate-y-0.5"
    >
      <div
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white text-lg"
        style={{ background: "linear-gradient(135deg, var(--navy), var(--sky))" }}
        aria-hidden="true"
      >
        {seg?.numeral ?? "•"}
      </div>
      <div className="min-w-0 flex-1">
        {companyName ? (
          <div className="truncate text-sm font-semibold text-ink">{companyName}</div>
        ) : null}
        <div className={"flex flex-wrap items-center gap-2 " + (companyName ? "mt-0.5" : "")}>
          <span className={companyName ? "text-xs text-slate" : "text-sm font-semibold text-ink"}>
            {seg?.title ?? c.segment}
          </span>
          <span className="text-xs text-slate">·</span>
          <span className="text-xs text-slate">
            {tier?.title ?? c.tier} · {formatFeeGbp(effectiveFeePence(c, tier))}
          </span>
        </div>
        <div className="mt-1 text-xs text-slate">
          Client {clientEmail ?? "."}
          {c.accountant_id ? (
            <> {" "}· Accountant {accountantEmail ?? "."}</>
          ) : (
            " · Unassigned"
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <StatusPill status={c.status} />
        {c.is_urgent ? <UrgentPill size="sm" /> : null}
        {c.deadline ? <DeadlinePill deadline={c.deadline} size="sm" /> : null}
      </div>
    </Link>
  );
}

function StaleDraftRow({
  c, tier, clientEmail, callerIsPrimary, deleteCase,
}: {
  c: Row;
  tier: PlanTier | null;
  clientEmail: string | null;
  callerIsPrimary: boolean;
  deleteCase: (id: string) => Promise<ActionResult>;
}) {
  const seg = getSegment(c.segment);
  const companyName = companyNameFromAnswers(c.intake_answers, c.segment);
  // eslint-disable-next-line react-hooks/purity -- age label is a per-render clock snapshot, same as its server-side predecessor.
  const ageDays = ((Date.now() - new Date(c.created_at).getTime()) / (1000 * 60 * 60 * 24)).toFixed(1);
  return (
    <div className="card-sl flex items-center gap-4 p-5">
      <div
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white text-lg"
        style={{ background: "linear-gradient(135deg, var(--navy), var(--sky))" }}
        aria-hidden="true"
      >
        {seg?.numeral ?? "•"}
      </div>
      <div className="min-w-0 flex-1">
        {companyName ? (
          <div className="truncate text-sm font-semibold text-ink">{companyName}</div>
        ) : null}
        <div className={"flex flex-wrap items-center gap-2 " + (companyName ? "mt-0.5" : "")}>
          <span className={companyName ? "text-xs text-slate" : "text-sm font-semibold text-ink"}>
            {seg?.title ?? c.segment}
          </span>
          <span className="text-xs text-slate">·</span>
          <span className="text-xs text-slate">
            {tier?.title ?? c.tier} · {formatFeeGbp(effectiveFeePence(c, tier))}
          </span>
        </div>
        <div className="mt-1 text-xs text-slate">
          Client {clientEmail ?? "."} ·{" "}
          <span className="text-ink">{ageDays} days old</span> ·{" "}
          <Link
            href={`/admin/cases/${c.id}`}
            className="font-semibold text-navy-deep underline underline-offset-4 hover:text-sky"
          >
            Open case
          </Link>
        </div>
      </div>
      {callerIsPrimary ? (
        <DeleteStaleDraftButton caseId={c.id} deleteCase={deleteCase} />
      ) : (
        <span
          className="text-[11px] italic text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Primary admin only
        </span>
      )}
    </div>
  );
}

function StaleDraftIntro({ callerIsPrimary }: { callerIsPrimary: boolean }) {
  return (
    <div
      className="mb-4 rounded-xl border px-4 py-3 text-xs"
      style={{
        background: "rgba(217,159,25,0.08)",
        borderColor: "rgba(217,159,25,0.35)",
        color: "#8a5c05",
      }}
    >
      <strong className="font-semibold">Stale drafts</strong>: cases started
      more than {STALE_DRAFT_DAYS} days ago that never completed payment.
      {callerIsPrimary ? (
        <>
          {" "}
          You can permanently delete these. Deleting removes the case row
          plus any documents uploaded against it, logged to the audit
          trail.
        </>
      ) : (
        <>
          {" "}
          Only the primary admin can delete these; everyone else sees them
          here for visibility.
        </>
      )}
    </div>
  );
}
