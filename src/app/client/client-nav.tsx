"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

type ClientTab = "cases" | "payments" | "profile";

const TABS: { key: ClientTab; label: string; href: string }[] = [
  { key: "cases", label: "Cases", href: "/client" },
  { key: "payments", label: "Payments", href: "/client/payments" },
  { key: "profile", label: "Account", href: "/client/profile" },
];

export function ClientNav({ active }: { active?: ClientTab }) {
  const pathname = usePathname();
  const derived =
    active ??
    (pathname?.startsWith("/client/payments")
      ? "payments"
      : pathname?.startsWith("/client/profile")
        ? "profile"
        : "cases");

  return (
    <nav className="flex gap-1 overflow-x-auto py-2">
      {TABS.map((t) => {
        const isActive = derived === t.key;
        return (
          <Link
            key={t.key}
            href={t.href}
            className={
              "shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition " +
              (isActive
                ? "bg-navy-deep text-white"
                : "text-slate hover:text-navy-deep")
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

// Sub-nav specifically for the Cases page, so the filter is a URL param.
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
