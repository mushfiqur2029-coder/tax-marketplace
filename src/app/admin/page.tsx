import Link from "next/link";
import {
  requireRole,
  isPrimaryAdmin,
} from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSegment } from "@/lib/segments";
import { getAllTiers } from "@/lib/service-catalog";
import { effectiveFeePence, formatFeeGbp } from "@/lib/case/pricing";
import { companyNameFromAnswers } from "@/lib/case/company-label";
import { EmptyState } from "@/components/empty-state";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { StatusPill } from "@/components/case/status-pill";
import { DeadlinePill } from "@/components/case/deadline-pill";
import { UrgentPill } from "@/components/case/urgent-pill";
import { Avatar } from "@/components/avatar";
import {
  AdminCasesFilter,
  type AdminCaseView,
  type AdminCaseCounts,
} from "./cases-filter";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import {
  deleteStaleDraftCaseAction,
  STALE_DRAFT_DAYS,
} from "@/app/admin/actions";
import { DeleteStaleDraftButton } from "./delete-stale-draft-button";

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
  ] = await Promise.all([
    admin
      .from("cases")
      .select(
        "id, segment, tier, status, stripe_payment_status, created_at, submitted_at, deadline, client_id, accountant_id, is_urgent, intake_answers, custom_fee_pence",
      )
      .order("created_at", { ascending: false }),
    admin.from("users").select("id", { count: "exact", head: true }).eq("role", "client"),
    admin.from("users").select("id", { count: "exact", head: true }).eq("role", "accountant"),
    admin
      .from("accountant_profiles")
      .select("user_id, name, avatar_path, approval_status"),
  ]);

  const allCases = cases ?? [];
  const totalCases = allCases.length;
  const paidCases = allCases.filter(
    (c) => c.stripe_payment_status === "succeeded",
  ).length;
  const assignedCases = allCases.filter((c) => c.accountant_id).length;
  const unassignedPaid = allCases.filter(
    (c) =>
      c.accountant_id === null &&
      c.status === "submitted" &&
      c.stripe_payment_status === "succeeded",
  ).length;

  // Stale drafts: eligibility for the primary-admin-only delete flow.
  // Mirrors the server-side STALE_DRAFT_DAYS threshold; the server
  // action re-checks before actually deleting, so this is purely a
  // display filter.
  // eslint-disable-next-line react-hooks/purity -- server component; one Date.now per request is fine.
  const staleCutoffMs = Date.now() - STALE_DRAFT_DAYS * 24 * 60 * 60 * 1000;
  const isStaleDraft = (c: {
    status: string;
    stripe_payment_status: string;
    created_at: string;
  }) =>
    c.status === "draft" &&
    c.stripe_payment_status !== "succeeded" &&
    new Date(c.created_at).getTime() < staleCutoffMs;

  const caseCounts: AdminCaseCounts = {
    all: allCases.length,
    in_progress: allCases.filter((c) => IN_PROGRESS_STATUSES.has(c.status)).length,
    completed: allCases.filter((c) => c.status === "complete").length,
    pending: allCases.filter((c) => c.status === "draft").length,
    stale_drafts: allCases.filter(isStaleDraft).length,
  };

  const tierMap = new Map(
    (
      await getAllTiers({ includeInactive: true, includeAdminCreateOnly: true })
    ).map((t) => [t.id as string, t]),
  );

  const filteredCases = allCases.filter((c) => {
    if (view === "all") return true;
    if (view === "in_progress") return IN_PROGRESS_STATUSES.has(c.status);
    if (view === "completed") return c.status === "complete";
    if (view === "pending") return c.status === "draft";
    if (view === "stale_drafts") return isStaleDraft(c);
    return true;
  });

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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2
            className="text-sm font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Cases ({filteredCases.length})
          </h2>
        </div>
        <RealtimeRefresh
          channel="admin-dashboard"
          subscriptions={[{ table: "cases" }, { table: "case_addons" }]}
        />
        <AdminCasesFilter active={view} counts={caseCounts} />
        {view === "stale_drafts" ? (
          <StaleDraftIntro callerIsPrimary={callerIsPrimary} />
        ) : null}
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
            {filteredCases.map((c) => {
              const seg = getSegment(c.segment);
              const tier = tierMap.get(c.tier) ?? null;
              const companyName = companyNameFromAnswers(
                c.intake_answers,
                c.segment,
              );
              const ageDays = (
                // eslint-disable-next-line react-hooks/purity -- server component; one Date.now per request is fine.
                (Date.now() - new Date(c.created_at).getTime()) /
                (1000 * 60 * 60 * 24)
              ).toFixed(1);
              const deleteCase = async (id: string) => {
                "use server";
                return deleteStaleDraftCaseAction(id);
              };
              return (
                <li key={c.id}>
                  <div className="card-sl flex items-center gap-4 p-5">
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
                      {companyName ? (
                        <div className="truncate text-sm font-semibold text-ink">
                          {companyName}
                        </div>
                      ) : null}
                      <div
                        className={
                          "flex flex-wrap items-center gap-2 " +
                          (companyName ? "mt-0.5" : "")
                        }
                      >
                        <span
                          className={
                            companyName
                              ? "text-xs text-slate"
                              : "text-sm font-semibold text-ink"
                          }
                        >
                          {seg?.title ?? c.segment}
                        </span>
                        <span className="text-xs text-slate">·</span>
                        <span className="text-xs text-slate">
                          {tier?.title ?? c.tier} ·{" "}
                          {formatFeeGbp(effectiveFeePence(c, tier))}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate">
                        Client {emailById.get(c.client_id) ?? "."}
                        {" · "}
                        <span className="text-ink">{ageDays} days old</span>
                        {" · "}
                        <Link
                          href={`/admin/cases/${c.id}`}
                          className="font-semibold text-navy-deep underline underline-offset-4 hover:text-sky"
                        >
                          Open case
                        </Link>
                      </div>
                    </div>
                    {callerIsPrimary ? (
                      <DeleteStaleDraftButton
                        caseId={c.id}
                        deleteCase={deleteCase}
                      />
                    ) : (
                      <span
                        className="text-[11px] italic text-slate"
                        style={{ fontFamily: "var(--font-mono)" }}
                      >
                        Primary admin only
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <ul className="grid gap-3">
            {filteredCases.map((c) => {
              const seg = getSegment(c.segment);
              const tier = tierMap.get(c.tier) ?? null;
              const companyName = companyNameFromAnswers(
                c.intake_answers,
                c.segment,
              );
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
                      {companyName ? (
                        <div className="truncate text-sm font-semibold text-ink">
                          {companyName}
                        </div>
                      ) : null}
                      <div
                        className={
                          "flex flex-wrap items-center gap-2 " +
                          (companyName ? "mt-0.5" : "")
                        }
                      >
                        <span
                          className={
                            companyName
                              ? "text-xs text-slate"
                              : "text-sm font-semibold text-ink"
                          }
                        >
                          {seg?.title ?? c.segment}
                        </span>
                        <span className="text-xs text-slate">·</span>
                        <span className="text-xs text-slate">
                          {tier?.title ?? c.tier} · {formatFeeGbp(effectiveFeePence(c, tier))}
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
                      {c.is_urgent ? <UrgentPill size="sm" /> : null}
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
    </>
  );
}

// Short, context-setting panel shown at the top of the stale-drafts
// view. Explains why they're flagged and who can act on them, so a
// non-primary admin isn't left guessing why Delete is missing.
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
      <strong className="font-semibold">Stale drafts</strong> — cases started
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

