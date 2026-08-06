"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Brand } from "@/components/brand";
import { SLLink } from "@/components/sl-button";

// Some anchors (#how, #pricing, #faq) exist on the homepage AND on every
// service page, so relative anchors work everywhere. #audience and
// #accountants only exist on the homepage, so those go to /#… so they still
// jump correctly when a user is on a service page.
const NAV_LINKS = [
  { href: "#how", label: "How it works" },
  { href: "/#audience", label: "Who it's for" },
  { href: "#pricing", label: "Pricing" },
  { href: "/#accountants", label: "For accountants" },
  { href: "#faq", label: "FAQ" },
];

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 30);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={
        "sticky top-0 z-50 sl-nav-shell" + (scrolled ? " scrolled" : "")
      }
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="sl-nav-inner relative">
          <Brand />
          <nav className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-lg px-3.5 py-2 text-sm font-semibold text-ink/70 transition hover:bg-sky/10 hover:text-ink"
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <SLLink href="/login" variant="ghost" className="hidden sm:inline-flex">
              Log in
            </SLLink>
            <SLLink
              href="/register"
              variant="primary"
              className="!px-4 !py-2.5 !text-[13px] sm:!px-5 sm:!py-2.5 sm:!text-[14.5px]"
            >
              <span className="sm:hidden">Start</span>
              <span className="hidden sm:inline">Start your return</span>
            </SLLink>
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-navy-deep transition hover:bg-sky/10 md:hidden"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
            >
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                {mobileOpen ? (
                  <>
                    <line x1="6" y1="6" x2="18" y2="18" />
                    <line x1="18" y1="6" x2="6" y2="18" />
                  </>
                ) : (
                  <>
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                  </>
                )}
              </svg>
            </button>
          </div>

          <div
            className={"mobile-panel md:hidden" + (mobileOpen ? " open" : "")}
          >
            {NAV_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setMobileOpen(false)}
              >
                {l.label}
              </Link>
            ))}
            <div className="divider" />
            <Link
              href="/login"
              onClick={() => setMobileOpen(false)}
            >
              Log in
            </Link>
            <SLLink
              href="/register"
              variant="primary"
              block
              onClick={() => setMobileOpen(false)}
              className="mt-1"
            >
              Start your return
            </SLLink>
          </div>
        </div>
      </div>
    </header>
  );
}
