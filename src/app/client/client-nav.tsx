"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

type ClientTab = "cases" | "payments" | "profile";

const TABS: { key: ClientTab; label: string; href: string }[] = [
  { key: "cases", label: "Cases", href: "/client" },
  { key: "payments", label: "Payments", href: "/client/payments" },
  { key: "profile", label: "Profile", href: "/client/profile" },
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

const CASE_FILTERS: { key: CasesFilter; label: string }[] = [
  { key: "in_progress", label: "In progress" },
  { key: "completed", label: "Completed" },
  { key: "pending", label: "Pending" },
];

export function ClientCasesFilter({ active }: { active: CasesFilter }) {
  const params = useSearchParams();
  return (
    <div className="mb-6 inline-flex rounded-full border border-line bg-paper p-1">
      {CASE_FILTERS.map((f) => {
        const isActive = active === f.key;
        const next = new URLSearchParams(params?.toString());
        next.set("view", f.key);
        return (
          <Link
            key={f.key}
            href={`/client?${next.toString()}`}
            aria-pressed={isActive}
            className={
              "rounded-full px-4 py-1.5 text-xs font-semibold transition " +
              (isActive
                ? "bg-navy-deep text-white"
                : "text-slate hover:text-navy-deep")
            }
          >
            {f.label}
          </Link>
        );
      })}
    </div>
  );
}
