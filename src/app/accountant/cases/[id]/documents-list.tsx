"use client";

import { useState, useTransition } from "react";
import type { CaseDoc } from "@/lib/case";
import { formatDateTime } from "@/lib/format";

type Props = {
  docs: CaseDoc[];
  signUrl: (path: string) => Promise<string>;
};

export function DocumentsList({ docs, signUrl }: Props) {
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (docs.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-slate">
        No documents uploaded.
      </p>
    );
  }

  const open = (doc: CaseDoc) => {
    setBusyId(doc.id);
    start(async () => {
      try {
        const url = await signUrl(doc.file_url);
        window.open(url, "_blank", "noopener");
      } finally {
        setBusyId(null);
      }
    });
  };

  return (
    <ul className="divide-y divide-line rounded-xl border border-line bg-paper">
      {docs.map((d) => (
        <li key={d.id} className="flex items-center gap-3 px-4 py-3">
          <span
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white"
            style={{
              background: "linear-gradient(135deg, var(--navy), var(--sky))",
            }}
            aria-hidden="true"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-ink">{d.file_name}</div>
            <div className="text-xs text-slate">
              {formatDateTime(d.uploaded_at)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => open(d)}
            disabled={pending && busyId === d.id}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-navy-deep transition hover:bg-sky/10 disabled:opacity-50"
          >
            {pending && busyId === d.id ? "Opening…" : "Open"}
          </button>
        </li>
      ))}
    </ul>
  );
}
