"use client";

import { useRef, useState } from "react";
import { SLButton } from "@/components/sl-button";
import type { ActionResult } from "@/lib/action-result";

type Props = {
  action: (fd: FormData) => Promise<ActionResult>;
};

export function DocumentUploader({ action }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  return (
    <form
      action={async (fd) => {
        setError(null);
        setPending(true);
        const res = await action(fd);
        setPending(false);
        if (res.ok) {
          if (inputRef.current) inputRef.current.value = "";
          setFileName(null);
        } else {
          setError(res.error);
        }
      }}
      className="rounded-2xl border-2 border-dashed border-line p-6 text-center transition hover:border-sky/50"
    >
      <div
        className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl text-white"
        style={{
          background:
            "linear-gradient(135deg, var(--navy), var(--sky))",
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-ink">
        {fileName ?? "Choose a file to upload"}
      </p>
      <p className="mt-1 text-xs text-slate">PDF, image, or spreadsheet · up to 50 MB</p>

      <input
        ref={inputRef}
        type="file"
        name="file"
        required
        className="sr-only"
        onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
      />

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="btn-sl btn-sl-outline"
        >
          Choose file
        </button>
        <SLButton type="submit" variant="primary" disabled={pending || !fileName}>
          {pending ? "Uploading…" : "Upload"}
        </SLButton>
      </div>

      {error ? (
        <p className="mt-3 text-sm font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
