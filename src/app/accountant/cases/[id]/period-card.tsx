"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SLButton } from "@/components/sl-button";
import type { ActionResult } from "@/lib/action-result";

type Props = {
  periodStart: string | null;
  periodEnd: string | null;
  payrollRegistered: boolean;
  // Non-null → client has submitted their period docs. Clearing the
  // period dates is blocked at the server, but we also lock the inputs
  // visually so the accountant isn't surprised.
  periodDocsSubmittedAt: string | null;
  setPeriod: (input: {
    periodStart: string;
    periodEnd: string;
    payrollRegistered: boolean;
  }) => Promise<ActionResult>;
  clearPeriod: () => Promise<ActionResult>;
};

// Accounting period card. The accountant enters start+end dates and
// a payroll flag; saving opens the second-stage upload for the client
// (notification fires server-side). Dates can be revised freely until
// the client submits period docs — after that, the server locks edits.
export function PeriodCard({
  periodStart,
  periodEnd,
  payrollRegistered,
  periodDocsSubmittedAt,
  setPeriod,
  clearPeriod,
}: Props) {
  const router = useRouter();
  const [start, setStart] = useState(periodStart ?? "");
  const [end, setEnd] = useState(periodEnd ?? "");
  const [payroll, setPayroll] = useState(payrollRegistered);
  const [saving, startSave] = useTransition();
  const [clearing, startClear] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const locked = !!periodDocsSubmittedAt;
  const alreadySet = !!(periodStart && periodEnd);
  const dirty =
    start !== (periodStart ?? "") ||
    end !== (periodEnd ?? "") ||
    payroll !== payrollRegistered;

  const handleSave = () => {
    setError(null);
    startSave(async () => {
      const res = await setPeriod({
        periodStart: start,
        periodEnd: end,
        payrollRegistered: payroll,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  const handleClear = () => {
    setError(null);
    startClear(async () => {
      const res = await clearPeriod();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setStart("");
      setEnd("");
      setPayroll(false);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span
            className="text-[11px] font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Period start
          </span>
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            disabled={locked}
            className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink disabled:opacity-60"
          />
        </label>
        <label className="block">
          <span
            className="text-[11px] font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Period end
          </span>
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            disabled={locked}
            className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink disabled:opacity-60"
          />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={payroll}
          onChange={(e) => setPayroll(e.target.checked)}
          disabled={locked}
          className="h-4 w-4"
        />
        <span className="text-ink">
          Company is registered for PAYE
          <span className="ml-1 text-xs text-slate">
            (promotes the Period PAYE summary to required)
          </span>
        </span>
      </label>

      {locked ? (
        <p className="rounded-lg border border-line bg-paper px-3 py-2 text-xs text-slate">
          Client has already submitted period documents. Dates are locked.
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-lg px-3 py-2 text-sm font-medium text-red-700"
          style={{ background: "rgba(220,38,38,0.08)" }}
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <SLButton
          type="button"
          variant="primary"
          onClick={handleSave}
          disabled={saving || locked || !start || !end || (alreadySet && !dirty)}
        >
          {saving ? "Saving…" : alreadySet ? "Update period" : "Save period"}
        </SLButton>
        {alreadySet && !locked ? (
          <SLButton
            type="button"
            variant="ghost"
            onClick={handleClear}
            disabled={clearing}
          >
            {clearing ? "Clearing…" : "Clear"}
          </SLButton>
        ) : null}
      </div>
    </div>
  );
}
