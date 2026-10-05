"use client";

import Link from "next/link";
import { useState } from "react";
import {
  COMPANY_TIERS,
  PERSONAL_TIERS,
  type PlanTier,
} from "@/lib/plans";

// Marketing pricing block. Personal shows all nine flat-fee services
// (migration 0045) in a compact 3x3 grid — each card routes into the
// picker (hint-less; the service pick itself is the choice). Business
// shows the three limited-company flat-fee services (Dormant, Non-VAT
// Registered, VAT Registered); the deeper breakdown lives on
// /limited-company-tax-returns via CompanyServicesPricing.
const BUSINESS: PlanTier[] = COMPANY_TIERS;
const PERSONAL: PlanTier[] = PERSONAL_TIERS;

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
          <PersonalGrid tiers={PERSONAL} />
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

// Nine Personal services. Rendered compact (title + 1-line tagline +
// price + Choose) so a visitor can scan the catalogue without the page
// becoming a wall. The full feature list lives on the picker — this
// is the browse surface, not the decision surface.
function PersonalGrid({ tiers }: { tiers: PlanTier[] }) {
  return (
    <>
      <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiers.map((t) => (
          <PersonalCompactCard key={t.id} tier={t} />
        ))}
      </div>
      <p
        className="mt-6 text-center text-[11px] uppercase tracking-widest text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        Every service · one flat fee · no surprises
      </p>
      <div className="mt-6 flex justify-center">
        <Link
          href="/client/new?mode=personal"
          className="btn-sl btn-sl-outline"
        >
          Compare all nine side by side
        </Link>
      </div>
    </>
  );
}

function PersonalCompactCard({ tier: t }: { tier: PlanTier }) {
  return (
    <div className="group relative flex flex-col rounded-2xl border border-line bg-paper p-6 shadow-sm transition hover:border-sky/50 hover:-translate-y-0.5">
      <h3 className="text-base font-semibold text-ink">{t.title}</h3>
      <p className="mt-1 text-xs text-slate line-clamp-2">{t.tagline}</p>
      <div
        className="mt-4 flex items-baseline gap-1"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        <span className="text-2xl font-bold text-ink">£{t.priceGbp}</span>
        <span className="text-[11px] font-semibold uppercase tracking-widest text-slate">
          one-off
        </span>
      </div>
      <Link
        href="/client/new?mode=personal"
        className="btn-sl btn-sl-outline btn-sl-block mt-5"
      >
        Choose
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
