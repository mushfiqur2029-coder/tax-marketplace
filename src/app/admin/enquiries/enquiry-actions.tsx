"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SLButton } from "@/components/sl-button";
import type { ActionResult } from "@/lib/action-result";

type Props = {
  id: string;
  status: "new" | "contacted" | "closed";
  initialNotes: string;
  setStatus: (
    id: string,
    status: "new" | "contacted" | "closed",
    notes: string | null,
  ) => Promise<ActionResult>;
};

// Admin controls for a single enquiry card. Row-local state + per-
// action transition so saving notes on one row doesn't disable the
// buttons on others, and clicking Mark as contacted twice in a row
// doesn't fire the server action twice.
export function EnquiryActions({
  id,
  status,
  initialNotes,
  setStatus,
}: Props) {
  const router = useRouter();
  const [notes, setNotes] = useState<string>(initialNotes);
  const [pendingStatus, setPendingStatus] = useState<
    "new" | "contacted" | "closed" | null
  >(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedFlag, setSavedFlag] = useState(false);

  const go = (next: "new" | "contacted" | "closed", notesOverride?: string) => {
    if (pending) return;
    setError(null);
    setSavedFlag(false);
    setPendingStatus(next);
    start(async () => {
      const payload = notesOverride ?? notes;
      const res = await setStatus(id, next, payload.trim() === "" ? null : payload);
      setPendingStatus(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSavedFlag(true);
      // Refresh so the row moves between the New / Contacted /
      // Closed sections without a manual reload.
      router.refresh();
    });
  };

  const saveNotesOnly = () => go(status, notes);

  return (
    <div className="mt-4 border-t border-line pt-4 space-y-3">
      <label className="block">
        <span
          className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Admin notes
        </span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Follow-up notes — who you called, outcome, next step…"
          className="input-sl min-h-[60px] resize-y"
        />
      </label>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
        {status !== "contacted" ? (
          <SLButton
            type="button"
            variant="primary"
            className="w-full sm:w-auto"
            onClick={() => go("contacted")}
            disabled={pending}
          >
            {pendingStatus === "contacted" ? "Marking…" : "Mark as contacted"}
          </SLButton>
        ) : null}
        {status !== "closed" ? (
          <SLButton
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => go("closed")}
            disabled={pending}
          >
            {pendingStatus === "closed" ? "Closing…" : "Mark as closed"}
          </SLButton>
        ) : null}
        {status === "closed" ? (
          <SLButton
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => go("new")}
            disabled={pending}
          >
            {pendingStatus === "new" ? "Reopening…" : "Reopen"}
          </SLButton>
        ) : null}
        <button
          type="button"
          onClick={saveNotesOnly}
          disabled={pending || notes === initialNotes}
          className="text-xs font-semibold text-navy-deep underline underline-offset-4 hover:text-sky disabled:opacity-50 sm:ml-2"
        >
          Save notes only
        </button>
        {savedFlag ? (
          <span className="text-xs text-[#0E9E77] font-semibold">Saved ✓</span>
        ) : null}
      </div>
      {error ? (
        <p className="text-xs font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
