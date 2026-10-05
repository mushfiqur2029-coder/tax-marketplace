"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/app/actions";
import { Brand } from "@/components/brand";
import { Avatar } from "@/components/avatar";
import type { AdminNavCounts } from "@/app/admin/admin-counts";

// Admin console nav. Sidebar at lg+, slide-in drawer below lg behind
// the hamburger button in the main-area top strip. 10 flat tabs was
// clipping even on normal desktop widths and would only get worse —
// this restructures them into three groups (Teams / Money / Requests)
// plus two standalone items (Dashboard, Account).
//
// Group headers are purely visual separators — not clickable. Count
// badges on the leaf items match the old subnav behaviour and come
// from getAdminNavCounts on the server.

type Me = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  avatarPath: string | null;
};

type Item = {
  href: string;
  label: string;
  countKey?: keyof AdminNavCounts;
  // Prefix match for highlighting the active item. "" means
  // exact-match only (used for /admin itself so sub-routes don't
  // highlight Dashboard).
  activePrefix: string;
};

type Group = {
  key: string;
  heading?: string; // undefined → standalone item (Dashboard, Account)
  items: Item[];
};

const GROUPS: Group[] = [
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

function isActive(pathname: string | null, item: Item): boolean {
  if (!pathname) return false;
  if (item.activePrefix === "") return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.activePrefix + "/");
}

export function AdminShell({
  counts,
  me,
  bell,
  children,
}: {
  counts: AdminNavCounts;
  me: Me;
  bell: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer on route change — the client component
  // persists across navigations, so we need to notice pathname
  // moving even though it's set to false onItemClick as well.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Esc closes the drawer. Scoped only when open so we don't attach
  // the listener in steady state.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  // Prevent body scroll while drawer is open (mobile).
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  return (
    <div className="min-h-full">
      {/* Backdrop + drawer — mobile only. Rendered unconditionally
          so the transform animation fires on open;
          `pointer-events-none` keeps it inert when closed. */}
      <div
        className={
          "lg:hidden fixed inset-0 z-50 transition-opacity duration-200 " +
          (drawerOpen ? "opacity-100" : "pointer-events-none opacity-0")
        }
        aria-hidden={!drawerOpen}
      >
        <div
          className="absolute inset-0 bg-navy-deep/40 backdrop-blur-[2px]"
          onClick={() => setDrawerOpen(false)}
        />
        <aside
          className={
            "absolute left-0 top-0 h-full w-72 bg-paper shadow-2xl transition-transform duration-300 ease-out " +
            (drawerOpen ? "translate-x-0" : "-translate-x-full")
          }
          aria-label="Admin navigation"
        >
          <SidebarBody
            counts={counts}
            me={me}
            pathname={pathname}
            onItemClick={() => setDrawerOpen(false)}
          />
        </aside>
      </div>

      {/* Fixed desktop sidebar. Hidden below lg where the drawer
          takes over. */}
      <aside
        className="hidden lg:flex fixed left-0 top-0 bottom-0 w-60 flex-col border-r border-line/60 bg-paper/80 backdrop-blur-md"
        aria-label="Admin navigation"
      >
        <SidebarBody counts={counts} me={me} pathname={pathname} />
      </aside>

      {/* Main area. Shifts right past the fixed sidebar at lg+;
          takes the full width below lg where the sidebar is a drawer
          overlay. */}
      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 border-b border-line/60 bg-paper/80 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="flex items-center gap-2 lg:hidden">
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                aria-label="Open navigation"
                aria-expanded={drawerOpen}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-navy-deep hover:bg-cloud"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <line x1="4" y1="6" x2="20" y2="6" />
                  <line x1="4" y1="12" x2="20" y2="12" />
                  <line x1="4" y1="18" x2="20" y2="18" />
                </svg>
              </button>
              <Brand />
            </div>
            <div className="ml-auto flex items-center gap-3">{bell}</div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}

function SidebarBody({
  counts,
  me,
  pathname,
  onItemClick,
}: {
  counts: AdminNavCounts;
  me: Me;
  pathname: string | null;
  onItemClick?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="px-5 py-4 border-b border-line/60">
        <Brand />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {GROUPS.map((g, i) => (
            <li key={g.key}>
              {g.heading ? (
                <div
                  className={
                    "mt-4 mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate " +
                    (i === 0 ? "mt-1" : "")
                  }
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {g.heading}
                </div>
              ) : null}
              <ul className="space-y-0.5">
                {g.items.map((item) => {
                  const active = isActive(pathname, item);
                  const count = item.countKey ? counts[item.countKey] : 0;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onItemClick}
                        className={
                          "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition " +
                          (active
                            ? "bg-navy-deep/[0.08] font-semibold text-navy-deep"
                            : "text-ink hover:bg-cloud")
                        }
                        aria-current={active ? "page" : undefined}
                      >
                        <span>{item.label}</span>
                        {count > 0 ? (
                          <span
                            className={
                              "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold " +
                              (active
                                ? "bg-navy-deep text-white"
                                : "text-white")
                            }
                            style={
                              active
                                ? undefined
                                : {
                                    background:
                                      "linear-gradient(135deg, var(--sky), var(--mint))",
                                  }
                            }
                          >
                            {count}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </nav>

      {/* Identity footer. Small avatar + email + role + sign-out icon.
          Keeps the top-right of the main area free for just the bell. */}
      <div className="border-t border-line/60 px-4 py-3">
        <div className="flex items-center gap-3">
          <Avatar
            path={me.avatarPath}
            name={me.name}
            email={me.email}
            size={32}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-ink">
              {me.name?.trim() || me.email}
            </div>
            <div
              className="text-[10px] uppercase tracking-widest text-slate"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {me.role}
            </div>
          </div>
          <form action={signOutAction} className="shrink-0">
            <button
              type="submit"
              aria-label="Sign out"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate hover:bg-cloud hover:text-navy-deep"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
