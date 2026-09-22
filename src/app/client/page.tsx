import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSegment } from "@/lib/segments";
import { getTier } from "@/lib/plans";
import { DashboardShell, EmptyState } from "@/components/dashboard-shell";
import { SLLink } from "@/components/sl-button";
import { StatusPill } from "@/components/case/status-pill";
import { DeadlinePill } from "@/components/case/deadline-pill";
import { formatDate } from "@/lib/format";
import { ClientNav, ClientCasesFilter } from "./client-nav";
import { Bell } from "@/components/bell";

export const dynamic = "force-dynamic";

type View = "in_progress" | "completed" | "pending";

const IN_PROGRESS = new Set([
  "submitted",
  "in_review",
  "prepared",
  "client_approval",
  "filed",
]);

export default async function ClientDashboard({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view: viewRaw } = await searchParams;
  const view: View =
    viewRaw === "completed" || viewRaw === "pending" ? viewRaw : "in_progress";

  const me = await requireRole("client");
  const supabase = await createClient();
  const { data: cases } = await supabase
    .from("cases")
    .select(
      "id, segment, tier, status, stripe_payment_status, created_at, submitted_at, deadline",
    )
    .eq("client_id", me.id)
    .order("created_at", { ascending: false });

  const all = cases ?? [];
  const filtered = all.filter((c) => {
    if (view === "completed") return c.status === "complete";
    if (view === "pending") return c.status === "draft";
    return IN_PROGRESS.has(c.status);
  });

  return (
    <DashboardShell
      eyebrow="Client workspace"
      title="Your tax returns"
      description="Track the status of your filings and chat with your accountant."
      name={me.name}
      email={me.email}
      role={me.role}
      subnav={<ClientNav active="cases" />}
      bell={<Bell userId={me.id} role={me.role} />}
    >
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <ClientCasesFilter active={view} />
        <SLLink href="/client/new" variant="primary">
          Start a new return
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M4 10h12M11 5l5 5-5 5" />
          </svg>
        </SLLink>
      </div>

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
        <ul className="grid gap-3">
          {filtered.map((c) => {
            const seg = getSegment(c.segment);
            const tier = getTier(c.tier);
            return (
              <li key={c.id}>
                <Link
                  href={`/client/cases/${c.id}`}
                  className="card-sl group flex items-center gap-4 p-5 transition hover:border-sky/40 hover:-translate-y-0.5"
                >
                  <div
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white text-lg"
                    style={{
                      background:
                        "linear-gradient(135deg, var(--navy), var(--sky))",
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
                        {tier?.title ?? c.tier} · £{tier?.priceGbp ?? "."}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate">
                      Started {formatDate(c.created_at)}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusPill status={c.status} />
                    {c.deadline ? (
                      <DeadlinePill deadline={c.deadline} size="sm" />
                    ) : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardShell>
  );
}
