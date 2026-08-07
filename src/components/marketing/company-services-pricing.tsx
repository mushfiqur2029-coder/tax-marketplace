import Link from "next/link";

// Only rendered on /limited-company-tax-returns. A second pricing block, for
// company-level services rather than personal filing. Static (no toggle) and
// with a different price shape (£X+VAT) so it uses its own component.

const TIERS = [
  {
    title: "Dormant",
    price: "£89",
    description:
      "For companies that are inactive and have no business activity.",
  },
  {
    title: "Non-VAT registered",
    price: "£329",
    description:
      "For all non-VAT registered companies, including non-trading companies.",
  },
  {
    title: "VAT-registered",
    price: "£419",
    description:
      "For VAT registered companies with an annual turnover below £200k.",
  },
];

export function CompanyServicesPricing() {
  return (
    <section id="company-pricing" className="py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="section-head center">
          <span className="eyebrow">Company services</span>
          <h2>Fixed prices for company-level filings.</h2>
          <p>
            Separate from personal filing. Pick the tier that matches your
            company's activity.
          </p>
        </div>

        <div className="pricing-grid">
          {TIERS.map((t) => (
            <div key={t.title} className="price-card">
              <h3>{t.title}</h3>
              <div className="price mt-3">
                {t.price}
                <small> +VAT</small>
              </div>
              <p className="mt-4 text-sm text-slate">{t.description}</p>
              <div className="mt-6">
                <Link href="/register" className="btn-sl btn-sl-outline btn-sl-block">
                  Choose {t.title}
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
