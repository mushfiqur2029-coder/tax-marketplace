"use client";

import { useState, useTransition } from "react";
import { SLButton } from "@/components/sl-button";
import type { ActionResult } from "@/lib/action-result";

type Props = {
  amountLabel: string;
  start: () => Promise<ActionResult>;
};

// The server action redirects to Stripe on success (never resolves), so the
// only case where the promise settles is a validation/DB failure — surface
// the error inline instead of letting it bubble as a Next.js digest.
export function PayButton({ amountLabel, start }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={() => {
        setError(null);
        startTransition(async () => {
          const res = await start();
          if (!res.ok) setError(res.error);
        });
      }}
      className="mt-6"
    >
      <SLButton type="submit" variant="primary" block disabled={pending}>
        {pending ? "Starting…" : `Pay ${amountLabel} with card`}
      </SLButton>
      {error ? (
        <p
          className="mt-3 rounded-lg px-3 py-2 text-sm font-medium text-red-700"
          role="alert"
          style={{ background: "rgba(220,38,38,0.08)" }}
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}
