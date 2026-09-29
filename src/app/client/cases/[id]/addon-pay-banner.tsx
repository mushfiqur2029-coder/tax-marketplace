"use client";

import { useTransition, useState } from "react";
import { SLButton } from "@/components/sl-button";
import type { ActionResult } from "@/lib/action-result";

type Props = {
  addonId: string;
  amountPence: number;
  description: string;
  startCheckout: (addonId: string) => Promise<ActionResult>;
};

// A pay banner drawn in the same visual language as the ApproveAndFile
// action-required card — clearly a prompt the client shouldn't miss, sitting
// right in the flow of the case page. On submit the server action calls
// Stripe and redirects, so we only see the return value if it errored.
export function AddonPayBanner({
  addonId,
  amountPence,
  description,
  startCheckout,
}: Props) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const money = `£${(amountPence / 100).toFixed(2)}`;

  return (
    <div
      className="mb-6 flex flex-col gap-3 rounded-xl border p-5 sm:flex-row sm:items-center sm:justify-between"
      style={{
        background: "rgba(25,156,217,0.08)",
        borderColor: "rgba(25,156,217,0.45)",
      }}
    >
      <div className="min-w-0">
        <div
          className="text-[11px] font-semibold uppercase tracking-widest text-sky"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Add-on ready to pay
        </div>
        <div className="mt-1 text-base font-semibold text-ink">
          {money} · {description}
        </div>
        <p className="mt-1 text-xs text-slate">
          Your accountant added this on top of the base plan. Payment goes
          through Stripe — you&apos;ll come back here when it&apos;s done.
        </p>
        {error ? (
          <p className="mt-2 text-xs font-medium text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <form
        action={() => {
          setError(null);
          start(async () => {
            const res = await startCheckout(addonId);
            if (!res.ok) setError(res.error);
            // ok path: server action redirected to Stripe; nothing to do
          });
        }}
        className="shrink-0"
      >
        <SLButton type="submit" variant="primary" disabled={pending}>
          {pending ? "Redirecting…" : `Pay ${money}`}
        </SLButton>
      </form>
    </div>
  );
}
