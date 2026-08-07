import Link from "next/link";
import { requireApprovedAccountant } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/dashboard-shell";
import { requestWithdrawalAction } from "./actions";
import { WithdrawalRequestForm } from "./withdrawal-form";
import { ReceiptLink } from "./receipt-link";
import { getReceiptSignedUrl } from "@/app/admin/actions";
import { formatDateTime } from "@/lib/format";
import { AccountantNav } from "@/app/accountant/accountant-nav";
import { IncomeSubnav } from "./income-subnav";

export const dynamic = "force-dynamic";

function formatMoney(pence: number) {
  return `£${(pence / 100).toFixed(2)}`;
}

export default async function WalletPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view: viewRaw } = await searchParams;
  const view: "balance" | "pending" | "withdrawn" =
    viewRaw === "pending" || viewRaw === "withdrawn" ? viewRaw : "balance";

  const me = await requireApprovedAccountant();
  const supabase = await createClient();

  const [{ data: txs }, { data: reqs }] = await Promise.all([
    supabase
      .from("wallet_transactions")
      .select("id, case_id, type, amount_pence, status, withdrawal_request_id, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("withdrawal_requests")
      .select("id, amount_pence, account_name, sort_code, account_number, status, receipt_path, requested_at, paid_at")
      .order("requested_at", { ascending: false }),
  ]);

  const available = (txs ?? [])
    .filter((t) => t.status === "available")
    .reduce((sum, t) => sum + t.amount_pence, 0);
  const pending = (txs ?? [])
    .filter((t) => t.status === "pending_withdrawal")
    .reduce((sum, t) => sum + t.amount_pence, 0);
  const paid = (txs ?? [])
    .filter((t) => t.status === "paid")
    .reduce((sum, t) => sum + t.amount_pence, 0);

  const request = async (input: Parameters<typeof requestWithdrawalAction>[0]) => {
    "use server";
    await requestWithdrawalAction(input);
  };
  const signReceipt = async (path: string) => {
    "use server";
    return getReceiptSignedUrl(path);
  };

  const paidReqs = (reqs ?? []).filter((r) => r.status === "paid");
  const pendingReqs = (reqs ?? []).filter((r) => r.status === "pending");

  const reqsView =
    view === "pending"
      ? {
          list: pendingReqs,
          title: "Pending withdrawals",
          empty: "No pending withdrawals.",
        }
      : view === "withdrawn"
        ? {
            list: paidReqs,
            title: "Withdrawn",
            empty: "No withdrawals paid out yet.",
          }
        : {
            list: reqs ?? [],
            title: "Withdrawal history",
            empty: "No withdrawals yet.",
          };

  return (
    <DashboardShell
      eyebrow="Accountant income"
      title="Earnings and payouts"
      description="You earn 50% of each case fee. Request a withdrawal to your bank when you're ready."
      name={me.name}
      email={me.email}
      role={me.role}
      subnav={<AccountantNav active="income" />}
    >
      <IncomeSubnav active={view} />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard label="Available" pence={available} tone="mint" />
        <StatCard label="Pending payout" pence={pending} tone="sky" />
        <StatCard label="Paid out" pence={paid} tone="slate" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="card-sl p-6 sm:p-8">
          <h3
            className="text-sm font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Transactions ({txs?.length ?? 0})
          </h3>
          {!txs || txs.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-slate">
              Nothing yet. Complete a case to earn 50% of the fee.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-paper">
              {txs.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between px-4 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-ink">
                      {t.type === "earning" ? "Earning" : "Withdrawal"}
                    </div>
                    <div className="text-xs text-slate">
                      {formatDateTime(t.created_at)}
                      {t.case_id ? (
                        <>
                          {" · "}
                          <Link
                            href={`/accountant/cases/${t.case_id}`}
                            className="underline underline-offset-2 hover:text-sky"
                          >
                            case
                          </Link>
                        </>
                      ) : null}
                      {t.withdrawal_request_id ? (
                        <>
                          {" · request "}
                          <span className="font-mono">
                            {t.withdrawal_request_id.slice(0, 8)}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={t.status} />
                    <div
                      className="text-right font-bold text-ink"
                      style={{ fontFamily: "var(--font-heading)" }}
                    >
                      {formatMoney(t.amount_pence)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <h3
            className="mt-8 text-sm font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {reqsView.title} ({reqsView.list.length})
          </h3>
          {reqsView.list.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-slate">
              {reqsView.empty}
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-paper">
              {reqsView.list.map((r) => (
                <li key={r.id} className="grid grid-cols-1 gap-1 px-4 py-3 text-sm sm:grid-cols-[1fr_auto]">
                  <div>
                    <div className="font-semibold text-ink">
                      {formatMoney(r.amount_pence)} → {r.account_name}
                    </div>
                    <div className="text-xs text-slate">
                      {r.sort_code} · {r.account_number}
                    </div>
                    <div className="text-xs text-slate">
                      Requested {formatDateTime(r.requested_at)}
                      {r.paid_at ? (
                        <> · Paid {formatDateTime(r.paid_at)}</>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <StatusBadge status={r.status} />
                    {r.receipt_path ? (
                      <ReceiptLink path={r.receipt_path} sign={signReceipt} />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="card-sl p-6">
          <span className="eyebrow">Request a withdrawal</span>
          <p className="mt-2 text-xs text-slate">
            Sends your entire available balance to the account below. Sterling
            Ledger will confirm once payment has been made.
          </p>
          <div className="mt-4">
            <WithdrawalRequestForm
              available={available}
              request={request}
            />
          </div>
        </aside>
      </div>

      <div className="mt-8">
        <Link href="/accountant" className="text-sm font-semibold text-navy-deep underline underline-offset-4 hover:text-sky">
          ← Back to dashboard
        </Link>
      </div>
    </DashboardShell>
  );
}

function StatCard({
  label,
  pence,
  tone,
}: {
  label: string;
  pence: number;
  tone: "mint" | "sky" | "slate";
}) {
  const toneStyle: React.CSSProperties =
    tone === "mint"
      ? { background: "rgba(19,217,160,0.10)", color: "#0E7B57" }
      : tone === "sky"
        ? { background: "rgba(25,156,217,0.10)", color: "var(--sky)" }
        : { background: "var(--cloud)", color: "var(--slate)" };
  return (
    <div className="card-sl p-5">
      <div
        className="text-[11px] font-semibold uppercase tracking-wider"
        style={{ ...toneStyle, background: "transparent", fontFamily: "var(--font-mono)" }}
      >
        {label}
      </div>
      <div
        className="mt-2 text-3xl font-bold text-ink"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        {formatMoney(pence)}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; color: string }> = {
    available: { label: "Available", bg: "rgba(19,217,160,0.14)", color: "#0E9E77" },
    pending_withdrawal: { label: "Pending", bg: "rgba(217,159,25,0.14)", color: "#B57E12" },
    paid: { label: "Paid", bg: "rgba(25,156,217,0.14)", color: "var(--sky)" },
    pending: { label: "Pending", bg: "rgba(217,159,25,0.14)", color: "#B57E12" },
  };
  const s = map[status] ?? { label: status, bg: "var(--cloud)", color: "var(--slate)" };
  return (
    <span
      className="inline-flex items-center rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider"
      style={{ background: s.bg, color: s.color, fontFamily: "var(--font-mono)" }}
    >
      {s.label}
    </span>
  );
}
