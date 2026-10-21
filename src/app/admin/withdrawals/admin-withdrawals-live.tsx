"use client";

import { useMemo } from "react";
import { AdminSearchFilter } from "@/components/admin/admin-search-filter";
import { useLiveList } from "@/lib/realtime-live-merge";
import { PayoutForm } from "./payout-form";
import { ReceiptLink } from "@/app/accountant/wallet/receipt-link";
import { formatDateTime } from "@/lib/format";
import { RevealBankButton } from "./reveal-bank-button";
import { maskAccountNumber } from "./mask";
import type { ActionResult } from "@/lib/action-result";

export type WithdrawalRow = {
  id: string;
  accountant_id: string;
  amount_pence: number;
  account_name: string;
  sort_code: string;
  account_number: string;
  status: string;
  receipt_path: string | null;
  requested_at: string;
  paid_at: string | null;
};

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

export function AdminWithdrawalsLive({
  initial,
  emailById,
  markPaid,
  signReceipt,
  revealBank,
}: {
  initial: WithdrawalRow[];
  emailById: Record<string, string>;
  markPaid: (requestId: string, fd: FormData) => Promise<ActionResult>;
  signReceipt: (path: string) => Promise<ActionResult<string>>;
  revealBank: (requestId: string) => Promise<ActionResult<{ accountName: string; sortCode: string; accountNumber: string }>>;
}) {
  const rows = useLiveList<WithdrawalRow>(initial, {
    table: "withdrawal_requests",
    channel: "admin-withdrawals-live",
    map: (row) => ({
      id: row.id as string,
      accountant_id: row.accountant_id as string,
      amount_pence: Number(row.amount_pence ?? 0),
      account_name: (row.account_name as string) ?? "",
      sort_code: (row.sort_code as string) ?? "",
      account_number: (row.account_number as string) ?? "",
      status: row.status as string,
      receipt_path: (row.receipt_path as string | null) ?? null,
      requested_at: row.requested_at as string,
      paid_at: (row.paid_at as string | null) ?? null,
    }),
  });

  const groups = useMemo(() => {
    const pending = rows.filter((r) => r.status === "pending");
    const paid = rows.filter((r) => r.status === "paid");
    return [
      {
        key: "pending",
        title: "Pending",
        emptyLine: "No pending requests.",
        items: pending.map((r) => ({
          searchText: [emailById[r.accountant_id], r.account_name, r.sort_code]
            .filter(Boolean)
            .join(" "),
          node: (
            <li key={r.id} className="card-sl p-5">
              <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
                <div>
                  <div className="text-base font-semibold text-ink">
                    {formatMoney(r.amount_pence)} &middot;{" "}
                    {emailById[r.accountant_id] ?? r.accountant_id}
                  </div>
                  <dl className="mt-2 text-xs text-slate">
                    <div>
                      <span className="font-semibold text-ink">
                        {r.account_name}
                      </span>
                    </div>
                    <RevealBankButton
                      requestId={r.id}
                      maskedAccountNumber={maskAccountNumber(r.account_number)}
                      sortCode={r.sort_code}
                      reveal={revealBank}
                    />
                    <div className="mt-1">
                      Requested {formatDateTime(r.requested_at)}
                    </div>
                  </dl>
                </div>
                <PayoutForm requestId={r.id} markPaid={markPaid} />
              </div>
            </li>
          ),
        })),
      },
      {
        key: "paid",
        title: "Paid",
        emptyLine: "No completed payouts yet.",
        items: paid.map((r) => ({
          searchText: [emailById[r.accountant_id], r.account_name, r.sort_code]
            .filter(Boolean)
            .join(" "),
          node: (
            <li
              key={r.id}
              className="card-sl flex items-center justify-between p-5 text-sm"
            >
              <div>
                <div className="font-semibold text-ink">
                  {formatMoney(r.amount_pence)} &middot;{" "}
                  {emailById[r.accountant_id] ?? r.accountant_id}
                </div>
                <div className="text-xs text-slate">
                  {r.account_name} &middot; {r.sort_code} &middot;{" "}
                  <span className="font-mono">
                    {maskAccountNumber(r.account_number)}
                  </span>
                  {r.paid_at ? <> &middot; Paid {formatDateTime(r.paid_at)}</> : null}
                </div>
                <div className="mt-1">
                  <RevealBankButton
                    requestId={r.id}
                    maskedAccountNumber={maskAccountNumber(r.account_number)}
                    sortCode={r.sort_code}
                    reveal={revealBank}
                  />
                </div>
              </div>
              {r.receipt_path ? (
                <ReceiptLink path={r.receipt_path} sign={signReceipt} />
              ) : null}
            </li>
          ),
        })),
      },
    ];
  }, [rows, emailById, markPaid, signReceipt, revealBank]);

  return (
    <AdminSearchFilter
      placeholder="Search by email, account name or sort code"
      ariaLabel="Search withdrawal requests"
      groups={groups}
    />
  );
}
