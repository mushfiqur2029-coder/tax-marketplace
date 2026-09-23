"use client";

import { useState, useTransition } from "react";
import { SLButton } from "@/components/sl-button";

type Props = {
  clientId: string;
  currentStatus: "active" | "warned" | "suspended";
  setStatus: (
    id: string,
    status: "active" | "suspended",
    note: string | null,
  ) => Promise<void>;
};

// Toggle button that mirrors the accountant-detail approve/reject pattern.
// If the client is currently active (or warned), the button suspends. If
// they're suspended, the button reinstates.
export function SuspendActions({ clientId, currentStatus, setStatus }: Props) {
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isSuspended = currentStatus === "suspended";
  const next: "active" | "suspended" = isSuspended ? "active" : "suspended";
  const label = isSuspended ? "Reinstate" : "Suspend";

  const go = () => {
    setError(null);
    start(async () => {
      try {
        await setStatus(clientId, next, note || null);
        setNote("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Update failed.");
      }
    });
  };

  return (
    <div className="space-y-2">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Reason (optional)"
        className="input-sl !py-2 !text-[13px]"
      />
      <SLButton
        type="button"
        variant={isSuspended ? "primary" : "outline"}
        onClick={go}
        disabled={pending}
        className={
          "!text-[13px] " +
          (isSuspended
            ? ""
            : "!border-red-300 !text-red-700 hover:!bg-red-50")
        }
        block
      >
        {pending ? "Updating…" : label}
      </SLButton>
      {error ? (
        <p className="text-xs font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
