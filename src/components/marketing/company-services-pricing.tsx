import Link from "next/link";
import { COMPANY_TIERS } from "@/lib/plans";

// Only rendered on /limited-company-tax-returns. Shows the full 6-card
// company grid, pulling from the shared PLAN_TIERS source of truth so
// prices stay in lockstep with the client wizard.
const IDS = [
  "vat_basic",
  "vat_standard",
  "vat_accounts",
  "dormant",
  "non_vat_reg",
  "vat_reg",
] as const;

const TIERS = IDS
  .map((id) => COMPANY_TIERS.find((t) => t.id === id))
  .filter((t): t is NonNullable<typeof t> => t != null);

export function CompanyServicesPricing() {
  return (
    <section id="company-pricing" className="py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="section-head center">
          <span className="eyebrow">Company services</span>
          <h2>Fixed prices for company-level filings.</h2>
          <p>
            Separate from personal filing. Pick the tier that matches your
            company&rsquo;s activity.
          </p>
        </div>

        <div className="pricing-grid">
          {TIERS.map((t) => (
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
