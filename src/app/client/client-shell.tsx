"use client";

import {
  PortalShell,
  type PortalMe,
  type PortalNavGroup,
} from "@/components/portal-shell";

// Client portal nav. Five items, no groups — "New return" sits as a
// persistent sidebar item while /client's own dashboard keeps the big
// in-page CTA for first-time visitors (both affordances by design).
// Chrome is shared with admin + accountant via <PortalShell>.

// Client has no sidebar badges today. The type stays `never` so the
// shell's generic resolves cleanly; swap in a real key union when
// counts land.
type ClientCountKey = never;

const GROUPS: ReadonlyArray<PortalNavGroup<ClientCountKey>> = [
  {
    key: "main",
    items: [
      // Dashboard = exact /client (overview + cases list on the same page).
      // Cases = same URL but highlights on /client/cases/:id detail pages
      // so users deep in a case still see where they are in the sidebar.
      { href: "/client", label: "Dashboard", activePrefix: "" },
      { href: "/client/new", label: "New return", activePrefix: "/client/new" },
      {
        href: "/client",
        label: "Cases",
        activePrefix: "/client/cases",
        // Don't highlight on bare /client (that's Dashboard).
        activeExcludeExact: true,
      },
      { href: "/client/payments", label: "Payments", activePrefix: "/client/payments" },
      { href: "/client/profile", label: "Account", activePrefix: "/client/profile" },
    ],
  },
];

export function ClientShell({
  me,
  bell,
  children,
}: {
  me: PortalMe;
  bell: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <PortalShell
      navGroups={GROUPS}
      counts={{} as Record<ClientCountKey, number>}
      me={me}
      bell={bell}
      navAriaLabel="Client navigation"
    >
      {children}
    </PortalShell>
  );
}
