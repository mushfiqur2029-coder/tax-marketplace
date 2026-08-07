"use client";

import Link from "next/link";
import { useState } from "react";
import { PLAN_TIERS, type PlanTier } from "@/lib/plans";

// Personal pricing comes from the shared PLAN_TIERS source of truth (so
// the client checkout flow renders the same names + prices).
const PERSONAL: PlanTier[] = PLAN_TIERS;

// Business/VAT is a separate track, unchanged copy for now.
type BusinessTier = {
  title: string;
  sub: string;
  price: string;
  per?: string;
  items: string[];
};
const BUSINESS: BusinessTier[] = [
  {
    title: "VAT Basic",
    sub: "One quarter, filed.",
    price: "£129",
    items: [
      "Accountant prepares and files VAT",
      "Accuracy guarantee",
      "Secure document upload",
      "Status tracking",
    ],
  },
  {
    title: "VAT Standard",
    sub: "Quarterly, on autopilot.",
    price: "£99",
    per: "/quarter",
    items: [
      "Filed every quarter automatically",
      "Scheme review (flat rate vs standard)",
      "HMRC letter support",
      "Direct chat with your accountant",
    ],
  },
  {
    title: "VAT + Accounts",
    sub: "Full business partner.",
    price: "£449",
    items: [
      "Everything in VAT Standard",
      "Year-end accounts included",
      "Corporation tax return",
      "Dedicated accountant",
    ],
  },
];

export function PricingSection() {
  const [mode, setMode] = useState<"personal" | "business">("personal");

  return (
    <section id="pricing" className="py-24 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="section-head center">
          <span className="eyebrow">Pricing</span>
          <h2>One flat fee. No surprises after.</h2>
          <p>
            Every plan includes a qualified accountant and our accuracy
            guarantee.
          </p>
        </div>

        <div className="pricing-toggle">
          <button
            type="button"
            onClick={() => setMode("personal")}
            className={"pt-btn" + (mode === "personal" ? " active" : "")}
          >
            Personal
          </button>
          <button
            type="button"
            aria-label="Toggle pricing mode"
            onClick={() =>
              setMode((m) => (m === "personal" ? "business" : "personal"))
            }
            className={"pt-switch" + (mode === "business" ? " on" : "")}
          >
            <span className="pt-knob" />
          </button>
          <button
            type="button"
            onClick={() => setMode("business")}
            className={"pt-btn" + (mode === "business" ? " active" : "")}
          >
            Business / VAT
          </button>
        </div>

        <div className="pricing-grid">
          {mode === "personal"
            ? PERSONAL.map((t) => <PersonalCard key={t.id} tier={t} />)
            : BUSINESS.map((t, i) => (
                <BusinessCard key={t.title} tier={t} featured={i === 1} />
              ))}
        </div>
      </div>
    </section>
  );
}

function PersonalCard({ tier: t }: { tier: PlanTier }) {
  return (
    <div className={"price-card" + (t.featured ? " featured" : "")}>
      {t.featured ? <span className="price-badge">Most chosen</span> : null}
      <h3>{t.title}</h3>
      <div className="mt-2 flex items-baseline gap-2">
        <span
          className="text-lg font-semibold text-slate line-through decoration-slate/60"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          £{t.originalGbp}
        </span>
        <span className="price !mb-0">£{t.priceGbp}</span>
        <span
          className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider"
          style={{
            background: "rgba(19, 217, 160, 0.14)",
            color: "#0E9E77",
            fontFamily: "var(--font-mono)",
          }}
        >
          Save £{t.saveGbp}
        </span>
      </div>
      <p className="tier-sub mt-3">{t.heroLine}</p>
      <ul>
        {t.features.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="mb-4 -mt-2 text-xs italic text-slate">{t.footerLine}</p>
      <Link
        href="/register"
        className={
          "btn-sl btn-sl-block " +
          (t.featured ? "btn-sl-primary" : "btn-sl-outline")
        }
      >
        Choose {t.title}
      </Link>
    </div>
  );
}

function BusinessCard({
  tier: t,
  featured,
}: {
  tier: BusinessTier;
  featured: boolean;
}) {
  return (
    <div className={"price-card" + (featured ? " featured" : "")}>
      {featured ? <span className="price-badge">Most chosen</span> : null}
      <h3>{t.title}</h3>
      <p className="tier-sub">{t.sub}</p>
      <div className="price">
        {t.price}
        {t.per ? <small> {t.per}</small> : null}
      </div>
      <ul>
        {t.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <Link
        href="/register"
        className={
          "btn-sl btn-sl-block " +
          (featured ? "btn-sl-primary" : "btn-sl-outline")
        }
      >
        Choose {t.title}
      </Link>
    </div>
  );
}
