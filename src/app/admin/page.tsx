import Link from "next/link";
import {
  requireRole,
  isPrimaryAdmin,
} from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAllTiers } from "@/lib/service-catalog";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Avatar } from "@/components/avatar";
import { type AdminCaseView, type AdminCaseCounts } from "./cases-filter";
import { deleteStaleDraftCaseAction } from "@/app/admin/actions";
import { STALE_DRAFT_DAYS } from "@/app/admin/constants";
import { AdminDashboardLive, type Row } from "./admin-dashboard-live";

export const dynamic = "force-dynamic";

// Bucket the case status values into the four tabs the filter renders.
// Kept in sync with client-side IN_PROGRESS to match the client's view.
const IN_PROGRESS_STATUSES = new Set([
  "submitted",
  "in_review",
  "prepared",
  "client_approval",
  "filed",
]);

// Case list cap on the admin dashboard. The dashboard shows the
// most recent N cases; counts across all buckets still fire as
// head-only COUNT queries so metrics stay accurate even past this
// cap. If the business ever needs to scroll past the first page
// we'll want keyset pagination (cursor on created_at) rather than
// OFFSET - but at the volume this product sees today, a 100-row
// most-recent page is the right amount of information for the
// at-a-glance dashboard.
const DASHBOARD_CASE_LIMIT = 100;

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view: viewRaw } = await searchParams;
  const view: AdminCaseView =
    viewRaw === "in_progress" ||
    viewRaw === "completed" ||
    viewRaw === "pending" ||
    viewRaw === "stale_drafts"
      ? viewRaw
      : "all";

  const me = await requireRole("admin");
  const callerIsPrimary = isPrimaryAdmin(me);
  const admin = createAdminClient();

  const [
    { data: cases },
    { count: clientCount },
    { count: accountantCount },
    { data: accountantProfiles },
    { data: assignedCaseLoad },
  ] = await Promise.all([
    admin
      .from("cases")
      .select(
        "id, segment, tier, status, stripe_payment_status, created_at, submitted_at, deadline, client_id, accountant_id, is_urgent, intake_answers, custom_fee_pence",
      )
      .order("created_at", { ascending: false })
      .limit(DASHBOARD_CASE_LIMIT),
    admin.from("users").select("id", { count: "exact", head: true }).eq("role", "client"),
    admin.from("users").select("id", { count: "exact", head: true }).eq("role", "accountant"),
    admin
      .from("accountant_profiles")
      .select("user_id, name, avatar_path, approval_status"),
    // Narrow, uncapped query for the per-accountant workload stat below.
    // The dashboard's case list is capped at DASHBOARD_CASE_LIMIT, so
    // deriving workload counts from it undercounts accountants with more
    // open cases than fit on the first page. This selects only the two
    // columns needed and covers every assigned case.
    admin
      .from("cases")
      .select("accountant_id, status")
      .not("accountant_id", "is", null),
  ]);

  const allCases = (cases ?? []) as Row[];
  // Mirrors admin-dashboard-live's IN_PROGRESS_STATUSES. The server-side
  // count query uses the same list; the client wrapper derives its live
  // tab counts from the capped list.
  // eslint-disable-next-line react-hooks/purity -- server component; one Date.now per request is fine.
  const staleCutoffMs = Date.now() - STALE_DRAFT_DAYS * 24 * 60 * 60 * 1000;
  const staleCutoffIso = new Date(staleCutoffMs).toISOString();

  // Count queries hit COUNT indexes directly - no row payload, so
  // these stay fast even as the cases table grows past the dashboard
  // display cap. Previously the dashboard filtered the full-table
  // row set in-memory to get these numbers, which stopped scaling.
  const inProgressStatuses = Array.from(IN_PROGRESS_STATUSES);
  const [
    { count: allCount },
    { count: inProgressCount },
    { count: completedCount },
    { count: pendingCount },
    { count: staleDraftsCount },
    { count: paidCount },
    { count: assignedCount },
    { count: unassignedPaidCount },
    { count: pchTotal },
    { count: pchAwaitingApproval },
    { count: pchFiled },
  ] = await Promise.all([
    admin.from("cases").select("id", { count: "exact", head: true }),
    admin
      .from("cases")
      .select("id", { count: "exact", head: true })
      .in("status", inProgressStatuses),
    admin
      .from("cases")
      .select("id", { count: "exact", head: true })
      .eq("status", "complete"),
    admin
      .from("cases")
      .select("id", { count: "exact", head: true })
      .eq("status", "draft"),
    admin
      .from("cases")
      .select("id", { count: "exact", head: true })
      .eq("status", "draft")
      .neq("stripe_payment_status", "succeeded")
      .lt("created_at", staleCutoffIso),
    admin
      .from("cases")
      .select("id", { count: "exact", head: true })
      .eq("stripe_payment_status", "succeeded"),
    admin
      .from("cases")
      .select("id", { count: "exact", head: true })
      .not("accountant_id", "is", null),
    admin
      .from("cases")
      .select("id", { count: "exact", head: true })
      .is("accountant_id", null)
      .eq("status", "submitted")
      .eq("stripe_payment_status", "succeeded"),
    admin
      .from("cases")
      .select("id", { count: "exact", head: true })
      .eq("tier", "uber_phv_automated"),
    admin
      .from("cases")
      .select("id", { count: "exact", head: true })
      .eq("tier", "uber_phv_automated")
      .eq("status", "client_approval"),
    admin
      .from("cases")
      .select("id", { count: "exact", head: true })
      .eq("tier", "uber_phv_automated")
      .in("status", ["filed", "complete"]),
  ]);

  const totalCases = allCount ?? 0;
  const paidCases = paidCount ?? 0;
  const assignedCases = assignedCount ?? 0;
  const unassignedPaid = unassignedPaidCount ?? 0;

  const caseCounts: AdminCaseCounts = {
    all: allCount ?? 0,
    in_progress: inProgressCount ?? 0,
    completed: completedCount ?? 0,
    pending: pendingCount ?? 0,
    stale_drafts: staleDraftsCount ?? 0,
  };

  const tiers = await getAllTiers({ includeInactive: true, includeAdminCreateOnly: true });
  const tierEntries = tiers.map((t) => [t.id as string, t] as const);

  const relevantUserIds = Array.from(
    new Set([
      ...(cases ?? []).map((c) => c.client_id),
      ...((cases ?? []).map((c) => c.accountant_id).filter(Boolean) as string[]),
    ]),
  );
  const { data: users } = relevantUserIds.length
    ? await admin.from("users").select("id, email").in("id", relevantUserIds)
    : { data: [] as { id: string; email: string }[] };
  const emailById: Record<string, string> = Object.fromEntries(
    (users ?? []).map((u) => [u.id, u.email as string]),
  );

  const nameById = new Map(
    (accountantProfiles ?? []).map((p) => [p.user_id, p.name]),
  );
  const avatarById = new Map(
    (accountantProfiles ?? []).map((p) => [p.user_id, p.avatar_path]),
  );

  // Case count per accountant, across every assigned case (not just the
  // capped dashboard list - see assignedCaseLoad query above).
  const perAccountant = new Map<string, { total: number; open: number }>();
  for (const c of assignedCaseLoad ?? []) {
    if (!c.accountant_id) continue;
    const entry = perAccountant.get(c.accountant_id) ?? { total: 0, open: 0 };
    entry.total += 1;
    if (c.status !== "complete") entry.open += 1;
    perAccountant.set(c.accountant_id, entry);
  }

  return (
    <>
      <AdminPageHeader
        eyebrow="Admin console"
        title="Platform overview"
        description="Numbers first. Everything else is one click away."
      />
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

      {/* PCH automated flow */}
      {(pchTotal ?? 0) > 0 ? (
        <section className="mb-8">
          <h2
            className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            PCH automated
          </h2>
          <Link
            href="/admin/pch"
            className="card-sl grid gap-3 p-5 transition hover:border-sky/40 sm:grid-cols-3"
          >
            <PchStat label="Total" value={pchTotal ?? 0} />
            <PchStat label="Awaiting client approval" value={pchAwaitingApproval ?? 0} />
            <PchStat label="Filed / complete" value={pchFiled ?? 0} />
          </Link>
        </section>
      ) : null}

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
                      email={emailById[id] ?? null}
                      size={40}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-ink">
                        {nameById.get(id) ?? emailById[id] ?? "."}
                      </div>
                      <div className="text-xs text-slate">
                        {emailById[id] ?? id.slice(0, 8)}
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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2
            className="text-sm font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Cases
          </h2>
        </div>
        <AdminDashboardLive
          initial={allCases}
          initialCounts={caseCounts}
          view={view}
          callerIsPrimary={callerIsPrimary}
          tierEntries={tierEntries as Array<[string, typeof tiers[number]]>}
          emailById={emailById}
          deleteStaleDraft={async (id: string) => {
            "use server";
            return deleteStaleDraftCaseAction(id);
          }}
        />
      </section>
    </>
  );
}

function PchStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div
        className="text-[11px] font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {label}
      </div>
      <div
        className="mt-1 text-2xl font-bold text-ink"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        {value}
      </div>
    </div>
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

