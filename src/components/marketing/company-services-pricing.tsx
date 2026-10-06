import Link from "next/link";
import { getCompanyTiers } from "@/lib/service-catalog";

// /limited-company-tax-returns renders this. Shows the three flat-fee
// services the limited-company flow sells (Dormant, Non-VAT Registered,
// VAT Registered), reading from service_catalog so admin edits
// propagate without a redeploy.
export async function CompanyServicesPricing() {
  const companyTiers = await getCompanyTiers();
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
          {companyTiers.map((t) => (
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
                {/* priceDisplay wins when set — the Bespoke LC tier
                    uses it to render "Bespoke" instead of "£0", since
                    priceGbp is 0 (billed outside the flat-fee flow). */}
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
          ))}
        </div>
      </div>
    </section>
  );
}
