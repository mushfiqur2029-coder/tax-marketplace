"use client";

import Link from "next/link";
import { useState } from "react";
import { PERSONAL_TIERS, type PlanTier } from "@/lib/plans";

// Marketing pricing block. Personal tiers come from PLAN_TIERS so the
// homepage stays in lockstep with the client checkout flow.
// The Business/VAT track on the homepage shows only the three VAT plans;
// the full 6-tier company grid lives on /limited-company-tax-returns via
// CompanyServicesPricing.
import { COMPANY_TIERS } from "@/lib/plans";
const BUSINESS: PlanTier[] = COMPANY_TIERS.filter((t) =>
  ["vat_basic", "vat_standard", "vat_accounts"].includes(t.id),
);

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
            ? PERSONAL_TIERS.map((t) => <PersonalCard key={t.id} tier={t} />)
            : BUSINESS.map((t) => <BusinessCard key={t.id} tier={t} />)}
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
        {t.originalGbp ? (
          <span
            className="text-lg font-semibold text-slate line-through decoration-slate/60"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            £{t.originalGbp}
          </span>
        ) : null}
        <span className="price !mb-0">£{t.priceGbp}</span>
        {t.saveGbp ? (
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
        ) : null}
      </div>
      {t.heroLine ? <p className="tier-sub mt-3">{t.heroLine}</p> : null}
      {t.features && t.features.length > 0 ? (
        <ul>
          {t.features.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      {t.footerLine ? (
        <p className="mb-4 -mt-2 text-xs italic text-slate">{t.footerLine}</p>
      ) : null}
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

function BusinessCard({ tier: t }: { tier: PlanTier }) {
  return (
    <div className={"price-card" + (t.featured ? " featured" : "")}>
      {t.featured ? <span className="price-badge">Most chosen</span> : null}
      <h3>{t.title}</h3>
      {t.tagline ? <p className="tier-sub">{t.tagline}</p> : null}
      <div className="price">
        £{t.priceGbp}
        {t.pricePer ? <small> {t.pricePer}</small> : null}
        {t.priceSuffix ? <small> {t.priceSuffix}</small> : null}
      </div>
      {t.features && t.features.length > 0 ? (
        <ul>
          {t.features.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : t.description ? (
        <p className="mt-2 mb-6 text-sm text-slate">{t.description}</p>
      ) : null}
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
