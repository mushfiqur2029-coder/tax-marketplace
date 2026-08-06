"use client";

import { useTransition } from "react";
import type { CaseDoc } from "@/lib/case";
import { formatDateTime } from "@/lib/format";

type Props = {
  docs: CaseDoc[];
  onDelete: (docId: string) => Promise<void>;
};

export function DocumentList({ docs, onDelete }: Props) {
  const [pending, start] = useTransition();

  if (docs.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-slate">
        No documents uploaded yet.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-line rounded-xl border border-line bg-paper">
      {docs.map((d) => (
        <li key={d.id} className="flex items-center gap-3 px-4 py-3">
          <span
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white"
            style={{ background: "linear-gradient(135deg, var(--navy), var(--sky))" }}
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
            onClick={() => start(() => onDelete(d.id))}
            disabled={pending}
            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate transition hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
          >
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}
