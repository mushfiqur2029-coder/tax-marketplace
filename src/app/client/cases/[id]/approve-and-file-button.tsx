"use client";

import { useState, useTransition } from "react";
import { SLButton } from "@/components/sl-button";

type Props = {
  approve: () => Promise<void>;
};

// Shown on the client's case detail when status = client_approval. Kept as a
// distinct client component so it can own its own pending/error state without
// forcing the whole detail page into a client component.
export function ApproveAndFileButton({ approve }: Props) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div
      className="mb-8 rounded-2xl border p-5 sm:p-6"
      style={{
        background:
          "linear-gradient(135deg, rgba(25,156,217,0.08), rgba(19,217,160,0.10))",
        borderColor: "rgba(25,156,217,0.35)",
      }}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p
            className="text-[11px] font-bold uppercase tracking-widest text-navy-deep"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Your accountant is waiting
          </p>
          <p className="mt-1 text-sm font-semibold text-ink">
            The prepared return is ready for you to sign off.
          </p>
          <p className="mt-1 text-xs text-slate">
            Review the documents and chat above, then approve to file. Nothing
            is submitted to HMRC until you approve.
          </p>
        </div>
        <form
          action={() => {
            setError(null);
            start(async () => {
              try {
                await approve();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Approval failed.");
              }
            });
          }}
          className="shrink-0"
        >
          <SLButton type="submit" variant="primary" disabled={pending}>
            {pending ? "Approving…" : "Approve and file"}
          </SLButton>
        </form>
      </div>
      {error ? (
        <p
          className="mt-3 rounded-lg px-3 py-2 text-sm font-medium text-red-700"
          role="alert"
          style={{ background: "rgba(220,38,38,0.08)" }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
