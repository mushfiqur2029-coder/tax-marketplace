"use client";

import { useTransition, useState } from "react";
import { SLButton } from "@/components/sl-button";
import type { ActionResult } from "@/lib/action-result";

type Props = {
  caseId: string;
  balancePence: number;
  depositPence: number;
  totalPence: number;
  startBalanceCheckout: (caseId: string) => Promise<ActionResult>;
};

// Balance-due banner for the two-stage bespoke flow. Shown on the
// client case page while cases.status = 'client_approval' and
// balance_payment_status != 'succeeded'. First path through the
// balance checkout runs inside approveAndFileAction (triggered the
// moment the client clicks Approve) so this banner is the retry
// surface for a client who closed the Stripe tab before paying.
// Same visual language as AddonPayBanner so the "money owed" cue
// reads consistently.
export function BalancePayBanner({
  caseId,
  balancePence,
  depositPence,
  totalPence,
  startBalanceCheckout,
}: Props) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const balanceLabel = `£${(balancePence / 100).toLocaleString("en-GB")}`;
  const depositLabel = `£${(depositPence / 100).toLocaleString("en-GB")}`;
  const totalLabel = `£${(totalPence / 100).toLocaleString("en-GB")}`;

  return (
    <div
      className="mb-6 flex flex-col gap-3 rounded-xl border p-5 sm:flex-row sm:items-center sm:justify-between"
      style={{
        background: "rgba(220,38,38,0.08)",
        borderColor: "rgba(220,38,38,0.45)",
      }}
    >
      <div className="min-w-0">
        <div
          className="text-[11px] font-semibold uppercase tracking-widest"
          style={{ fontFamily: "var(--font-mono)", color: "#B91C1C" }}
        >
          Balance due to complete filing
        </div>
        <div className="mt-1 text-base font-semibold text-ink">
          {balanceLabel} outstanding
        </div>
        <p className="mt-1 text-xs text-slate">
          You approved the prepared work. Pay the balance of {balanceLabel} to
          complete filing. Deposit paid at engagement: {depositLabel}. Total
          fee: {totalLabel}.
        </p>
        {error ? (
          <p className="mt-2 text-xs font-medium text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <form
        action={() => {
          setError(null);
          start(async () => {
            const res = await startBalanceCheckout(caseId);
            if (!res.ok) setError(res.error);
            // ok path: server action redirected to Stripe
          });
        }}
        className="shrink-0"
      >
        <SLButton type="submit" variant="primary" disabled={pending}>
          {pending ? "Redirecting…" : `Pay ${balanceLabel}`}
        </SLButton>
      </form>
    </div>
  );
}
