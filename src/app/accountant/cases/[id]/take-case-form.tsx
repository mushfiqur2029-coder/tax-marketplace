"use client";

import { useState, useTransition } from "react";
import { SLButton } from "@/components/sl-button";

type TakeResult = { ok: true } | { ok: false; error: string };

export function TakeCaseForm({ take }: { take: () => Promise<TakeResult> }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <form
        action={() => {
          setError(null);
          start(async () => {
            const res = await take();
            if (!res.ok) setError(res.error);
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
