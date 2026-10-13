"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";

type Revealed = {
  accountName: string;
  sortCode: string;
  accountNumber: string;
};

type Props = {
  requestId: string;
  // Pre-masked display of the account number (last 4 digits only).
  // Keeps the shape of the parent card the same on first render; the
  // Reveal action replaces it with the real value on click.
  maskedAccountNumber: string;
  sortCode: string;
  reveal: (requestId: string) => Promise<ActionResult<Revealed>>;
};

// Mask-by-default + click-to-reveal for the withdrawal request's
// bank account number. Each reveal fires revealWithdrawalBankAction
// (admin/actions.ts) which writes an admin_actions row with action
// 'withdrawal_bank_revealed' - so "who looked at this account
// number and when" is in the audit log, not just in the UI.
export function RevealBankButton({
  requestId,
  maskedAccountNumber,
  sortCode,
  reveal,
}: Props) {
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onReveal = () => {
    setError(null);
    start(async () => {
      const res = await reveal(requestId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRevealed(res.data);
    });
  };

  if (revealed) {
    return (
      <div className="text-xs text-slate">
        <div>Sort code: {revealed.sortCode}</div>
        <div>Account: {revealed.accountNumber}</div>
        <div className="mt-1 text-[10px] uppercase tracking-wider text-[#B91C1C]" style={{ fontFamily: "var(--font-mono)" }}>
          Revealed. logged.
        </div>
      </div>
    );
  }

  return (
    <div className="text-xs text-slate">
      <div>Sort code: {sortCode}</div>
      <div>
        Account: <span className="font-mono">{maskedAccountNumber}</span>
      </div>
      <button
        type="button"
        onClick={onReveal}
        disabled={pending}
        className="mt-1 inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-navy-deep hover:border-sky/50 disabled:opacity-60"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {pending ? "Revealing." : "Reveal full number"}
      </button>
      {error ? (
        <p role="alert" className="mt-1 text-[11px] font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// Mask helper exported so the server component on the withdrawals
// page can render consistent "....1234" strings without duplicating
// the padding logic. Takes the full account number as stored
// (typically 8 digits for a UK bank account); returns the last 4
// digits with a 4-char dot prefix.
export function maskAccountNumber(raw: string): string {
  const trimmed = raw.replace(/\s/g, "");
  if (trimmed.length <= 4) return trimmed;
  return "...." + trimmed.slice(-4);
}
