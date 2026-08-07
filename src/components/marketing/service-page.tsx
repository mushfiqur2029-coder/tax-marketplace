import Link from "next/link";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { MobileCta } from "@/components/marketing/mobile-cta";
import { BlobField } from "@/components/blob-field";
import { SLLink } from "@/components/sl-button";
import { Reveal } from "@/components/marketing/reveal";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { PricingSection } from "@/components/marketing/pricing-section";
import { FaqAccordion, type Faq } from "@/components/marketing/faq-accordion-inline";

export type WhoCard = {
  numeral: "①" | "②" | "③" | "④";
  title: string;
  body: string;
};

export type ServicePageData = {
  slug: string;
  breadcrumb: string;
  eyebrow: string;
  h1: string; // may contain <span class="gradient-text">. pass as JSX via h1Jsx
  h1Jsx?: React.ReactNode;
  lede: string;
  heroCard?: React.ReactNode; // optional custom hero visual, else default
  whyHeading?: string;
  whoHeading: string;
  whoIntro?: string;
  whoCards: WhoCard[];
  consultCopy: string;
  faqs: Faq[];
  showPricing?: boolean; // default true; tax-advice sets false
  showConsult?: boolean; // default true; tax-advice sets false
  extraAfterWho?: React.ReactNode;
  extraAfterPricing?: React.ReactNode;
  howHeading?: string;
  howSteps?: { n: number; title: string; body: string }[];
};

export function ServicePage({ data }: { data: ServicePageData }) {
  const showPricing = data.showPricing !== false;
  const showConsult = data.showConsult !== false;

  return (
    <div className="relative min-h-full flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        {/* Hero */}
        <section className="service-hero">
          <BlobField />
          <div className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6">
            <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
              <div>
                <div className="breadcrumb">
                  <Link href="/">Home</Link> / <Link href="/#audience">Services</Link> / {data.breadcrumb}
                </div>
                <span className="eyebrow">{data.eyebrow}</span>
                <h1
                  className="mt-5 text-4xl leading-[1.03] sm:text-5xl lg:text-6xl"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {data.h1Jsx ?? data.h1}
                </h1>
                <p className="mt-6 max-w-xl text-base text-slate sm:text-lg">
                  {data.lede}
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <SLLink href="/register" variant="primary">
                    Start your return
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                    >
                      <path d="M4 10h12M11 5l5 5-5 5" />
                    </svg>
                  </SLLink>
                  <SLLink
                    href={showConsult ? "#consult" : "#faq"}
                    variant="ghost"
                  >
                    {showConsult ? "Talk to an accountant first" : "Read the FAQ"}
                  </SLLink>
                </div>
                <div className="mt-8 flex items-center gap-3 text-sm font-semibold text-slate">
                  <div className="avatar-stack">
                    <span /><span /><span /><span />
                  </div>
                  Vetted ACCA · CIMA · CTA accountants only
                </div>
              </div>

              {data.heroCard ?? <DefaultHeroCard />}
            </div>
          </div>
        </section>

        {/* Why Sterling Ledger */}
        <section id="why" className="py-20 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="section-head center">
              <span className="eyebrow">Why Sterling Ledger</span>
              <h2>
                {data.whyHeading ??
                  "Real accountants. Real accuracy. No fluff."}
              </h2>
            </div>
            <div className="why-grid">
              <Reveal className="why-card">
                <div className="ic">✓</div>
                <h3>Qualified accountants</h3>
                <p>
                  UK-based, ACCA, CIMA, or CTA accredited, each with real
                  experience in this exact area.
                </p>
              </Reveal>
              <Reveal className="why-card" delay={0.08}>
                <div className="ic">✓</div>
                <h3>Accuracy guarantee</h3>
                <p>
                  If a mistake on our side causes a penalty, we put it right at
                  no extra cost.
                </p>
              </Reveal>
              <Reveal className="why-card" delay={0.16}>
                <div className="ic">✓</div>
                <h3>Rated by real clients</h3>
                <p>
                  Reviewed publicly on Trustpilot, so you can see what working
                  with us is actually like.
                </p>
              </Reveal>
            </div>
          </div>
        </section>

        {/* Who we help */}
        <section id="who" className="py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="section-head center">
              <span className="eyebrow">Who we help</span>
              <h2>{data.whoHeading}</h2>
              {data.whoIntro ? <p>{data.whoIntro}</p> : null}
            </div>
            <div className="who-grid">
              {data.whoCards.map((c) => (
                <div key={c.title} className="a-card">
                  <div className="ic">{c.numeral}</div>
                  <h3>{c.title}</h3>
                  <p>{c.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {data.extraAfterWho}

        {/* How it works. shared */}
        {data.howSteps ? (
          <CustomHowItWorks heading={data.howHeading} steps={data.howSteps} />
        ) : (
          <HowItWorks />
        )}

        {/* Pricing. shared, hidden for tax-advice */}
        {showPricing ? <PricingSection /> : null}

        {data.extraAfterPricing}

        {/* Consult band */}
        {showConsult ? (
          <section id="consult" className="py-8 sm:py-12">
            <div className="mx-auto max-w-6xl px-4 sm:px-6">
              <Reveal className="consult-band">
                <div>
                  <span className="eyebrow" style={{ color: "#7FD9F0" }}>
                    Not sure what you need?
                  </span>
                  <h2 className="mt-3">Book a 1-to-1 with an accountant.</h2>
                  <p>{data.consultCopy}</p>
                </div>
                <Link
                  href="/tax-advice"
                  className="btn-sl btn-sl-mint"
                >
                  Book a consultation
                </Link>
              </Reveal>
            </div>
          </section>
        ) : null}

        {/* FAQ */}
        <FaqAccordion faqs={data.faqs} />
      </main>
      <SiteFooter />
      <MobileCta />
    </div>
  );
}

function DefaultHeroCard() {
  return (
    <div
      className="relative mx-auto w-full max-w-md"
      style={{ perspective: "1200px" }}
    >
      <div className="app-card">
        <div className="app-card-top">
          <div className="app-dots">
            <span /><span /><span />
          </div>
          <span className="app-pill">● Filed on time</span>
        </div>
        <div className="app-row">
          <span className="l">Return</span>
          <span className="v">2025/26</span>
        </div>
        <div className="app-row">
          <span className="l">Accountant</span>
          <span className="v">R. Okafor, ACCA</span>
        </div>
        <div className="app-row">
          <span className="l">Status</span>
          <span className="v">Filed</span>
        </div>
        <div className="app-amount">
          <div className="cap">Expenses claimed</div>
          <div className="num">£3,180</div>
          <div className="app-bar">
            <div className="app-bar-fill" style={{ width: "80%" }} />
          </div>
        </div>
      </div>
      <div className="float-badge fb-1">
        <span className="ic">✓</span> Docs uploaded
      </div>
      <div className="float-badge fb-2">
        <span className="ic">£</span> Paid securely
      </div>
    </div>
  );
}

function CustomHowItWorks({
  heading,
  steps,
}: {
  heading?: string;
  steps: { n: number; title: string; body: string }[];
}) {
  return (
    <section id="how" className="py-24 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="section-head">
          <span className="eyebrow">How it works</span>
          <h2>{heading ?? "Three steps. That's genuinely it."}</h2>
        </div>
        <div className="flow-steps">
          {steps.map((s, i) => (
            <Reveal key={s.n} className="flow-step" delay={i * 0.12}>
              <div className="flow-num">{s.n}</div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
