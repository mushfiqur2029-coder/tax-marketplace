"use client";

import Link from "next/link";
import { useState } from "react";
import {
  COMPANY_TIERS,
  type PlanTier,
} from "@/lib/plans";

// Marketing pricing block. Personal pricing used to show three fixed
// tiers (basic / standard / premium); the restructure replaces that
// with nine situation-specific flat fees (migration 0045), which don't
// fit a three-column grid. The Personal side now routes to the picker
// where visitors see all nine options with the suggestion banner. A
// dedicated marketing block for the nine services is scheduled for P4.
// Business shows the three limited-company flat-fee services (Dormant,
// Non-VAT Registered, VAT Registered); the deeper breakdown lives on
// /limited-company-tax-returns via CompanyServicesPricing.
const BUSINESS: PlanTier[] = COMPANY_TIERS;

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

        {mode === "personal" ? (
          <PersonalPlaceholder />
        ) : (
          <div className="pricing-grid">
            {BUSINESS.map((t) => (
              <BusinessCard key={t.id} tier={t} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// Nine personal services don't fit the three-column grid. Point to
// the picker instead; a bespoke 9-up marketing block lands in P4.
function PersonalPlaceholder() {
  return (
    <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-line bg-paper p-8 text-center shadow-sm">
      <h3
        className="text-xl font-semibold text-ink"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        Nine flat-fee personal services
      </h3>
      <p className="mt-3 text-sm text-slate">
        From £199 for sole traders, Uber drivers, gig workers, and freelancers
        to £1,000 for complex foreign/international situations. Each one is a
        one-off fee with a qualified accountant and our accuracy guarantee —
        pick the service that fits your situation.
      </p>
      <Link
        href="/client/new?mode=personal"
        className="btn-sl btn-sl-primary mt-6 inline-flex"
      >
        See all nine services
      </Link>
      <p className="mt-4 text-[11px] uppercase tracking-widest text-slate" style={{ fontFamily: "var(--font-mono)" }}>
        One flat fee · no surprises
      </p>
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
        {/* priceDisplay wins when set — the Bespoke LC tier uses it
            to render "Bespoke" instead of "£0", since priceGbp is 0
            (billed outside the flat-fee flow). */}
        {t.priceDisplay ?? <>£{t.priceGbp}</>}
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
