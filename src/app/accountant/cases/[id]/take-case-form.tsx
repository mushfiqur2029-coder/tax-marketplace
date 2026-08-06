"use client";

import { useState, useTransition } from "react";
import { SLButton } from "@/components/sl-button";

export function TakeCaseForm({ take }: { take: () => Promise<void> }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <form
        action={() => {
          setError(null);
          start(async () => {
            try {
              await take();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not take case.");
            }
          });
        }}
      >
        <SLButton type="submit" variant="primary" disabled={pending}>
          {pending ? "Taking…" : "Take this case"}
        </SLButton>
      </form>
      {error ? (
        <p className="text-sm font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
