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
import { formatDate, formatDateTime } from "@/lib/format";
import { deadlinesForYear } from "@/lib/tax-engine";
import { useLiveList } from "@/lib/realtime-live-merge";
import {
  AccountantCasesFilter,
  type CasesView,
  type UrgencyFilter,
  type FeeFilter,
  type DateFilter,
  type ViewCounts,
} from "./cases-filter";

export type Row = {
  id: string;
  segment: string;
  tier: string;
  status: string;
  stripe_payment_status: string;
  submitted_at: string | null;
  created_at: string;
  accountant_id: string | null;
  deadline: string | null;
  is_urgent: boolean;
  onboarding_submitted_at: string | null;
  intake_answers: Record<string, string> | null;
  custom_fee_pence: number | null;
};

const LIVE_STATUSES = new Set(["in_review", "prepared", "filed"]);
const FAR_FUTURE = Number.MAX_SAFE_INTEGER;

function rowFromPayload(r: Record<string, unknown>): Row {
  return {
    id: r.id as string,
    segment: (r.segment as string) ?? "",
    tier: (r.tier as string) ?? "",
    status: (r.status as string) ?? "",
    stripe_payment_status: (r.stripe_payment_status as string) ?? "",
    submitted_at: (r.submitted_at as string | null) ?? null,
    created_at: r.created_at as string,
    accountant_id: (r.accountant_id as string | null) ?? null,
    deadline: (r.deadline as string | null) ?? null,
    is_urgent: !!r.is_urgent,
    onboarding_submitted_at: (r.onboarding_submitted_at as string | null) ?? null,
    intake_answers: (r.intake_answers as Record<string, string> | null) ?? null,
    custom_fee_pence: (r.custom_fee_pence as number | null) ?? null,
  };
}

type TierEntry = [string, PlanTier];

