import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSegment } from "@/lib/segments";
import { getTier } from "@/lib/plans";
import { DashboardShell, EmptyState } from "@/components/dashboard-shell";
import { StatusPill } from "@/components/case/status-pill";
import { DeadlinePill } from "@/components/case/deadline-pill";
import { Avatar } from "@/components/avatar";
import { AdminNav } from "@/app/admin/admin-nav";
import { getAdminNavCounts } from "@/app/admin/admin-counts";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const me = await requireRole("admin");
  const admin = createAdminClient();

  const [
    { data: cases },
    { count: clientCount },
    { count: accountantCount },
    { data: accountantProfiles },
    navCounts,
  ] = await Promise.all([
    admin
      .from("cases")
      .select(
        "id, segment, tier, status, stripe_payment_status, created_at, submitted_at, deadline, client_id, accountant_id",
      )
      .order("created_at", { ascending: false }),
    admin.from("users").select("id", { count: "exact", head: true }).eq("role", "client"),
    admin.from("users").select("id", { count: "exact", head: true }).eq("role", "accountant"),
    admin
      .from("accountant_profiles")
      .select("user_id, name, avatar_path, approval_status"),
    getAdminNavCounts(),
  ]);

  const totalCases = cases?.length ?? 0;
  const paidCases = (cases ?? []).filter(
    (c) => c.stripe_payment_status === "succeeded",
  ).length;
  const assignedCases = (cases ?? []).filter((c) => c.accountant_id).length;
  const unassignedPaid = (cases ?? []).filter(
    (c) =>
      c.accountant_id === null &&
      c.status === "submitted" &&
      c.stripe_payment_status === "succeeded",
  ).length;

  const relevantUserIds = Array.from(
    new Set([
      ...(cases ?? []).map((c) => c.client_id),
      ...((cases ?? []).map((c) => c.accountant_id).filter(Boolean) as string[]),
    ]),
  );
  const { data: users } = relevantUserIds.length
    ? await admin.from("users").select("id, email").in("id", relevantUserIds)
    : { data: [] as { id: string; email: string }[] };
  const emailById = new Map((users ?? []).map((u) => [u.id, u.email]));

  const nameById = new Map(
    (accountantProfiles ?? []).map((p) => [p.user_id, p.name]),
  );
  const avatarById = new Map(
    (accountantProfiles ?? []).map((p) => [p.user_id, p.avatar_path]),
  );

  // Case count per accountant.
  const perAccountant = new Map<string, { total: number; open: number }>();
  for (const c of cases ?? []) {
    if (!c.accountant_id) continue;
    const entry = perAccountant.get(c.accountant_id) ?? { total: 0, open: 0 };
    entry.total += 1;
    if (c.status !== "complete") entry.open += 1;
    perAccountant.set(c.accountant_id, entry);
  }

  return (
    <DashboardShell
      eyebrow="Admin console"
      title="Platform overview"
      description="Numbers first. Everything else is one click away."
      name={me.name}
      email={me.email}
      role={me.role}
      subnav={<AdminNav active="dashboard" counts={navCounts} />}
    >
      {/* Stat cards */}
      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Clients" value={clientCount ?? 0} />
        <StatCard label="Accountants" value={accountantCount ?? 0} />
        <StatCard
          label="Cases (paid / total)"
          value={`${paidCases} / ${totalCases}`}
        />
        <StatCard
          label="Assigned / in queue"
          value={`${assignedCases} / ${unassignedPaid}`}
        />
      </div>

      {/* Per-accountant workload */}
      <section className="mb-10">
        <h2
          className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Case load per accountant
        </h2>
        {perAccountant.size === 0 ? (
          <p className="card-sl border-dashed p-6 text-center text-sm text-slate">
            No cases assigned yet.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from(perAccountant.entries())
              .sort((a, b) => b[1].total - a[1].total)
              .map(([id, { total, open }]) => (
                <li key={id}>
                  <Link
                    href={`/admin/accountants/${id}`}
                    className="card-sl flex items-center gap-3 p-4 transition hover:border-sky/40"
                  >
                    <Avatar
                      path={avatarById.get(id) ?? null}
                      name={nameById.get(id) ?? null}
                      email={emailById.get(id) ?? null}
                      size={40}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-ink">
                        {nameById.get(id) ?? emailById.get(id) ?? "."}
                      </div>
                      <div className="text-xs text-slate">
                        {emailById.get(id) ?? id.slice(0, 8)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className="text-lg font-bold text-ink"
                        style={{ fontFamily: "var(--font-heading)" }}
                      >
                        {total}
                      </div>
                      <div className="text-[10px] text-slate">
                        {open} open
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </section>

      {/* Cases */}
      <section>
        <h2
          className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          All cases ({totalCases})
        </h2>
        {!cases || cases.length === 0 ? (
          <EmptyState title="No cases yet." hint="Cases will appear here as clients submit them." />
        ) : (
          <ul className="grid gap-3">
            {cases.map((c) => {
              const seg = getSegment(c.segment);
              const tier = getTier(c.tier);
              return (
                <li key={c.id}>
                  <Link
                    href={`/admin/cases/${c.id}`}
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
                          {tier?.title ?? c.tier} · £{tier?.priceGbp ?? "."}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate">
                        Client {emailById.get(c.client_id) ?? "."}
                        {c.accountant_id ? (
                          <>
                            {" · Accountant "}
                            {emailById.get(c.accountant_id) ?? "."}
                          </>
                        ) : (
                          " · Unassigned"
                        )}
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
      </section>
    </DashboardShell>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card-sl p-5">
      <div
        className="text-[11px] font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {label}
      </div>
      <div
        className="mt-2 text-3xl font-bold text-ink"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        {value}
      </div>
    </div>
  );
}

