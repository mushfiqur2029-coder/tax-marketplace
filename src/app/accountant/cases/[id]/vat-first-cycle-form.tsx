"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SLButton } from "@/components/sl-button";
import type { ActionResult } from "@/lib/action-result";

type Props = {
  frequency: "Monthly" | "Quarterly" | "Annually";
  openFirstCycle: (input: {
    periodEndDate: string;
  }) => Promise<ActionResult<{ cycleId: string }>>;
};

// First-period-end-date form. One field, one submit. The system
// computes start date (end minus one period), HMRC due date (end + 1m
// 7d) and label from the Section D frequency — accountant doesn't
// touch any of that.
export function VatFirstCycleForm({ frequency, openFirstCycle }: Props) {
  const router = useRouter();
  const [periodEnd, setPeriodEnd] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    setError(null);
    start(async () => {
      const res = await openFirstCycle({ periodEndDate: periodEnd });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate">
        Set the end date of the first VAT period. The next period, HMRC
        due date, and label are calculated from the client&apos;s
        Section D frequency ({frequency}) — set once, cycles continue
        automatically.
      </p>
      <label className="block">
        <span
          className="text-[11px] font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          First VAT period end
        </span>
        <input
          type="date"
          value={periodEnd}
          onChange={(e) => setPeriodEnd(e.target.value)}
          className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink"
        />
      </label>
      {error ? (
        <p
          role="alert"
          className="rounded-lg px-3 py-2 text-sm font-medium text-red-700"
          style={{ background: "rgba(220,38,38,0.08)" }}
        >
          {error}
        </p>
      ) : null}
      <SLButton
        type="button"
        variant="primary"
        onClick={handleSubmit}
        disabled={pending || !periodEnd}
      >
        {pending ? "Opening…" : "Open first VAT period"}
      </SLButton>
    </div>
  );
}