export function AccountantDashboardLive({
  meId,
  initialMine,
  initialQueue,
  pchTaxYears,
  pchIntakeReady,
  tierEntries,
  view,
  urgency,
  fee,
  date,
}: {
  meId: string;
  initialMine: Row[];
  initialQueue: Row[];
  pchTaxYears: Array<[string, string]>;
  pchIntakeReady: Array<[string, boolean]>;
  tierEntries: TierEntry[];
  view: CasesView;
  urgency: UrgencyFilter;
  fee: FeeFilter;
  date: DateFilter;
}) {
  const tierMap = useMemo(() => new Map(tierEntries), [tierEntries]);
  // PCH lookups come from the server-side admin query; new cases that
  // arrive via realtime won't have an entry, which means a brand-new PCH
  // paid case won't show in the queue until the next navigation (its
  // engine_snapshot_at hasn't shown up here yet). Acceptable tradeoff:
  // the queue intentionally gates on "client clicked Submit for review",
  // and that write races with the realtime INSERT anyway.
  const pchTaxYearById = useMemo(() => new Map(pchTaxYears), [pchTaxYears]);
  const pchIntakeReadyById = useMemo(() => new Map(pchIntakeReady), [pchIntakeReady]);

  // Two live-tracked lists keyed off the two server queries. Each
  // scopes its own realtime map so we only hold rows this viewer can
  // actually see without crosstalk between the mine and queue buckets.
  const mine = useLiveList<Row>(initialMine, {
    table: "cases",
    channel: `accountant-dash-mine-${meId}`,
    map: (row) => {
      const r = rowFromPayload(row);
      if (r.accountant_id !== meId) return null;
      return r;
    },
  });
  const queue = useLiveList<Row>(initialQueue, {
    table: "cases",
    channel: `accountant-dash-queue-${meId}`,
    map: (row) => {
      const r = rowFromPayload(row);
      if (r.accountant_id !== null) return null;
      if (r.status !== "submitted") return null;
      if (r.stripe_payment_status !== "succeeded") return null;
      // PCH tier only joins the queue once the client has submitted
      // for review (engine_snapshot_at stamped on pch_cases). We don't
      // have that bit for a case we haven't seen before, so a brand-new
      // paid PCH row stays out of the queue until next navigation; a
      // row we already have retains whatever intake-ready state the
      // server derived at page load.
      if (r.tier === "uber_phv_automated" && !pchIntakeReadyById.get(r.id)) return null;
      return r;
    },
  });

  const live = mine.filter((c) => LIVE_STATUSES.has(c.status));
  const completed = mine.filter((c) => c.status === "complete");
  const pendingCases = mine.filter((c) => c.status === "client_approval");
  const assigned = mine.filter((c) => c.status === "draft" || c.status === "submitted");

  const effectiveDeadline = (c: Row): number => {
    if (c.tier === "uber_phv_automated") {
      const ty = pchTaxYearById.get(c.id);
      if (ty) {
        try { return deadlinesForYear(ty).filingDeadline.getTime(); } catch { /* fall through */ }
      }
    }
    return c.deadline ? new Date(c.deadline).getTime() : FAR_FUTURE;
  };
  const byDeadline = (a: Row, b: Row): number => {
    const da = effectiveDeadline(a);
    const db = effectiveDeadline(b);
    if (da !== db) return da - db;
    const sa = a.submitted_at ? new Date(a.submitted_at).getTime() : new Date(a.created_at).getTime();
    const sb = b.submitted_at ? new Date(b.submitted_at).getTime() : new Date(b.created_at).getTime();
    return sa - sb;
  };
  // byDeadline closes over pchTaxYearById; depending on that map covers
  // the closure. eslint-disable to keep the dependency array focused.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const queueSorted = useMemo(() => [...queue].sort(byDeadline), [queue, pchTaxYearById]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const liveSorted = useMemo(() => [...live].sort(byDeadline), [live, pchTaxYearById]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pendingSorted = useMemo(() => [...pendingCases].sort(byDeadline), [pendingCases, pchTaxYearById]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const assignedSorted = useMemo(() => [...assigned].sort(byDeadline), [assigned, pchTaxYearById]);

  const viewCounts: ViewCounts = {
    live: liveSorted.length,
    queue: queueSorted.length,
    assigned: assignedSorted.length,
    completed: completed.length,
    pending: pendingSorted.length,
  };

  const pool =
    view === "queue"
      ? queueSorted
      : view === "assigned"
        ? assignedSorted
        : view === "completed"
          ? completed
          : view === "pending"
            ? pendingSorted
            : liveSorted;

  const filtered = pool.filter((c) => {
    if (fee !== "all") {
      const pricePence = effectiveFeePence(c, tierMap.get(c.tier) ?? null);
      if (pricePence <= 0) return false;
      const priceGbp = pricePence / 100;
      if (fee === "under_300" && priceGbp >= 300) return false;
      if (fee === "300_to_600" && (priceGbp < 300 || priceGbp > 600)) return false;
      if (fee === "over_600" && priceGbp <= 600) return false;
    }
    if (urgency !== "all") {
      if (!c.deadline) return false;
      const days = Math.round(
        // eslint-disable-next-line react-hooks/purity -- urgency buckets are per-render clock-driven; stability across one render tick is fine.
        (new Date(c.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );
      if (urgency === "urgent" && days > 3) return false;
      if (urgency === "soon" && (days <= 3 || days > 14)) return false;
      if (urgency === "safe" && days <= 14) return false;
    }
    if (date !== "all") {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - (date === "7d" ? 7 : date === "30d" ? 30 : 90));
      const stamp = new Date(c.created_at).getTime();
      if (stamp < cutoff.getTime()) return false;
    }
    return true;
  });

  return (
    <>
      <AccountantCasesFilter view={view} urgency={urgency} fee={fee} date={date} counts={viewCounts} />
      {filtered.length === 0 ? (
        pool.length === 0 ? (
          <EmptyState
            title="Nothing to show here."
            hint={
              view === "queue"
                ? "No paid cases waiting to be picked up. The bell will ping you when one lands."
                : view === "live"
                  ? "No cases are actively being worked on right now."
                  : view === "pending"
                    ? "No cases are waiting on the client to approve."
                    : "No completed cases yet."
            }
          />
        ) : (
          <div className="card-sl border-dashed p-8 text-center sm:p-10">
            <p className="text-lg font-semibold text-ink">
              {pool.length} case{pool.length === 1 ? "" : "s"} hidden by filters.
            </p>
            <p className="mt-2 text-sm text-slate">
              Loosen a filter to see them again.
            </p>
            <Link
              href={`/accountant?view=${view}`}
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-navy-deep px-4 py-1.5 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Clear filters
            </Link>
          </div>
        )
      ) : (
        <ul className="grid gap-3">
          {filtered.map((c) => (
            <li key={c.id}>
              <CaseCard
                c={c}
                tier={tierMap.get(c.tier) ?? null}
                pchIntakeReady={c.tier === "uber_phv_automated" ? pchIntakeReadyById.get(c.id) ?? false : null}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function CaseCard({
  c, tier, pchIntakeReady,
}: {
  c: Row;
  tier: PlanTier | null;
  pchIntakeReady: boolean | null;
}) {
  const seg = getSegment(c.segment);
  const isMine = !!c.accountant_id;
  const companyName = companyNameFromAnswers(c.intake_answers, c.segment);
  const onboardingInProgress =
    (c.segment === "limited_company_vat" || c.segment === "personal") &&
    c.tier !== "uber_phv_automated" &&
    !c.onboarding_submitted_at &&
    (c.status === "draft" || c.status === "submitted");
  const pchIntakeInProgress = pchIntakeReady === false;
  return (
    <Link
      href={`/accountant/cases/${c.id}`}
      className="card-sl group flex items-center gap-4 p-5 transition hover:border-sky/40 hover:-translate-y-0.5"
    >
      <div
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white text-lg"
        style={{ background: "linear-gradient(135deg, var(--navy), var(--sky))" }}
        aria-hidden="true"
      >
        {seg?.numeral ?? "."}
      </div>
      <div className="min-w-0 flex-1">
        {companyName ? (
          <div className="truncate text-sm font-semibold text-ink">{companyName}</div>
        ) : null}
        <div className={"flex flex-wrap items-center gap-2 " + (companyName ? "mt-0.5" : "")}>
          <span className={companyName ? "text-xs text-slate" : "text-sm font-semibold text-ink"}>
            {seg?.title ?? c.segment}
          </span>
          <span className="text-xs text-slate">.</span>
          <span className="text-xs text-slate">
            {tier?.title ?? c.tier}. {formatFeeGbp(effectiveFeePence(c, tier))}
          </span>
        </div>
        <div className="mt-1 text-xs text-slate">
          {isMine
            ? `Started ${formatDate(c.created_at)}`
            : `Submitted ${c.submitted_at ? formatDateTime(c.submitted_at) : "."}`}
        </div>
        {onboardingInProgress ? (
          <div
            className="mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={{ background: "rgba(217, 159, 25, 0.14)", color: "#B57E12", fontFamily: "var(--font-mono)" }}
          >
            Onboarding in progress · client may need help
          </div>
        ) : null}
        {pchIntakeInProgress ? (
          <div
            className="mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={{ background: "rgba(217, 159, 25, 0.14)", color: "#B57E12", fontFamily: "var(--font-mono)" }}
          >
            Intake in progress · client still filling in
          </div>
        ) : null}
      </div>
      <div className="flex flex-col items-end gap-1">
        <StatusPill status={c.status} />
        {c.is_urgent ? <UrgentPill size="sm" /> : null}
        {c.deadline ? <DeadlinePill deadline={c.deadline} size="sm" /> : null}
      </div>
    </Link>
  );
}
