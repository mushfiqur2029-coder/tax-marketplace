"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SLButton } from "@/components/sl-button";
import type { ActionResult } from "@/lib/action-result";
import type { VatFrequency } from "@/lib/vat/cycle";

type Props = {
  // The frequency currently stored on the case. Null means the client
  // picked "I don't know" (or left Section D blank), and the form
  // additionally prompts the accountant to confirm the frequency.
  frequency: VatFrequency | null;
  openFirstCycle: (input: {
    periodEndDate: string;
    frequency?: VatFrequency;
  }) => Promise<ActionResult<{ cycleId: string }>>;
};

// First-period-end-date form. Two paths:
//   • Client answered Section D with a concrete frequency → one input
//     (period end date). We display the frequency as context.
//   • Client said "I don't know" → add a frequency picker. The chosen
//     value is persisted back to intake_answers by the server action.
export function VatFirstCycleForm({ frequency, openFirstCycle }: Props) {
  const router = useRouter();
  const [periodEnd, setPeriodEnd] = useState("");
  const [freqChoice, setFreqChoice] = useState<VatFrequency | "">("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const needsFrequencyInput = frequency === null;
  const canSubmit =
    !!periodEnd && (!needsFrequencyInput || freqChoice !== "");

  const handleSubmit = () => {
    setError(null);
    start(async () => {
      const payload: {
        periodEndDate: string;
        frequency?: VatFrequency;
      } = { periodEndDate: periodEnd };
      if (needsFrequencyInput && freqChoice !== "") {
        payload.frequency = freqChoice;
      }
      const res = await openFirstCycle(payload);
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
        {needsFrequencyInput
          ? "The client picked \"I don't know\" for VAT return frequency, so pick it here. Your choice is saved back to Section D and used to compute every future period."
          : (
            <>
              Set the end date of the first VAT period. The next period,
              HMRC due date, and label are calculated from the
              client&apos;s Section D frequency ({frequency}) — set once,
              cycles continue automatically.
            </>
          )}
      </p>

      {needsFrequencyInput ? (
        <label className="block">
          <span
            className="text-[11px] font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            VAT return frequency
          </span>
          <select
            value={freqChoice}
            onChange={(e) =>
              setFreqChoice(e.target.value as VatFrequency | "")
            }
            className="input-sl mt-1"
          >
            <option value="">Choose one…</option>
            <option value="Monthly">Monthly</option>
            <option value="Quarterly">Quarterly</option>
            <option value="Annually">Annually</option>
          </select>
        </label>
      ) : null}

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
          className="input-sl mt-1"
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
        block
        onClick={handleSubmit}
        disabled={pending || !canSubmit}
      >
        {pending ? "Opening…" : "Open first VAT period"}
      </SLButton>
    </div>
  );
}
