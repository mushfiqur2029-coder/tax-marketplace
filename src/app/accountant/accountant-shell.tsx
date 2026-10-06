"use client";

import {
  PortalShell,
  type PortalMe,
  type PortalNavGroup,
} from "@/components/portal-shell";
import type { AccountantNavCounts } from "./accountant-counts";

// Accountant portal nav. Four items plus Account, no groups needed at
// this count. Queue + My cases carry live count badges so the
// accountant sees pending-work state without opening the dashboard.
// Chrome is shared with admin + client via <PortalShell>.

type AccountantCountKey = keyof AccountantNavCounts;

const GROUPS: ReadonlyArray<PortalNavGroup<AccountantCountKey>> = [
  {
    key: "main",
    items: [
      // Dashboard = default /accountant (live cases view).
      // Available cases = /accountant?view=queue. Both hit the same
      // page so plain `/accountant` highlights Dashboard; the queue
      // view highlights via activePrefix match on the base path only
      // when the URL contains ?view=queue — but activePrefix is a
      // path-only match, so Available cases will highlight whenever
      // the user is on /accountant (same as Dashboard). Acceptable
      // for now; a future improvement is query-string-aware active.
      { href: "/accountant", label: "Dashboard", activePrefix: "" },
      {
        href: "/accountant?view=queue",
        label: "Available cases",
        activePrefix: "/accountant/queue",
        countKey: "queue",
      },
      // Cases detail pages live under /accountant/cases/:id — highlight here.
      // activeExcludeExact so /accountant itself only lights Dashboard.
      {
        href: "/accountant",
        label: "My cases",
        activePrefix: "/accountant/cases",
        countKey: "mine",
        activeExcludeExact: true,
      },
      { href: "/accountant/wallet", label: "Wallet", activePrefix: "/accountant/wallet" },
      { href: "/accountant/profile", label: "Account", activePrefix: "/accountant/profile" },
    ],
  },
];

export function AccountantShell({
  counts,
  me,
  bell,
  children,
}: {
  counts: AccountantNavCounts;
  me: PortalMe;
  bell: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <PortalShell
      navGroups={GROUPS}
      counts={counts}
      me={me}
      bell={bell}
      navAriaLabel="Accountant navigation"
    >
      {children}
    </PortalShell>
  );
}
