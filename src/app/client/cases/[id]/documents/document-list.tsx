"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CaseDoc } from "@/lib/case";
import { formatDateTime } from "@/lib/format";
import type { ActionResult } from "@/lib/action-result";

type Props = {
  docs: CaseDoc[];
  onDelete: (docId: string) => Promise<ActionResult>;
};

export function DocumentList({ docs, onDelete }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  // Per-doc removing set: a single useTransition would disable every
  // Remove in the list on any click, and still wouldn't stop a double-
  // click on the same row from firing twice (the second click lands
  // before the transition starts). Tracking by id guarantees exactly
  // one delete per button click.
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());

  if (docs.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-slate">
        No documents uploaded yet.
      </p>
    );
  }

  const handleDelete = (docId: string) => {
    if (removingIds.has(docId)) return;
    setError(null);
    setRemovingIds((prev) => {
      const next = new Set(prev);
      next.add(docId);
      return next;
    });
    void (async () => {
      try {
        const res = await onDelete(docId);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        // The page is a server component — refresh pulls the fresh
        // doc list so the row disappears immediately rather than
        // waiting for a manual reload.
        router.refresh();
      } finally {
        setRemovingIds((prev) => {
          if (!prev.has(docId)) return prev;
          const next = new Set(prev);
          next.delete(docId);
          return next;
        });
      }
    })();
  };

  return (
    <>
      <ul className="divide-y divide-line rounded-xl border border-line bg-paper">
        {docs.map((d) => {
          const isRemoving = removingIds.has(d.id);
          return (
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
                onClick={() => handleDelete(d.id)}
                disabled={isRemoving}
                className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate transition hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
              >
                {isRemoving ? "Removing…" : "Remove"}
              </button>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p className="mt-2 text-xs font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
