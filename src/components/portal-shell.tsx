"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/app/actions";
import { Brand } from "@/components/brand";
import { Avatar } from "@/components/avatar";

// Shared chrome for every signed-in portal (admin, accountant, client).
// Fixed sidebar at lg+, slide-in drawer below lg behind the hamburger
// button in the main-area top strip. Grouped navigation + per-item
// count badges + identity footer. Nav shape is per-portal; this shell
// is purely presentational.

export type PortalMe = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  avatarPath: string | null;
};

export type PortalNavItem<K extends string = string> = {
  href: string;
  label: string;
  // Key into the `counts` map. Items without a key show no badge.
  countKey?: K;
  // Prefix match for highlighting the active item. "" means
  // exact-match only (so sub-routes don't highlight a parent tab).
  activePrefix: string;
  // Two nav items can legitimately share the same href (e.g. client
  // Dashboard + Cases both land on /client). Set this on the one that
  // should only light up on sub-routes, not on the parent URL itself.
  activeExcludeExact?: boolean;
};

export type PortalNavGroup<K extends string = string> = {
  key: string;
  // undefined → standalone item without an uppercase mono header above it.
  heading?: string;
  items: PortalNavItem<K>[];
};

type Props<K extends string> = {
  navGroups: ReadonlyArray<PortalNavGroup<K>>;
  counts: Record<K, number>;
  me: PortalMe;
  bell: React.ReactNode;
  // aria-label on both drawer and desktop sidebar (e.g. "Admin navigation").
  navAriaLabel: string;
  children: React.ReactNode;
};

function isActive(pathname: string | null, item: PortalNavItem): boolean {
  if (!pathname) return false;
  if (item.activePrefix === "") return pathname === item.href;
  const prefixMatch = pathname.startsWith(item.activePrefix + "/");
  if (item.activeExcludeExact) return prefixMatch;
  return pathname === item.href || prefixMatch;
}

export function PortalShell<K extends string>({
  navGroups,
  counts,
  me,
  bell,
  navAriaLabel,
  children,
}: Props<K>) {
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
          aria-label={navAriaLabel}
        >
          <SidebarBody
            navGroups={navGroups}
            counts={counts}
            me={me}
            pathname={pathname}
            onItemClick={() => setDrawerOpen(false)}
          />
        </aside>
      </div>

      {/* Fixed desktop sidebar. Hidden below lg where the drawer takes over. */}
      <aside
        className="hidden lg:flex fixed left-0 top-0 bottom-0 w-60 flex-col border-r border-line/60 bg-paper/80 backdrop-blur-md"
        aria-label={navAriaLabel}
      >
        <SidebarBody navGroups={navGroups} counts={counts} me={me} pathname={pathname} />
      </aside>

      {/* Main area. Shifts right past the fixed sidebar at lg+;
          takes the full width below lg where the sidebar is a drawer overlay. */}
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

function SidebarBody<K extends string>({
  navGroups,
  counts,
  me,
  pathname,
  onItemClick,
}: {
  navGroups: ReadonlyArray<PortalNavGroup<K>>;
  counts: Record<K, number>;
  me: PortalMe;
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
          {navGroups.map((g, i) => (
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
                  // Two items can share an href (client Dashboard + Cases).
                  // Key off href + label so React doesn't collide them.
                  return (
                    <li key={`${item.href}#${item.label}`}>
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

      {/* Identity footer. Small avatar + name/email + role + sign-out icon.
          Keeps the top-right of the main area free for just the bell. */}
      <div className="border-t border-line/60 px-4 py-3">
        <div className="flex items-center gap-3">
          <Avatar path={me.avatarPath} name={me.name} email={me.email} size={32} />
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
