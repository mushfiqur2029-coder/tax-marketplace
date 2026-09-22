import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSegment } from "@/lib/segments";
import { getTier } from "@/lib/plans";
import { DashboardShell } from "@/components/dashboard-shell";
import { Avatar } from "@/components/avatar";
import { StatusPill } from "@/components/case/status-pill";
import { DeadlinePill } from "@/components/case/deadline-pill";
import { formatDateTime } from "@/lib/format";
import { AdminNav } from "@/app/admin/admin-nav";
import { getAdminNavCounts } from "@/app/admin/admin-counts";
import { Bell } from "@/components/bell";

export const dynamic = "force-dynamic";

const money = (pence: number) => `£${(pence / 100).toFixed(2)}`;

export default async function AdminAccountantDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await requireRole("admin");
  const admin = createAdminClient();

  const [{ data: user }, { data: profile }, navCounts] = await Promise.all([
    admin.from("users").select("id, email, status").eq("id", id).single(),
    admin
      .from("accountant_profiles")
      .select("user_id, name, contact_number, company_email, company_name, avatar_path, approval_status")
      .eq("user_id", id)
      .single(),
    getAdminNavCounts(),
  ]);
  if (!user || !profile) notFound();

  const [{ data: cases }, { data: tx }, { data: reqs }] = await Promise.all([
    admin
      .from("cases")
      .select("id, segment, tier, status, deadline, created_at, submitted_at, client_id")
      .eq("accountant_id", id)
      .order("created_at", { ascending: false }),
    admin
      .from("wallet_transactions")
      .select("amount_pence, status")
      .eq("accountant_id", id),
    admin
      .from("withdrawal_requests")
      .select("id, amount_pence, status, account_name, sort_code, account_number, requested_at, paid_at")
      .eq("accountant_id", id)
      .order("requested_at", { ascending: false }),
  ]);

  const totalEarned = (tx ?? []).reduce((s, t) => s + t.amount_pence, 0);
  const available = (tx ?? [])
    .filter((t) => t.status === "available")
    .reduce((s, t) => s + t.amount_pence, 0);
  const pending = (tx ?? [])
    .filter((t) => t.status === "pending_withdrawal")
    .reduce((s, t) => s + t.amount_pence, 0);
  const paid = (tx ?? [])
    .filter((t) => t.status === "paid")
    .reduce((s, t) => s + t.amount_pence, 0);

  const clientIds = Array.from(
    new Set((cases ?? []).map((c) => c.client_id)),
  );
  const { data: clients } = clientIds.length
    ? await admin.from("users").select("id, email").in("id", clientIds)
    : { data: [] as { id: string; email: string }[] };
  const clientEmail = new Map((clients ?? []).map((c) => [c.id, c.email]));

  return (
    <DashboardShell
      eyebrow="Accountant"
      title={profile.name ?? user.email}
      description={user.email}
      name={me.name}
      email={me.email}
      role={me.role}
      subnav={<AdminNav active="accountants" counts={navCounts} />}
      bell={<Bell userId={me.id} role={me.role} />}
    >
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* Profile */}
        <aside className="card-sl p-6">
          <div className="flex flex-col items-center text-center">
            <Avatar
              path={profile.avatar_path}
              name={profile.name}
              email={user.email}
              size={96}
            />
            <div className="mt-3 text-lg font-semibold text-ink">
              {profile.name ?? user.email}
            </div>
            <div className="text-xs text-slate">{user.email}</div>
            <ApprovalBadge status={profile.approval_status} />
          </div>
          <dl className="mt-6 space-y-3 text-sm">
            <ProfileRow label="Contact" value={profile.contact_number} />
            <ProfileRow label="Company" value={profile.company_name} />
            <ProfileRow label="Company email" value={profile.company_email} />
            <ProfileRow label="Account status" value={user.status} />
          </dl>
        </aside>

        {/* Money + cases */}
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-4">
            <MiniStat label="Total earned" value={money(totalEarned)} />
            <MiniStat label="Available" value={money(available)} />
            <MiniStat label="Pending" value={money(pending)} />
            <MiniStat label="Withdrawn" value={money(paid)} />
          </div>

          {/* Cases handled */}
          <section className="card-sl p-6">
            <h2
              className="text-sm font-semibold uppercase tracking-wider text-slate"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Cases handled ({cases?.length ?? 0})
            </h2>
            {!cases || cases.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-slate">
                None yet.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-paper">
                {cases.map((c) => {
                  const seg = getSegment(c.segment);
                  const tier = getTier(c.tier);
                  return (
                    <li key={c.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                      <span
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white"
                        style={{ background: "linear-gradient(135deg, var(--navy), var(--sky))" }}
                        aria-hidden="true"
                      >
                        {seg?.numeral ?? "•"}
                      </span>
                      <Link
                        href={`/admin/cases/${c.id}`}
                        className="min-w-0 flex-1 hover:text-sky"
                      >
                        <div className="truncate font-semibold text-ink">
                          {seg?.title ?? c.segment} · {tier?.title ?? c.tier}
                        </div>
                        <div className="text-xs text-slate">
                          Client {clientEmail.get(c.client_id) ?? "."} · started{" "}
                          {formatDateTime(c.created_at)}
                        </div>
                      </Link>
                      <div className="flex flex-col items-end gap-1">
                        <StatusPill status={c.status} />
                        {c.deadline ? (
                          <DeadlinePill deadline={c.deadline} size="sm" />
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Withdrawal history */}
          <section className="card-sl p-6">
            <h2
              className="text-sm font-semibold uppercase tracking-wider text-slate"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Withdrawal history ({reqs?.length ?? 0})
            </h2>
            {!reqs || reqs.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-slate">
                No withdrawals yet.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-paper">
                {reqs.map((r) => (
                  <li key={r.id} className="flex items-center justify-between px-4 py-3 text-sm">
                    <div>
                      <div className="font-semibold text-ink">
                        {money(r.amount_pence)} · {r.account_name}
                      </div>
                      <div className="text-xs text-slate">
                        {r.sort_code} · {r.account_number} · requested{" "}
                        {formatDateTime(r.requested_at)}
                        {r.paid_at ? <> · paid {formatDateTime(r.paid_at)}</> : null}
                      </div>
                    </div>
                    <StatusPillLite status={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <div className="mt-8">
        <Link
          href="/admin/accountants"
          className="text-sm font-semibold text-navy-deep underline underline-offset-4 hover:text-sky"
        >
          ← Back to accountants
        </Link>
      </div>
    </DashboardShell>
  );
}

function ProfileRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-line pb-2 last:border-b-0 last:pb-0">
      <dt
        className="text-[11px] font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {label}
      </dt>
      <dd className="text-right text-ink">
        {value?.trim() ? value : <span className="text-slate italic">.</span>}
      </dd>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-sl p-4">
      <div
        className="text-[10px] font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {label}
      </div>
      <div
        className="mt-1 text-xl font-bold text-ink"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        {value}
      </div>
    </div>
  );
}

function ApprovalBadge({
  status,
}: {
  status: "pending" | "approved" | "rejected";
}) {
  const map = {
    approved: { label: "Approved", bg: "rgba(19,217,160,0.14)", color: "#0E9E77" },
    pending: { label: "Pending", bg: "rgba(217,159,25,0.14)", color: "#B57E12" },
    rejected: { label: "Rejected", bg: "rgba(220,38,38,0.12)", color: "#B91C1C" },
  }[status];
  return (
    <span
      className="mt-2 inline-flex items-center rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider"
      style={{ background: map.bg, color: map.color, fontFamily: "var(--font-mono)" }}
    >
      {map.label}
    </span>
  );
}

function StatusPillLite({ status }: { status: string }) {
  const isPaid = status === "paid";
  return (
    <span
      className="inline-flex items-center rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider"
      style={{
        background: isPaid ? "rgba(25,156,217,0.14)" : "rgba(217,159,25,0.14)",
        color: isPaid ? "var(--sky)" : "#B57E12",
        fontFamily: "var(--font-mono)",
      }}
    >
      {status}
    </span>
  );
}
