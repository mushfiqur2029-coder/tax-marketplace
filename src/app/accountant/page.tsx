import Link from "next/link";
import { requireApprovedAccountant } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSegment } from "@/lib/segments";
import { getTier, type TierId } from "@/lib/plans";
import { DashboardShell, EmptyState } from "@/components/dashboard-shell";
import { StatusPill } from "@/components/case/status-pill";
import { DeadlinePill } from "@/components/case/deadline-pill";
import { UrgentPill } from "@/components/case/urgent-pill";
import { Bell } from "@/components/bell";
import { AccountantNav } from "./accountant-nav";
import {
  AccountantCasesFilter,
  type CasesView,
  type UrgencyFilter,
  type IncomeFilter,
  type DateFilter,
  type ViewCounts,
} from "./cases-filter";
import { AccountantCasesRealtimeRefresh } from "./cases-realtime-refresh";
import { AccountantSuspensionBanner } from "./suspension-banner";
import { formatDate, formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

type Row = {
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
};

// "Live" = cases actively being worked on right now.
const LIVE_STATUSES = new Set(["in_review", "prepared", "filed"]);

export default async function AccountantDashboard({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    urgency?: string;
    income?: string;
    date?: string;
  }>;
}) {
  const raw = await searchParams;
  const view: CasesView =
    raw.view === "queue" || raw.view === "completed" || raw.view === "pending"
      ? raw.view
      : "live";
  const urgency: UrgencyFilter =
    raw.urgency === "safe" || raw.urgency === "soon" || raw.urgency === "urgent"
      ? raw.urgency
      : "all";
  const income: IncomeFilter =
    raw.income === "basic" || raw.income === "standard" || raw.income === "premium"
      ? raw.income
      : "all";
  const date: DateFilter =
    raw.date === "7d" || raw.date === "30d" || raw.date === "90d"
      ? raw.date
      : "all";

  const me = await requireApprovedAccountant();
  const supabase = await createClient();

  // Queue filter has a limited-company carve-out. Personal cases hit the
  // queue the moment payment lands + status=submitted. Limited-company
  // cases hit the queue only after onboarding_submitted_at is stamped,
  // since the per-service document checklist (Sections A/B/C/D) runs
  // post-payment and an accountant can't start work without it. We
  // express this via .or(): "segment is not limited_company_vat, OR
  // onboarding_submitted_at IS NOT NULL".
  const [queueRes, mineRes] = await Promise.all([
    supabase
      .from("cases")
      .select(
        "id, segment, tier, status, stripe_payment_status, submitted_at, created_at, accountant_id, deadline, is_urgent, onboarding_submitted_at",
      )
      .eq("status", "submitted")
      .eq("stripe_payment_status", "succeeded")
      .is("accountant_id", null)
      .or("segment.neq.limited_company_vat,onboarding_submitted_at.not.is.null")
      .order("submitted_at", { ascending: true }),
    supabase
      .from("cases")
      .select(
        "id, segment, tier, status, stripe_payment_status, submitted_at, created_at, accountant_id, deadline, is_urgent, onboarding_submitted_at",
      )
      .eq("accountant_id", me.id)
      .order("created_at", { ascending: false }),
  ]);

  const queue = (queueRes.data ?? []) as Row[];
  const mine = (mineRes.data ?? []) as Row[];

  const live = mine.filter((c) => LIVE_STATUSES.has(c.status));
  const completed = mine.filter((c) => c.status === "complete");
  // "Pending" from the accountant's POV = returned to client for approval,
  // now waiting on the client to sign off.
  const pendingCases = mine.filter((c) => c.status === "client_approval");

  const viewCounts: ViewCounts = {
    live: live.length,
    queue: queue.length,
    completed: completed.length,
    pending: pendingCases.length,
  };

  const pool =
    view === "queue"
      ? queue
      : view === "completed"
        ? completed
        : view === "pending"
          ? pendingCases
          : live;

  const filtered = pool.filter((c) => {
    if (income !== "all" && (c.tier as TierId) !== income) return false;
    if (urgency !== "all") {
      if (!c.deadline) return false;
      const days = Math.round(
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
    <DashboardShell
      eyebrow="Accountant workspace"
      title="Cases"
      description="Pick up new cases from the queue and track everything you're working on."
      name={me.name}
      email={me.email}
      role={me.role}
      subnav={<AccountantNav active="cases" />}
      bell={<Bell userId={me.id} role={me.role} />}
    >
      <AccountantSuspensionBanner />
      <AccountantCasesRealtimeRefresh accountantId={me.id} />
      <AccountantCasesFilter view={view} urgency={urgency} income={income} date={date} counts={viewCounts} />

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
            <li key={c.id}>{renderCard(c)}</li>
          ))}
        </ul>
      )}
    </DashboardShell>
  );
}

function renderCard(c: Row) {
  const seg = getSegment(c.segment);
  const tier = getTier(c.tier);
  const isMine = !!c.accountant_id;
  return (
    <Link
      href={`/accountant/cases/${c.id}`}
      className="card-sl group flex items-center gap-4 p-5 transition hover:border-sky/40 hover:-translate-y-0.5"
    >
      <div
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white text-lg"
        style={{
          background: "linear-gradient(135deg, var(--navy), var(--sky))",
        }}
        aria-hidden="true"
      >
        {seg?.numeral ?? "."}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-ink">
            {seg?.title ?? c.segment}
          </span>
          <span className="text-xs text-slate">.</span>
          <span className="text-xs text-slate">
            {tier?.title ?? c.tier}. £{tier?.priceGbp ?? "."}
          </span>
        </div>
        <div className="mt-1 text-xs text-slate">
          {isMine
            ? `Started ${formatDate(c.created_at)}`
            : `Submitted ${c.submitted_at ? formatDateTime(c.submitted_at) : "."}`}
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
