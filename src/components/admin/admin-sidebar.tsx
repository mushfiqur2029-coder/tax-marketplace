"use client";

import {
  PortalShell,
  type PortalMe,
  type PortalNavGroup,
} from "@/components/portal-shell";
import type { AdminNavCounts } from "@/app/admin/admin-counts";

// Admin console nav. Sidebar at lg+, slide-in drawer below lg behind
// the hamburger button in the main-area top strip. 10 flat tabs was
// clipping even on normal desktop widths and would only get worse —
// this restructures them into three groups (Teams / Money / Requests)
// plus two standalone items (Dashboard, Account).
//
// Chrome lives in <PortalShell>, which is shared with the client and
// accountant portals. This file just names the admin-specific nav
// groups + wires the admin count map.

type AdminCountKey = Exclude<keyof AdminNavCounts, "clients" | "unreadNotifications">;

const GROUPS: ReadonlyArray<PortalNavGroup<AdminCountKey>> = [
  {
    key: "dashboard",
    items: [{ href: "/admin", label: "Dashboard", activePrefix: "" }],
  },
  {
    key: "teams",
    heading: "Teams",
    items: [
      {
        href: "/admin/accountants",
        label: "Accountants",
        activePrefix: "/admin/accountants",
        countKey: "accountants",
      },
      {
        href: "/admin/clients",
        label: "Clients",
        activePrefix: "/admin/clients",
        countKey: "suspendedClients",
      },
      {
        href: "/admin/admins",
        label: "Admins",
        activePrefix: "/admin/admins",
      },
    ],
  },
  {
    key: "money",
    heading: "Money",
    items: [
      {
        href: "/admin/withdrawals",
        label: "Withdrawals",
        activePrefix: "/admin/withdrawals",
        countKey: "withdrawals",
      },
      {
        href: "/admin/addon-catalog",
        label: "Add-on catalog",
        activePrefix: "/admin/addon-catalog",
      },
    ],
  },
  {
    key: "requests",
    heading: "Requests",
    items: [
      {
        href: "/admin/profile-changes",
        label: "Profile changes",
        activePrefix: "/admin/profile-changes",
        countKey: "profileChanges",
      },
      {
        href: "/admin/addon-requests",
        label: "Add-on requests",
        activePrefix: "/admin/addon-requests",
        countKey: "addonRequests",
      },
      {
        href: "/admin/enquiries",
        label: "Enquiries",
        activePrefix: "/admin/enquiries",
        countKey: "enquiries",
      },
    ],
  },
  {
    key: "account",
    items: [{ href: "/admin/profile", label: "Account", activePrefix: "/admin/profile" }],
  },
];

export function AdminShell({
  counts,
  me,
  bell,
  children,
}: {
  counts: AdminNavCounts;
  me: PortalMe;
  bell: React.ReactNode;
  children: React.ReactNode;
}) {
  // Project only the keys the nav uses so <PortalShell> gets a strongly-
  // typed count map; `clients` and `unreadNotifications` are read elsewhere.
  const navCounts: Record<AdminCountKey, number> = {
    accountants: counts.accountants,
    suspendedClients: counts.suspendedClients,
    withdrawals: counts.withdrawals,
    profileChanges: counts.profileChanges,
    addonRequests: counts.addonRequests,
    enquiries: counts.enquiries,
  };
  return (
    <PortalShell
      navGroups={GROUPS}
      counts={navCounts}
      me={me}
      bell={bell}
      navAriaLabel="Admin navigation"
    >
      {children}
    </PortalShell>
  );
}
