"use client";

import Link from "next/link";

const TABS = [
  { key: "balance", label: "Wallet balance" },
  { key: "pending", label: "Pending" },
  { key: "withdrawn", label: "Withdrawn" },
] as const;

export function IncomeSubnav({
  active,
}: {
  active: "balance" | "pending" | "withdrawn";
}) {
  return (
    <div className="mb-6 inline-flex rounded-full border border-line bg-paper p-1">
      {TABS.map((t) => {
        const isActive = active === t.key;
        return (
          <Link
            key={t.key}
            href={`/accountant/wallet?view=${t.key}`}
            aria-pressed={isActive}
            className={
              "rounded-full px-4 py-1.5 text-xs font-semibold transition " +
              (isActive
                ? "bg-navy-deep text-white"
                : "text-slate hover:text-navy-deep")
            }
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
