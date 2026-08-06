import Link from "next/link";
import { requireApprovedAccountant } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSegment } from "@/lib/segments";
import { getTier } from "@/lib/plans";
import { DashboardShell } from "@/components/dashboard-shell";
import { SLLink } from "@/components/sl-button";
import { StatusPill } from "@/components/case/status-pill";
import { DeadlinePill } from "@/components/case/deadline-pill";
import { NotificationBell } from "@/components/case/notification-bell";
import { QueueTabs } from "./queue-tabs";
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
};

export default async function AccountantDashboard() {
  const me = await requireApprovedAccountant();
  const supabase = await createClient();

  const [queueRes, mineRes] = await Promise.all([
    supabase
      .from("cases")
      .select(
        "id, segment, tier, status, stripe_payment_status, submitted_at, created_at, accountant_id, deadline",
      )
      .eq("status", "submitted")
      .eq("stripe_payment_status", "succeeded")
      .is("accountant_id", null)
      .order("submitted_at", { ascending: true }),
    supabase
      .from("cases")
      .select(
        "id, segment, tier, status, stripe_payment_status, submitted_at, created_at, accountant_id, deadline",
      )
      .eq("accountant_id", me.id)
      .order("created_at", { ascending: false }),
  ]);

  const queue = (queueRes.data ?? []) as Row[];
  const mine = (mineRes.data ?? []) as Row[];

  return (
    <DashboardShell
      eyebrow="Accountant workspace"
      title="Case queue"
      description="Pick up new cases, track your workload, and message clients."
      email={me.email}
      role={me.role}
      headerExtra={
        <>
          <SLLink
            href="/accountant/wallet"
            variant="outline"
            className="!text-[13px]"
          >
            Wallet
          </SLLink>
          <NotificationBell seedCaseIds={queue.map((c) => c.id)} />
        </>
      }
    >
      <QueueTabs
        queueCount={queue.length}
        mineCount={mine.length}
        queue={queue.map(renderRow)}
        mine={mine.map(renderRow)}
      />
    </DashboardShell>
  );
}

function renderRow(c: Row) {
  const seg = getSegment(c.segment);
  const tier = getTier(c.tier);
  const isMine = !!c.accountant_id;
  return {
    id: c.id,
    node: (
      <Link
        key={c.id}
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
          {seg?.numeral ?? "•"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ink">
              {seg?.title ?? c.segment}
            </span>
            <span className="text-xs text-slate">·</span>
            <span className="text-xs text-slate">
              {tier?.title ?? c.tier} · £{tier?.priceGbp ?? "–"}
            </span>
          </div>
          <div className="mt-1 text-xs text-slate">
            {isMine
              ? `Started ${formatDate(c.created_at)}`
              : `Submitted ${c.submitted_at ? formatDateTime(c.submitted_at) : "—"}`}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusPill status={c.status} />
          {c.deadline ? (
            <DeadlinePill deadline={c.deadline} size="sm" />
          ) : null}
        </div>
      </Link>
    ),
  };
}
