"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AdminNavCounts } from "./admin-counts";

export type AdminTab =
  | "dashboard"
  | "accountants"
  | "withdrawals"
  | "admins"
  | "profile-changes"
  | "profile";

type TabDef = {
  key: AdminTab;
  label: string;
  href: string;
  countKey?: keyof AdminNavCounts;
};

const TABS: TabDef[] = [
  { key: "dashboard", label: "Dashboard", href: "/admin" },
  { key: "accountants", label: "Accountants", href: "/admin/accountants", countKey: "accountants" },
  { key: "withdrawals", label: "Withdrawals", href: "/admin/withdrawals", countKey: "withdrawals" },
  { key: "admins", label: "Admins", href: "/admin/admins" },
  { key: "profile-changes", label: "Profile changes", href: "/admin/profile-changes", countKey: "profileChanges" },
  { key: "profile", label: "Account", href: "/admin/profile" },
];

function tabFromPath(pathname: string | null): AdminTab {
  if (!pathname) return "dashboard";
  if (pathname.startsWith("/admin/accountants")) return "accountants";
  if (pathname.startsWith("/admin/withdrawals")) return "withdrawals";
  if (pathname.startsWith("/admin/admins")) return "admins";
  if (pathname.startsWith("/admin/profile-changes")) return "profile-changes";
  if (pathname.startsWith("/admin/profile")) return "profile";
  return "dashboard";
}

type Props = {
  active?: AdminTab;
  counts?: AdminNavCounts;
};

export function AdminNav({ active, counts }: Props) {
  const pathname = usePathname();
  const derived = active ?? tabFromPath(pathname);

  return (
    <nav className="flex gap-1 overflow-x-auto py-2">
      {TABS.map((t) => {
        const isActive = derived === t.key;
        const count = t.countKey && counts ? counts[t.countKey] : 0;
        return (
          <Link
            key={t.key}
            href={t.href}
            className={
              "shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition inline-flex items-center gap-2 " +
              (isActive
                ? "bg-navy-deep text-white"
                : "text-slate hover:text-navy-deep")
            }
          >
            {t.label}
            {count > 0 ? (
              <span
                className={
                  "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold " +
                  (isActive ? "bg-white text-navy-deep" : "text-white")
                }
                style={
                  isActive
                    ? undefined
                    : { background: "linear-gradient(135deg, var(--sky), var(--mint))" }
                }
              >
                {count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
