"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type AccountantTab = "cases" | "income" | "profile";

const TABS: { key: AccountantTab; label: string; href: string }[] = [
  { key: "cases", label: "Cases", href: "/accountant" },
  { key: "income", label: "Income", href: "/accountant/wallet" },
  { key: "profile", label: "Account", href: "/accountant/profile" },
];

export function AccountantNav({ active }: { active?: AccountantTab }) {
  const pathname = usePathname();
  const derived =
    active ??
    (pathname?.startsWith("/accountant/wallet")
      ? "income"
      : pathname?.startsWith("/accountant/profile")
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
