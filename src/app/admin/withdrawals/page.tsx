import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { DashboardShell } from "@/components/dashboard-shell";
import {
  markWithdrawalPaidAction,
  getReceiptSignedUrl,
} from "@/app/admin/actions";
import { PayoutForm } from "./payout-form";
import { ReceiptLink } from "@/app/accountant/wallet/receipt-link";
import { formatDateTime } from "@/lib/format";
import { AdminNav } from "@/app/admin/admin-nav";
import { getAdminNavCounts } from "@/app/admin/admin-counts";
import { Bell } from "@/components/bell";

export const dynamic = "force-dynamic";

function formatMoney(pence: number) {
  return `£${(pence / 100).toFixed(2)}`;
}

export default async function AdminWithdrawalsPage() {
  const me = await requireRole("admin");
  const admin = createAdminClient();

  const [{ data: reqs }, navCounts] = await Promise.all([
    admin
      .from("withdrawal_requests")
      .select(
        "id, accountant_id, amount_pence, account_name, sort_code, account_number, status, receipt_path, requested_at, paid_at",
      )
      .order("requested_at", { ascending: false }),
    getAdminNavCounts(),
  ]);

  const accIds = Array.from(
    new Set((reqs ?? []).map((r) => r.accountant_id)),
  );
  const { data: users } = accIds.length
    ? await admin.from("users").select("id, email").in("id", accIds)
    : { data: [] as { id: string; email: string }[] };
  const emailById = new Map((users ?? []).map((u) => [u.id, u.email]));

  const pending = (reqs ?? []).filter((r) => r.status === "pending");
  const paid = (reqs ?? []).filter((r) => r.status === "paid");

  const markPaid = async (requestId: string, fd: FormData) => {
    "use server";
    await markWithdrawalPaidAction(requestId, fd);
  };
  const signReceipt = async (path: string) => {
    "use server";
    return getReceiptSignedUrl(path);
  };

  return (
    <DashboardShell
      eyebrow="Admin console"
      title="Withdrawal requests"
      description="Pay from your own banking, then upload the receipt to close the request."
      name={me.name}
      email={me.email}
      role={me.role}
      subnav={<AdminNav active="withdrawals" counts={navCounts} />}
      bell={<Bell userId={me.id} role={me.role} />}
    >
      <section className="mb-10">
        <h2
          className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Pending ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="card-sl border-dashed p-6 text-center text-sm text-slate">
            No pending requests.
          </p>
        ) : (
          <ul className="grid gap-3">
            {pending.map((r) => (
              <li key={r.id} className="card-sl p-5">
                <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
                  <div>
                    <div className="text-base font-semibold text-ink">
                      {formatMoney(r.amount_pence)}. {emailById.get(r.accountant_id) ?? r.accountant_id}
                    </div>
                    <dl className="mt-2 text-xs text-slate">
                      <div><span className="font-semibold text-ink">{r.account_name}</span></div>
                      <div>Sort code: {r.sort_code}</div>
                      <div>Account: {r.account_number}</div>
                      <div className="mt-1">Requested {formatDateTime(r.requested_at)}</div>
                    </dl>
                  </div>
                  <PayoutForm requestId={r.id} markPaid={markPaid} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2
          className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Paid ({paid.length})
        </h2>
        {paid.length === 0 ? (
          <p className="card-sl border-dashed p-6 text-center text-sm text-slate">
            No completed payouts yet.
          </p>
        ) : (
          <ul className="grid gap-3">
            {paid.map((r) => (
              <li key={r.id} className="card-sl flex items-center justify-between p-5 text-sm">
                <div>
                  <div className="font-semibold text-ink">
                    {formatMoney(r.amount_pence)}. {emailById.get(r.accountant_id) ?? r.accountant_id}
                  </div>
                  <div className="text-xs text-slate">
                    {r.account_name} · {r.sort_code} · {r.account_number}
                    {r.paid_at ? <> · Paid {formatDateTime(r.paid_at)}</> : null}
                  </div>
                </div>
                {r.receipt_path ? (
                  <ReceiptLink path={r.receipt_path} sign={signReceipt} />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

    </DashboardShell>
  );
}
