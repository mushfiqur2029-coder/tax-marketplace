"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";

// Two-click destructive confirm. Lighter than the admin-removal
// modal because the stakes are lower (no payment, no financial
// history) but still deliberate — first click swaps the label to
// "Confirm delete", a 5-second window to click again, then the
// action fires. Click Cancel or let the window elapse to reset.

type Props = {
  caseId: string;
  deleteCase: (caseId: string) => Promise<ActionResult>;
};

export function DeleteStaleDraftButton({ caseId, deleteCase }: Props) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Auto-reset armed state after 5 seconds so an idle "Confirm"
  // doesn't sit there inviting a stray click.
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 5000);
    return () => window.clearTimeout(t);
  }, [armed]);

  const onClick = () => {
    if (!armed) {
      setArmed(true);
      setError(null);
      return;
    }
    start(async () => {
      const res = await deleteCase(caseId);
      if (!res.ok) {
        setError(res.error);
        setArmed(false);
        return;
      }
      setArmed(false);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {armed ? (
          <button
            type="button"
            onClick={() => setArmed(false)}
            className="rounded-full border border-line bg-paper px-3 py-1 text-[11px] font-semibold text-ink hover:border-sky/50"
          >
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClick}
          disabled={pending}
          className="rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition disabled:opacity-60"
          style={{
            background: armed
              ? "linear-gradient(135deg, #B91C1C, #F97316)"
              : "rgba(220,38,38,0.08)",
            color: armed ? "white" : "#B91C1C",
            fontFamily: "var(--font-mono)",
          }}
          aria-pressed={armed}
        >
          {pending
            ? "Deleting…"
            : armed
              ? "Confirm delete"
              : "Delete"}
        </button>
      </div>
      {error ? (
        <p
          role="alert"
          className="max-w-xs text-right text-[11px] font-medium text-red-700"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
