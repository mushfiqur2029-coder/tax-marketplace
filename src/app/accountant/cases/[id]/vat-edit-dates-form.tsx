"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SLButton } from "@/components/sl-button";
import type { ActionResult } from "@/lib/action-result";

type Props = {
  cycleId: string;
  initialStart: string;
  initialEnd: string;
  disabled?: boolean;
  editDates: (
    cycleId: string,
    input: { periodStart: string; periodEnd: string },
  ) => Promise<ActionResult>;
};

// Manual-override form. Normally hidden behind a disclosure so the
// accountant doesn't accidentally retype dates on cycles the system
// generated — opens on click, lets them nudge the dates for the
// current (unfiled) cycle only.
export function VatEditDatesForm({
  cycleId,
  initialStart,
  initialEnd,
  disabled,
  editDates,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (disabled) return null;

  const dirty = start !== initialStart || end !== initialEnd;
  const handleSave = () => {
    setError(null);
    startTransition(async () => {
      const res = await editDates(cycleId, {
        periodStart: start,
        periodEnd: end,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-slate underline underline-offset-4 hover:text-navy-deep"
      >
        Edit dates
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-line bg-paper p-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span
            className="text-[10px] font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Period start
          </span>
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="input-sl mt-1 bg-white"
          />
        </label>
        <label className="block">
          <span
            className="text-[10px] font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Period end
          </span>
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="input-sl mt-1 bg-white"
          />
        </label>
      </div>
      {error ? (
        <p className="mt-2 text-xs font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:gap-2">
        <SLButton
          type="button"
          variant="primary"
          className="w-full sm:w-auto"
          onClick={handleSave}
          disabled={pending || !dirty}
        >
          {pending ? "Saving…" : "Save dates"}
        </SLButton>
        <SLButton
          type="button"
          variant="ghost"
          className="w-full sm:w-auto"
          onClick={() => {
            setOpen(false);
            setStart(initialStart);
            setEnd(initialEnd);
            setError(null);
          }}
          disabled={pending}
        >
          Cancel
        </SLButton>
      </div>
    </div>
  );
}
