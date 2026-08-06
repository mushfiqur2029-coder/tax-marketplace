"use client";

import Link from "next/link";
import { useState } from "react";
import { Reveal } from "./reveal";

type Card = { href: string; num: string; title: string; body: string };
type TabId =
  | "individuals"
  | "selfemployed"
  | "landlords"
  | "limited"
  | "vat";

const TABS: { id: TabId; label: string; cards: Card[] }[] = [
  {
    id: "individuals",
    label: "Individuals",
    cards: [
      { href: "/first-time-filers", num: "①", title: "First-time filers", body: "New to Self Assessment? We'll tell you exactly what's needed, in plain English." },
      { href: "/high-earners", num: "②", title: "High earners", body: "Higher and additional rate tax, allowances that taper away, handled correctly." },
      { href: "/expats", num: "③", title: "Expats", body: "Foreign income, residency status, and UK ties, sorted by someone who knows the rules." },
      { href: "/investors", num: "④", title: "Investors", body: "Sold shares, crypto, or a second property? We work out what's owed and file it." },
    ],
  },
  {
    id: "selfemployed",
    label: "Self-employed",
    cards: [
      { href: "/self-employed", num: "①", title: "Sole traders", body: "Income, expenses, and allowable deductions handled by someone who knows your trade." },
      { href: "/cis-construction", num: "②", title: "CIS construction workers", body: "Most CIS workers are owed a refund. We check and claim it for you." },
      { href: "/self-employed", num: "③", title: "Side income", body: "Freelance work on top of a main job, declared properly without overpaying." },
    ],
  },
  {
    id: "landlords",
    label: "Landlords",
    cards: [
      { href: "/landlords", num: "①", title: "Single property", body: "Rental income, mortgage interest relief, and allowable expenses, filed correctly." },
      { href: "/landlords", num: "②", title: "Portfolio landlords", body: "Multiple properties and multiple income streams, one accountant across all of it." },
      { href: "/making-tax-digital", num: "③", title: "Making Tax Digital", body: "Get ahead of MTD for landlords before it's mandatory for your income band." },
    ],
  },
  {
    id: "limited",
    label: "Limited companies",
    cards: [
      { href: "/limited-company-tax-returns", num: "①", title: "Company tax returns", body: "Corporation tax prepared and filed by an accountant who knows your sector." },
      { href: "/ltd-company-directors", num: "②", title: "Director self-assessment", body: "Your personal return handled alongside the company's, so nothing's missed." },
      { href: "/limited-company-tax-returns#subscription", num: "③", title: "Ongoing company subscription", body: "Year-round bookkeeping, payroll, and filings, with one dedicated accountant on retainer." },
    ],
  },
  {
    id: "vat",
    label: "VAT & business",
    cards: [
      { href: "/vat-business", num: "①", title: "Quarterly VAT returns", body: "Filed on time, every quarter, with an accountant who knows your VAT scheme." },
      { href: "/vat-business", num: "②", title: "VAT registration", body: "Approaching the threshold? We handle registration and scheme selection." },
      { href: "/vat-business", num: "③", title: "Flat rate vs standard", body: "We work out which VAT scheme actually saves your business money." },
    ],
  },
];

export function AudienceTabs() {
  const [active, setActive] = useState<TabId>("individuals");
  const [animateKey, setAnimateKey] = useState(0);
  const current = TABS.find((t) => t.id === active) ?? TABS[0];

  const onSelect = (id: TabId) => {
    setActive(id);
    setAnimateKey((k) => k + 1);
  };

  return (
    <section id="audience" className="py-24 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="section-head center">
          <Reveal as="span" className="eyebrow">
            Who it's for
          </Reveal>
          <Reveal delay={0.08} as="h2">
            One platform. Every <span className="gradient-text">kind of tax.</span>
          </Reveal>
          <Reveal delay={0.16} as="p">
            Whatever your situation, there's an accountant on Sterling Ledger
            who does exactly this, every day.
          </Reveal>
        </div>

        <Reveal delay={0.22} className="audience-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.id)}
              className={"audience-tab" + (active === t.id ? " active" : "")}
              aria-pressed={active === t.id}
            >
              {t.label}
            </button>
          ))}
        </Reveal>

        <div key={animateKey} className="audience-panel animate-in">
          {current.cards.map((c) => (
            <Link key={c.title + c.num} href={c.href} className="a-card">
              <div className="ic">{c.num}</div>
              <h3>{c.title}</h3>
              <p>{c.body}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
