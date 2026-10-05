"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SLButton } from "@/components/sl-button";

// Personal flow uses the four-step state machine. Limited-company
// collapses "prepared" into client_approval — the move from in_review is
// handled by the PrepareApprovalCard, so this map leaves in_review with
// no button and the component suppresses it.
const NEXT_PERSONAL: Record<string, { label: string; next: string } | null> = {
  submitted: { label: "Start review", next: "in_review" },
  in_review: { label: "Mark as prepared", next: "prepared" },
  prepared: { label: "Send for client approval", next: "client_approval" },
  client_approval: null,
  filed: { label: "Mark as complete", next: "complete" },
  complete: null,
  draft: null,
};

const NEXT_LIMITED_COMPANY: Record<
  string,
  { label: string; next: string } | null
> = {
  submitted: { label: "Start review", next: "in_review" },
  // in_review handled by PrepareApprovalCard — rendered elsewhere.
  in_review: null,
  // "prepared" doesn't exist on this flow but keep the map total.
  prepared: null,
  client_approval: null,
  filed: { label: "Mark as complete", next: "complete" },
  complete: null,
  draft: null,
};

type AdvanceResult = { ok: true } | { ok: false; error: string };

export function StatusTransition({
  current,
  advance,
  variant = "personal",
}: {
  current: string;
  advance: (next: string) => Promise<AdvanceResult>;
  variant?: "personal" | "limited_company";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const map = variant === "limited_company" ? NEXT_LIMITED_COMPANY : NEXT_PERSONAL;
  const step = map[current];

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
              const res = await advance(step.next);
              if (!res.ok) {
                setError(res.error);
                return;
              }
              // Status pill + available next-transition button both
              // read `current` from the parent server component —
              // refresh so the whole case page reflects the new status
              // without a manual reload.
              router.refresh();
            });
          }}
        >
          <SLButton
            type="submit"
            variant="primary"
            className="w-full sm:w-auto"
            disabled={pending}
          >
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
