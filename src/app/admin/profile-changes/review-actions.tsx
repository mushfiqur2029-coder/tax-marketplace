"use client";

import { useState, useTransition } from "react";
import { SLButton } from "@/components/sl-button";

export function ReviewActions({
  id,
  approve,
  reject,
}: {
  id: string;
  approve: (id: string, note: string | null) => Promise<void>;
  reject: (id: string, note: string | null) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const go = (fn: typeof approve) => {
    setError(null);
    start(async () => {
      try {
        await fn(id, note || null);
        setNote("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Update failed.");
      }
    });
  };

  return (
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Reason (optional)"
        className="input-sl !py-2 !text-[13px] sm:max-w-xs"
      />
      <div className="flex gap-2">
        <SLButton
          type="button"
          variant="primary"
          onClick={() => go(approve)}
          disabled={pending}
          className="!text-[13px]"
        >
          Approve
        </SLButton>
        <button
          type="button"
          onClick={() => go(reject)}
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
