// Extra section only rendered on /limited-company-tax-returns — folds the old
// "ongoing company subscription" copy in as an additional service.

export function SubscriptionSection() {
  return (
    <section id="subscription" className="py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="section-head center">
          <span className="eyebrow">Also available</span>
          <h2>Ongoing company subscription.</h2>
          <p>
            One dedicated accountant on retainer, handling your bookkeeping,
            payroll, and filings year-round — not just at year end.
          </p>
        </div>
        <div className="who-grid">
          <div className="a-card">
            <div className="ic">✓</div>
            <h3>Monthly bookkeeping</h3>
            <p>
              Your accounts kept up to date every month, not scrambled together
              in the final week before filing.
            </p>
          </div>
          <div className="a-card">
            <div className="ic">✓</div>
            <h3>Payroll for you and your team</h3>
            <p>
              PAYE, salary payments, and payslips handled monthly. HMRC reports
              filed automatically.
            </p>
          </div>
          <div className="a-card">
            <div className="ic">✓</div>
            <h3>One accountant, all year</h3>
            <p>
              The same qualified accountant across corporation tax, VAT, and
              your personal Self Assessment. No hand-offs.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
