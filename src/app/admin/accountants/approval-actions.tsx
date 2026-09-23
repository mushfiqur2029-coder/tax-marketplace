"use client";

import { useState, useTransition } from "react";
import { SLButton } from "@/components/sl-button";

export function ApprovalActions({
  accountantId,
  decide,
}: {
  accountantId: string;
  decide: (
    id: string,
    decision: "approved" | "rejected",
    note: string | null,
  ) => Promise<import("@/lib/action-result").ActionResult>;
}) {
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const go = (decision: "approved" | "rejected") => {
    setError(null);
    start(async () => {
      const res = await decide(accountantId, decision, note || null);
      if (res.ok) setNote("");
      else setError(res.error);
    });
  };

  return (
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Reason (optional)"
        className="input-sl !py-2 !text-[13px] sm:w-48"
      />
      <div className="flex gap-2">
        <SLButton
          type="button"
          variant="primary"
          onClick={() => go("approved")}
          disabled={pending}
          className="!text-[13px]"
        >
          Approve
        </SLButton>
        <button
          type="button"
          onClick={() => go("rejected")}
          disabled={pending}
          className="rounded-lg px-3 py-2 text-[13px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
      {error ? (
        <p className="text-xs font-medium text-red-700 sm:ml-2" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
