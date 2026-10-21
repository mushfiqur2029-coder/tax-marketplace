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
import { PchProgressTracker } from "@/components/case/pch-progress-tracker";
import { ValidatedBadge } from "@/components/case/validated-badge";
import { formatDate } from "@/lib/format";
import { useLiveList } from "@/lib/realtime-live-merge";
import {
  ClientCasesFilter,
  type ClientCaseCounts,
} from "./client-cases-filter";

export type Row = {
  id: string;
  segment: string;
  tier: string;
  status: string;
  stripe_payment_status: string;
  created_at: string;
  submitted_at: string | null;
  deadline: string | null;
  is_urgent: boolean;
  intake_answers: Record<string, string> | null;
  custom_fee_pence: number | null;
  service_enquiry_id: string | null;
};

type View = "in_progress" | "completed" | "pending";

// 'filed' is terminal from the client's HMRC perspective (return is
// in with HMRC, nothing more for them to do), so it sits under the
// Completed tab here. The accountant portal keeps 'filed' under Live
// because they still have post-filing admin (mark complete, close
// out), see src/app/accountant/page.tsx:46.
const IN_PROGRESS = new Set(["submitted", "in_review", "prepared", "client_approval"]);
const COMPLETED = new Set(["filed", "complete"]);

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
    is_urgent: !!r.is_urgent,
    intake_answers: (r.intake_answers as Record<string, string> | null) ?? null,
    custom_fee_pence: (r.custom_fee_pence as number | null) ?? null,
    service_enquiry_id: (r.service_enquiry_id as string | null) ?? null,
  };
}

export function ClientDashboardLive({
  clientId,
  initial,
  view,
  tierEntries,
  validatedCaseIds,
}: {
  clientId: string;
  initial: Row[];
  view: View;
  tierEntries: Array<[string, PlanTier]>;
  validatedCaseIds: string[];
}) {
  const tierMap = useMemo(() => new Map(tierEntries), [tierEntries]);
  const validatedSet = useMemo(() => new Set(validatedCaseIds), [validatedCaseIds]);

  const all = useLiveList<Row>(initial, {
    table: "cases",
    channel: `client-dash-${clientId}`,
    filter: `client_id=eq.${clientId}`,
    map: (row) => rowFromPayload(row),
  });

  const filtered = all.filter((c) => {
    if (view === "completed") return COMPLETED.has(c.status);
    if (view === "pending") return c.status === "draft";
    return IN_PROGRESS.has(c.status);
  });

  const counts: ClientCaseCounts = {
    in_progress: all.filter((c) => IN_PROGRESS.has(c.status)).length,
    completed: all.filter((c) => COMPLETED.has(c.status)).length,
    pending: all.filter((c) => c.status === "draft").length,
  };

  return (
    <>
      <ClientCasesFilter active={view} counts={counts} />
      {filtered.length === 0 ? (
        <EmptyState
          title={
            all.length === 0
              ? "Your cases will appear here."
              : `Nothing ${view === "in_progress" ? "in progress" : view === "pending" ? "pending" : "completed"} right now.`
          }
          hint={
            all.length === 0
              ? "Click Start a new return above. Answer a few questions, upload documents, and pay to submit."
              : "Switch tabs above to see cases in other states."
          }
        />
      ) : (
        <ul className="grid gap-3" data-dashboard-cases>
          {filtered.map((c) => (
            <li key={c.id}>
              <CaseCard
                c={c}
                tier={tierMap.get(c.tier) ?? null}
                validated={validatedSet.has(c.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function CaseCard({
  c, tier, validated,
}: {
  c: Row;
  tier: PlanTier | null;
  validated: boolean;
}) {
  const seg = getSegment(c.segment);
  const companyName = companyNameFromAnswers(c.intake_answers, c.segment);
  return (
    <Link
      href={`/client/cases/${c.id}`}
      className="card-sl group block p-5 transition hover:border-sky/40 hover:-translate-y-0.5"
    >
      <div className="flex items-center gap-4">
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
          <div className="mt-1 text-xs text-slate">Started {formatDate(c.created_at)}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {c.tier !== "uber_phv_automated" ? <StatusPill status={c.status} /> : null}
          {validated ? <ValidatedBadge size="sm" /> : null}
          {c.is_urgent ? <UrgentPill size="sm" /> : null}
          {c.deadline ? <DeadlinePill deadline={c.deadline} size="sm" /> : null}
        </div>
      </div>
      {c.tier === "uber_phv_automated" && c.status !== "draft" ? (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <PchProgressTracker status={c.status} compact />
        </div>
      ) : null}
    </Link>
  );
}
