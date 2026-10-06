"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

// In-page filter chip row on /client — swaps the Cases list between
// in-progress / completed / pending. Lives separately from the sidebar
// (that moved into the shared portal shell) because it's a page-level
// control, not navigation chrome.

type CasesFilter = "in_progress" | "completed" | "pending";

export type ClientCaseCounts = Record<CasesFilter, number>;

const CASE_FILTERS: { key: CasesFilter; label: string }[] = [
  { key: "in_progress", label: "In progress" },
  { key: "completed", label: "Completed" },
  { key: "pending", label: "Pending" },
];

export function ClientCasesFilter({
  active,
  counts,
}: {
  active: CasesFilter;
  counts?: ClientCaseCounts;
}) {
  const params = useSearchParams();
  return (
    <div className="mb-6 inline-flex rounded-full border border-line bg-paper p-1">
      {CASE_FILTERS.map((f) => {
        const isActive = active === f.key;
        const next = new URLSearchParams(params?.toString());
        next.set("view", f.key);
        const n = counts?.[f.key] ?? 0;
        return (
          <Link
            key={f.key}
            href={`/client?${next.toString()}`}
            aria-pressed={isActive}
            className={
              "inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition " +
              (isActive
                ? "bg-navy-deep text-white"
                : "text-slate hover:text-navy-deep")
            }
          >
            {f.label}
            {n > 0 ? (
              <span
                className={
                  "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold " +
                  (isActive ? "bg-white text-navy-deep" : "text-white")
                }
                style={
                  isActive
                    ? undefined
                    : { background: "linear-gradient(135deg, var(--sky), var(--mint))" }
                }
              >
                {n}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
