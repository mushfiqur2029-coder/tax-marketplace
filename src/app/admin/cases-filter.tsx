"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

export type AdminCaseView =
  | "all"
  | "in_progress"
  | "completed"
  | "pending";

export type AdminCaseCounts = Record<AdminCaseView, number>;

const VIEWS: { key: AdminCaseView; label: string }[] = [
  { key: "all", label: "All" },
  { key: "in_progress", label: "In progress" },
  { key: "completed", label: "Completed" },
  { key: "pending", label: "Pending" },
];

// Same visual language as the accountant + client filter pills, but scoped
// to the admin's global case list.
export function AdminCasesFilter({
  active,
  counts,
}: {
  active: AdminCaseView;
  counts?: AdminCaseCounts;
}) {
  const params = useSearchParams();
  return (
    <div className="mb-6 inline-flex rounded-full border border-line bg-paper p-1">
      {VIEWS.map((v) => {
        const isActive = active === v.key;
        const next = new URLSearchParams(params?.toString());
        next.set("view", v.key);
        const n = counts?.[v.key] ?? 0;
        return (
          <Link
            key={v.key}
            href={`/admin?${next.toString()}`}
            aria-pressed={isActive}
            className={
              "inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition " +
              (isActive
                ? "bg-navy-deep text-white"
                : "text-slate hover:text-navy-deep")
            }
          >
            {v.label}
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
