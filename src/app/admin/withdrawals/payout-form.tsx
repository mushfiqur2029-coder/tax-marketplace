"use client";

import { useRef, useState, useTransition } from "react";
import { SLButton } from "@/components/sl-button";

export function PayoutForm({
  requestId,
  markPaid,
}: {
  requestId: string;
  markPaid: (requestId: string, fd: FormData) => Promise<void>;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  return (
    <form
      action={(fd) => {
        setError(null);
        start(async () => {
          try {
            await markPaid(requestId, fd);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Failed.");
          }
        });
      }}
      className="flex flex-col items-stretch gap-2 sm:items-end"
    >
      <input
        ref={fileRef}
        type="file"
        name="receipt"
        required
        accept="application/pdf,image/*"
        className="sr-only"
        onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="btn-sl btn-sl-outline !text-[13px]"
        >
          {fileName ?? "Choose receipt"}
        </button>
        <SLButton
          type="submit"
          variant="primary"
          disabled={pending || !fileName}
          className="!text-[13px]"
        >
          {pending ? "Marking…" : "Mark as paid"}
        </SLButton>
      </div>
      {error ? (
        <p className="text-xs font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
