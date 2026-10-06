import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole, isPrimaryAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSegment } from "@/lib/segments";
import { getAllTiers } from "@/lib/service-catalog";
import { effectiveFeePence } from "@/lib/case/pricing";
import { companyNameFromAnswers } from "@/lib/case/company-label";
import {
  setClientStatusAction,
  getClientDeletionCheck,
  deleteClientAccountAction,
} from "@/app/admin/actions";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Avatar } from "@/components/avatar";
import { StatusPill } from "@/components/case/status-pill";
import { DeadlinePill } from "@/components/case/deadline-pill";
import { UrgentPill } from "@/components/case/urgent-pill";
import { formatDateTime } from "@/lib/format";
import { SuspendActions } from "./suspend-actions";
import { DeleteAccountCard } from "@/components/admin/delete-account-card";

export const dynamic = "force-dynamic";

const money = (pence: number) => `£${(pence / 100).toFixed(2)}`;

export default async function AdminClientDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await requireRole("admin");
  const callerIsPrimary = isPrimaryAdmin(me);
  const admin = createAdminClient();

  const [{ data: user }, { data: profile }] = await Promise.all([
    admin.from("users").select("id, email, status, created_at").eq("id", id).single(),
    admin
      .from("client_profiles")
      .select("user_id, name, contact_number, address, avatar_path")
      .eq("user_id", id)
      .maybeSingle(),
  ]);
  if (!user || user.status === undefined) notFound();

  // Guard the URL: this page is only meaningful for client users. Admin
  // reaching /admin/clients/<some-non-client-id> gets a 404.
  const { data: userRow } = await admin
    .from("users")
    .select("role")
    .eq("id", id)
    .single();
  if (!userRow || userRow.role !== "client") notFound();

  const { data: cases } = await admin
    .from("cases")
    .select(
      "id, segment, tier, status, stripe_payment_status, stripe_payment_id, deadline, created_at, submitted_at, accountant_id, is_urgent, urgent_fee_pence, custom_fee_pence, intake_answers",
    )
    .eq("client_id", id)
    .order("created_at", { ascending: false });

  const rows = cases ?? [];
  const paid = rows.filter((c) => c.stripe_payment_status === "succeeded");

  const tierMap = new Map(
    (
      await getAllTiers({ includeInactive: true, includeAdminCreateOnly: true })
    ).map((t) => [t.id as string, t]),
  );

  const totalPaidPence = paid.reduce((sum, c) => {
    return sum + effectiveFeePence(c, tierMap.get(c.tier) ?? null);
  }, 0);

  // Assigned accountant emails so the case rows can show them.
  const accIds = Array.from(
    new Set(rows.map((c) => c.accountant_id).filter((x): x is string => !!x)),
  );
  const { data: accs } = accIds.length
    ? await admin.from("users").select("id, email").in("id", accIds)
    : { data: [] as { id: string; email: string }[] };
  const accEmail = new Map((accs ?? []).map((a) => [a.id, a.email]));

  const setStatus = async (
    clientId: string,
    status: "active" | "suspended",
    note: string | null,
  ) => {
    "use server";
    return setClientStatusAction(clientId, status, note);
  };

  // Pre-check runs on the server so the "cannot delete" panel renders
  // immediately with the real counts. The server action re-checks on
  // submit so a stale page can't bypass the block.
  const deletionCheck = callerIsPrimary
    ? await getClientDeletionCheck(user.id)
    : null;
  const deleteAccount = async (targetUserId: string) => {
    "use server";
    return deleteClientAccountAction(targetUserId);
  };

  return (
    <>
      <AdminPageHeader
        eyebrow="Client"
        title={profile?.name ?? user.email}
        description={user.email}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
        {/* Profile */}
        <aside className="card-sl p-6">
          <div className="flex flex-col items-center text-center">
            <Avatar
              path={profile?.avatar_path ?? null}
              name={profile?.name ?? null}
              email={user.email}
              size={96}
            />
            <div className="mt-3 text-lg font-semibold text-ink">
              {profile?.name ?? user.email}
            </div>
            <div className="text-xs text-slate">{user.email}</div>
            <StatusBadge status={user.status} />
          </div>
          <dl className="mt-6 space-y-3 text-sm">
            <ProfileRow label="Contact" value={profile?.contact_number ?? null} />
            <ProfileRow label="Address" value={profile?.address ?? null} multiline />
            <ProfileRow label="Joined" value={formatDateTime(user.created_at)} />
          </dl>

          <div
            className="mt-6 border-t border-line pt-4"
          >
            <span
              className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-slate"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Account controls
            </span>
            <SuspendActions
              clientId={user.id}
              currentStatus={user.status}
              setStatus={setStatus}
            />
            <p className="mt-3 text-[11px] text-slate">
              Suspended clients stay signed-in with read-only access. They
              can&apos;t submit new cases, take payments, or approve filings
              until reinstated.
            </p>
            {callerIsPrimary && deletionCheck ? (
              <DeleteAccountCard
                targetUserId={user.id}
                targetEmail={user.email}
                roleLabel="client"
                summary={[
                  { label: "Cases (total)", value: deletionCheck.totalCases },
                  { label: "Paid cases", value: deletionCheck.paidCases },
                  { label: "Draft cases", value: deletionCheck.draftCases },
                  { label: "Documents", value: deletionCheck.documents },
                  { label: "Bookings", value: deletionCheck.bookings },
                  { label: "Enquiries", value: deletionCheck.enquiries },
                ]}
                blockReason={deletionCheck.blockReason}
                cascadeNote="All cases, documents, bookings, enquiries and messages this client created will be removed. Uploaded files are purged from storage."
                deleteAccount={deleteAccount}
              />
            ) : null}
          </div>
        </aside>

        {/* Cases + payments */}
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <MiniStat label="Cases" value={String(rows.length)} />
            <MiniStat label="Paid cases" value={String(paid.length)} />
            <MiniStat label="Total paid" value={money(totalPaidPence)} />
          </div>

          {/* Cases submitted */}
          <section className="card-sl p-6">
            <h2
              className="text-sm font-semibold uppercase tracking-wider text-slate"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Cases ({rows.length})
            </h2>
            {rows.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-slate">
                No cases yet.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-paper">
                {rows.map((c) => {
                  const seg = getSegment(c.segment);
                  const tier = tierMap.get(c.tier) ?? null;
                  const companyName = companyNameFromAnswers(
                    c.intake_answers,
                    c.segment,
                  );
                  return (
                    <li key={c.id} className="px-4 py-3 text-sm">
                      <div className="flex items-start gap-3">
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
                            {companyName ?? `${seg?.title ?? c.segment} · ${tier?.title ?? c.tier}`}
                          </div>
                          <div className="truncate text-xs text-slate">
                            {companyName ? (
                              <>
                                {seg?.title ?? c.segment} · {tier?.title ?? c.tier} ·{" "}
                              </>
                            ) : null}
                            {c.accountant_id
                              ? <>Accountant {accEmail.get(c.accountant_id) ?? "."}</>
                              : "Unassigned"}
                            {" · started "}
                            {formatDateTime(c.created_at)}
                          </div>
                        </Link>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-11">
                        <StatusPill status={c.status} />
                        {c.is_urgent ? <UrgentPill size="sm" /> : null}
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

          {/* Payment history — same shape as /client/payments */}
          <section className="card-sl p-6">
            <h2
              className="text-sm font-semibold uppercase tracking-wider text-slate"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Payments ({paid.length})
            </h2>
            {paid.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-slate">
                No payments yet.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-paper">
                {paid.map((c) => {
                  const seg = getSegment(c.segment);
                  const tier = tierMap.get(c.tier) ?? null;
                  return (
                    <li key={c.id} className="grid grid-cols-1 gap-1 px-4 py-3 text-sm sm:grid-cols-[1fr_auto]">
                      <div>
                        <div className="font-semibold text-ink">
                          {money(effectiveFeePence(c, tier))} · {seg?.title ?? c.segment} · {tier?.title ?? c.tier}
                        </div>
                        <div className="text-xs text-slate">
                          Submitted{" "}
                          {c.submitted_at ? formatDateTime(c.submitted_at) : "."}
                          {c.stripe_payment_id ? (
                            <>
                              {" · Stripe "}
                              <code className="rounded bg-cloud px-1 py-0.5 text-[10px] text-ink">
                                {c.stripe_payment_id}
                              </code>
                            </>
                          ) : null}
                        </div>
                      </div>
                      <Link
                        href={`/admin/cases/${c.id}`}
                        className="text-xs font-semibold text-navy-deep underline underline-offset-4 hover:text-sky sm:self-center sm:text-right"
                      >
                        View case
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function ProfileRow({
  label,
  value,
  multiline,
}: {
  label: string;
  value?: string | null;
  multiline?: boolean;
}) {
  return (
    <div className="border-b border-line pb-2 last:border-b-0 last:pb-0">
      <dt
        className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {label}
      </dt>
      <dd className={"text-ink " + (multiline ? "whitespace-pre-line" : "")}>
        {value?.trim() ? value : <span className="text-slate italic">—</span>}
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

function StatusBadge({
  status,
}: {
  status: "active" | "warned" | "suspended";
}) {
  const map = {
    active: { label: "Active", bg: "rgba(19,217,160,0.14)", color: "#0E9E77" },
    warned: { label: "Warned", bg: "rgba(217,159,25,0.14)", color: "#B57E12" },
    suspended: { label: "Suspended", bg: "rgba(220,38,38,0.12)", color: "#B91C1C" },
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
