import Link from "next/link";
import { COMPANY_TIERS } from "@/lib/plans";

// /limited-company-tax-returns renders this. Shows the three flat-fee
// services the limited-company flow sells (Dormant, Non-VAT Registered,
// VAT Registered), pulled from the shared PLAN_TIERS source so prices
// stay in lockstep with the client wizard.
export function CompanyServicesPricing() {
  return (
    <section id="company-pricing" className="py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="section-head center">
          <span className="eyebrow">Company services</span>
          <h2>One flat fee per engagement.</h2>
          <p>
            Pick the service that matches your company&rsquo;s activity. No
            quarterly or monthly billing &mdash; one price covers the whole
            engagement.
          </p>
        </div>

        <div className="pricing-grid">
          {COMPANY_TIERS.map((t) => (
            <div
              key={t.id}
              className={"price-card" + (t.featured ? " featured" : "")}
            >
              {t.featured ? (
                <span className="price-badge">Most chosen</span>
              ) : null}
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
          ))}
        </div>
      </div>
    </section>
  );
}
