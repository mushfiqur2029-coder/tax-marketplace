"use client";

import { useState, useTransition } from "react";
import { SLButton } from "@/components/sl-button";

const NEXT: Record<string, { label: string; next: string } | null> = {
  submitted: { label: "Start review", next: "in_review" },
  in_review: { label: "Mark as prepared", next: "prepared" },
  prepared: { label: "Send for client approval", next: "client_approval" },
  client_approval: null,
  filed: { label: "Mark as complete", next: "complete" },
  complete: null,
  draft: null,
};

export function StatusTransition({
  current,
  advance,
}: {
  current: string;
  advance: (next: string) => Promise<void>;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const step = NEXT[current];

  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm text-slate">
        Current status:{" "}
        <span className="font-semibold text-ink">
          {prettyStatus(current)}
        </span>
      </p>

      {step ? (
        <form
          action={() => {
            setError(null);
            start(async () => {
              try {
                await advance(step.next);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Update failed.");
              }
            });
          }}
        >
          <SLButton type="submit" variant="primary" disabled={pending}>
            {pending ? "Updating…" : step.label}
          </SLButton>
        </form>
      ) : (
        <p className="text-sm text-slate">
          {current === "complete"
            ? "Case complete. Nice."
            : current === "client_approval"
              ? "Waiting on the client to approve and file. You can't move this forward from your side — this is by design so nothing gets filed without their explicit sign-off."
              : "No further transitions from here."}
        </p>
      )}

      {error ? (
        <p className="text-sm font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function prettyStatus(s: string) {
  switch (s) {
    case "in_review":
      return "In review";
    case "client_approval":
      return "Awaiting client approval";
    default:
      return s.charAt(0).toUpperCase() + s.slice(1);
  }
}
