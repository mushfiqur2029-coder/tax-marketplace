"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SLButton } from "@/components/sl-button";

type TakeResult = { ok: true } | { ok: false; error: string };

export function TakeCaseForm({ take }: { take: () => Promise<TakeResult> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <form
        action={() => {
          setError(null);
          start(async () => {
            const res = await take();
            if (res.ok) {
              // Taking the case flips every panel on the page: the
              // "Take this case" button goes away, status transition
              // appears, the chat opens up. Refresh to re-render.
              router.refresh();
            } else setError(res.error);
          });
        }}
      >
        <SLButton
          type="submit"
          variant="primary"
          className="w-full sm:w-auto"
          disabled={pending}
        >
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
