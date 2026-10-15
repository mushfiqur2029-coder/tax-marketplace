// One-shot generator: writes the /guides hub and 8 article pages into
// marketing-static-export/guides/. The page shell (nav + footer) is
// identical to the rest of the static marketing site so SEO, mobile
// menu, and the live-pricing script all work without changes.
//
// Content is inlined below as plain strings. Rules:
//   - no em dashes or en dashes anywhere (hard repo rule)
//   - plain-English voice, matches the other pages
//   - every article ends with a CTA band (consultation or start-return)
//
// Idempotent: re-running overwrites each page cleanly.

import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "marketing-static-export", "guides");
const APP = "https://apisterlingledger.co.uk";

// Shared nav for every guides page. Contact is included alongside the
// other items so new pages ship with it from day one. The desktop and
// mobile versions mirror each other.
function nav() {
  return `<header class="sticky top-0 z-50 sl-nav-shell"><div class="mx-auto max-w-6xl px-4 sm:px-6"><div class="sl-nav-inner relative"><a class="inline-flex items-center gap-2 no-underline " href="/"><span aria-hidden="true" class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white text-sm font-bold" style="background:linear-gradient(135deg, var(--color-navy) 0%, var(--color-sky) 100%);font-family:var(--font-heading);letter-spacing:-0.02em">SL</span><span class="font-heading text-lg font-bold text-navy-deep" style="font-family:var(--font-heading)">Sterling<span class="text-sky">Ledger</span></span></a><nav class="hidden items-center gap-1 lg:flex"><a class="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold text-ink/70 transition hover:bg-sky/10 hover:text-ink" href="/#how">How it works</a><a class="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold text-ink/70 transition hover:bg-sky/10 hover:text-ink" href="/#audience">Who it&#x27;s for</a><a class="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold text-ink/70 transition hover:bg-sky/10 hover:text-ink" href="/#pricing">Pricing</a><a class="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold text-ink/70 transition hover:bg-sky/10 hover:text-ink" href="/#accountants">For accountants</a><a class="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold text-ink/70 transition hover:bg-sky/10 hover:text-ink" href="/#faq">FAQ</a><a class="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold text-ink/70 transition hover:bg-sky/10 hover:text-ink" href="/contact">Contact</a></nav><div class="flex items-center gap-1.5 sm:gap-2"><a class="btn-sl btn-sl-ghost hidden sm:inline-flex" href="${APP}/login">Log in</a><a class="btn-sl btn-sl-primary !px-4 !py-2.5 !text-[13px] sm:!px-5 sm:!py-2.5 sm:!text-[14.5px]" href="${APP}/register"><span class="sm:hidden">Start</span><span class="hidden sm:inline">Start your return</span></a><button type="button" data-mobile-menu-toggle="true" class="inline-flex h-11 w-11 items-center justify-center rounded-lg text-navy-deep transition hover:bg-sky/10 lg:hidden" aria-label="Open menu" aria-expanded="false"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg></button></div><div data-mobile-menu="true" class="mobile-panel lg:hidden"><a href="/#how">How it works</a><a href="/#audience">Who it&#x27;s for</a><a href="/#pricing">Pricing</a><a href="/#accountants">For accountants</a><a href="/#faq">FAQ</a><a href="/contact">Contact</a><div class="divider"></div><a href="${APP}/login">Log in</a><a class="btn-sl btn-sl-primary btn-sl-block mt-1" href="${APP}/register">Start your return</a></div></div></div></header>`;
}

function footer() {
  return `<footer class="pb-12 pt-16"><div class="mx-auto max-w-6xl px-4 sm:px-6"><div class="foot-cta"><span class="eyebrow">Ready when you are</span><h2>Get your tax off your plate.</h2><p>Start your return in a couple of minutes. The accountant part happens without you.</p><a class="btn-sl btn-sl-primary" href="${APP}/register">Start your return</a></div><div class="foot-grid"><div class="foot-brand"><div class="foot-logo"><b>Sterling Ledger</b></div><p>Tax and VAT, sorted by a real accountant.</p></div><div class="foot-cols"><div class="foot-col"><h4>Product</h4><a href="/#how">How it works</a><a href="/#pricing">Pricing</a><a href="/#faq">FAQ</a></div><div class="foot-col"><h4>Company</h4><a href="/#accountants">For accountants</a><a href="/about">About</a><a href="/guides">Guides</a><a href="/contact">Contact</a></div><div class="foot-col"><h4>Legal</h4><a href="/privacy">Privacy</a><a href="/terms">Terms</a></div></div></div><div class="foot-bottom"><span>© 2026 Sterling Ledger. All rights reserved.</span><span>Sterling Ledger is a trading name. Returns are prepared by independent, qualified accountants.</span></div></div></footer><div class="mobile-cta"><a class="btn-sl btn-sl-primary btn-sl-block" href="${APP}/register">Start your return, from £99</a></div>`;
}

function headCommon() {
  return `<meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>`;
}

function headTail() {
  return `<link rel="icon" href="/favicon.svg" type="image/svg+xml"/><link rel="icon" href="/favicon.png" type="image/png" sizes="48x48"/><link rel="apple-touch-icon" href="/apple-touch-icon.png"/><meta name="next-size-adjust" content=""/><link rel="stylesheet" href="/styles.css"/>`;
}

function page({ title, description, main }) {
  return `<!DOCTYPE html><html lang="en" data-scroll-behavior="smooth" class="inter_fe8b9d92-module__LINzvG__variable space_grotesk_44a0d8b8-module__tGMMGq__variable ibm_plex_mono_b1df0642-module__ou0oxa__variable h-full antialiased"><head>${headCommon()}<title>${title}</title><meta name="description" content="${description}"/>${headTail()}</head><body class="min-h-full flex flex-col font-sans bg-cloud text-ink"><div class="relative min-h-full flex flex-col">${nav()}<main class="flex-1">${main}</main>${footer()}</div><script src="/sterling.js" defer></script></body></html>`;
}

// Hub page: lists all guides as cards.
function hubMain(guides) {
  const cards = guides
    .map(
      (g) => `<a class="a-card" href="/guides/${g.slug}/" style="display:flex;flex-direction:column;text-decoration:none;color:inherit"><div class="ic">${g.icon}</div><h3>${g.cardTitle}</h3><p>${g.cardBlurb}</p><span class="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-navy-deep">Read the guide<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 10h12M11 5l5 5-5 5"></path></svg></span></a>`,
    )
    .join("");
  return `<section class="relative overflow-hidden"><div class="blob-field" aria-hidden="true"><div class="blob blob-1"></div><div class="blob blob-2"></div><div class="blob blob-3"></div></div><div class="relative z-10 mx-auto max-w-3xl px-4 py-20 sm:px-6 sm:py-28 text-center"><span class="eyebrow">Guides</span><h1 class="mt-5 text-4xl leading-tight sm:text-5xl" style="font-family:var(--font-heading)">Plain-English UK tax guides.</h1><p class="mx-auto mt-6 max-w-xl text-base text-slate sm:text-lg">Short, honest explainers for people dealing with HMRC for the first (or hundredth) time. Written by the same accountants who file our clients&#x27; returns.</p></div></section><section class="pb-20 sm:pb-24"><div class="mx-auto max-w-6xl px-4 sm:px-6"><div class="who-grid">${cards}</div><div class="mt-14"><div class="consult-band"><div><span class="eyebrow" style="color:#7FD9F0">Still unsure?</span><h2 class="mt-3">Book a 1-to-1 with an accountant.</h2><p>Thirty minutes, straight answers, specific to your situation.</p></div><a class="btn-sl btn-sl-mint" href="/tax-advice">Book a consultation</a></div></div></div></section>`;
}

// Article template. Takes the hero (eyebrow/title/intro) and the body
// HTML (already assembled as <h2>/<p>/<ul> blocks).
function articleMain({ eyebrow, h1, intro, body, cta }) {
  const ctaHtml =
    cta === "start"
      ? `<a class="btn-sl btn-sl-primary" href="${APP}/register">Start your return<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 10h12M11 5l5 5-5 5"></path></svg></a><a class="btn-sl btn-sl-ghost" href="/tax-advice">Talk to an accountant first</a>`
      : `<a class="btn-sl btn-sl-primary" href="/tax-advice">Book a consultation<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 10h12M11 5l5 5-5 5"></path></svg></a><a class="btn-sl btn-sl-ghost" href="${APP}/register">Or start your return</a>`;
  return `<section class="relative overflow-hidden"><div class="blob-field" aria-hidden="true"><div class="blob blob-1"></div><div class="blob blob-2"></div></div><div class="relative z-10 mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20"><div class="breadcrumb"><a href="/">Home</a> / <a href="/guides">Guides</a> / ${eyebrow}</div><span class="eyebrow mt-5">${eyebrow}</span><h1 class="mt-5 text-4xl leading-[1.08] sm:text-5xl" style="font-family:var(--font-heading)">${h1}</h1><p class="mt-6 max-w-2xl text-base text-slate sm:text-lg">${intro}</p></div></section><section class="pb-20"><article class="mx-auto max-w-3xl px-4 sm:px-6 guide-prose">${body}</article><div class="mx-auto mt-14 max-w-6xl px-4 sm:px-6"><div class="consult-band"><div><span class="eyebrow" style="color:#7FD9F0">Ready when you are</span><h2 class="mt-3">Get this done properly, first time.</h2><p>Flat fee. Qualified accountant. Filed on time.</p></div>${ctaHtml}</div></div></section>`;
}

// ---------------------------------------------------------------
// Content: guide definitions. slug -> metadata + article body HTML.
// ---------------------------------------------------------------

const GUIDES = [
  {
    slug: "self-assessment-deadlines",
    icon: "①",
    cardTitle: "Self Assessment deadlines and penalties",
    cardBlurb:
      "The key UK Self Assessment dates, what HMRC charges when you miss them, and the simple way to avoid the lot.",
    seoTitle:
      "Self Assessment deadlines and penalties. What happens if you file late.",
    seoDescription:
      "The UK Self Assessment deadlines, how HMRC charges late-filing penalties and interest, and the simple way to avoid both.",
    heroH1: "Self Assessment deadlines, and what late filing costs you.",
    heroIntro:
      "The dates HMRC cares about, the penalties that build up when you miss them, and the practical steps to stay out of trouble.",
    cta: "start",
    body: `<h2>The dates that matter</h2><p>Self Assessment covers the UK tax year from 6 April to 5 April. For the year that ended 5 April 2025, the key dates are:</p><ul><li><strong>5 October 2025</strong>, the deadline to register with HMRC if this is your first return.</li><li><strong>31 October 2025</strong>, the paper return deadline. Almost nobody uses this.</li><li><strong>31 January 2026</strong>, the online return deadline, and the deadline to pay what you owe.</li><li><strong>31 July 2026</strong>, the second payment on account, if HMRC asked you for one.</li></ul><h2>What missing the deadline costs you</h2><p>Miss the online return deadline by one day and HMRC charges a fixed £100 penalty, even if your final tax bill is zero. The penalty does not go away just because you had nothing to pay.</p><p>After three months late, HMRC adds £10 per day for up to 90 days, so another £900. At six months late, you pay an extra 5% of the tax owed or £300, whichever is higher. At twelve months late, another 5% or £300.</p><p>The tax itself attracts interest from 1 February at the Bank of England base rate plus 2.5%. On top of that there are late-payment penalties: 5% of the unpaid tax after 30 days, another 5% after six months, another 5% after twelve months. Stacked together, late filing on a modest tax bill can easily double what you owe.</p><h2>If cashflow is tight</h2><p>Set up a Time to Pay arrangement with HMRC before the 31 January deadline, not after. HMRC will almost always agree to a monthly plan if you ask early. The arrangement does not stop interest, but it does stop the late-payment penalties, which is the expensive bit.</p><h2>Reasonable excuse appeals</h2><p>If you genuinely could not file on time (serious illness, bereavement, HMRC system failure on the day), you can appeal. Simple forgetfulness and &quot;I was too busy&quot; do not count. The burden of proof is on you.</p><h2>The practical advice</h2><p>Our standard turnaround once you have uploaded everything we need is seven to ten working days. If you are reading this in January, you are not too late, but every day you wait makes it harder to find an accountant with capacity. Start now, and let someone qualified handle the paperwork.</p>`,
  },
  {
    slug: "going-self-employed",
    icon: "②",
    cardTitle: "Going self-employed in the UK",
    cardBlurb:
      "A clean checklist for your first year as a sole trader: when to tell HMRC, what to pay in National Insurance, and what records to keep.",
    seoTitle:
      "Going self-employed in the UK. What to register for and when.",
    seoDescription:
      "A plain-English checklist for new sole traders: when to tell HMRC, what to pay in National Insurance, and what records to keep.",
    heroH1: "You went self-employed. Here is what to do next.",
    heroIntro:
      "The registration, the National Insurance, and the record-keeping. Clear, in order, and in English.",
    cta: "start",
    body: `<h2>Tell HMRC you exist</h2><p>If you started working for yourself at any point in a tax year, you must register with HMRC by 5 October of the following tax year. So if you went self-employed in July 2025, you must register by 5 October 2026. Register through gov.uk using the CWF1 form, or sign into your Government Gateway account and add Self Assessment to it.</p><p>HMRC posts you a Unique Taxpayer Reference (UTR), a ten-digit code. Keep it safe. You will need it every time you file.</p><h2>What you will pay</h2><p>Income tax at the normal personal rates on your profit (what you earn minus allowable expenses), after the £12,570 Personal Allowance.</p><p>National Insurance comes in two flavours for sole traders:</p><ul><li><strong>Class 2</strong>, a flat weekly amount of £3.45. Payable through Self Assessment if your profits are £6,725 or more.</li><li><strong>Class 4</strong>, 6% on profits between £12,570 and £50,270, then 2% on anything above.</li></ul><h2>VAT is a separate conversation</h2><p>You only register for VAT if your taxable turnover is over £90,000 in any rolling 12-month period, or if you expect to pass that in the next 30 days. We cover VAT registration in its own guide.</p><h2>What to keep</h2><p>HMRC can look back five years. Keep everything for at least that long:</p><ul><li>Every invoice you raise, and every receipt you spend.</li><li>Business bank statements.</li><li>A mileage log if you drive for work.</li><li>A note of personal use for anything used partly for work: phone, car, home office.</li></ul><h2>The one tip that will save you hours later</h2><p>Open a separate bank account for your business. For a sole trader it is not legally required, but at year-end it saves hours of reconciliation, and it makes HMRC&#x27;s definition of an allowable business expense much easier to prove.</p><h2>How much to set aside</h2><p>A reasonable rule for someone earning £30,000 to £50,000 is to park 25% to 30% of what you take in. The exact figure depends on your allowable expenses, but underestimating is where new sole traders get caught out. The 31 January tax bill arrives whether you have saved for it or not.</p>`,
  },
  {
    slug: "landlord-tax-basics",
    icon: "③",
    cardTitle: "Landlord tax basics",
    cardBlurb:
      "What UK landlords can deduct from rental income, how mortgage interest relief works now, and the repair vs improvement trap.",
    seoTitle: "Landlord tax basics. What counts as an allowable expense.",
    seoDescription:
      "What UK landlords can deduct from rental income, how mortgage interest relief works now, and where the common mistakes are.",
    heroH1: "Landlord tax, done the right way.",
    heroIntro:
      "Rental profit, not rental income, is what you pay tax on. Here is what comes off, what does not, and the mortgage interest rule that catches most landlords out.",
    cta: "start",
    body: `<h2>You are taxed on profit, not rent</h2><p>UK landlords pay income tax on rental profits. Profit is rent received in the tax year, minus allowable expenses in the same year. Not the gross figure from your bank.</p><h2>What is allowable</h2><ul><li>Letting agent and management fees.</li><li>Insurance: buildings, contents, landlord liability.</li><li>Council tax and utilities for any period you were covering them (between tenants, or in HMOs).</li><li>Repairs and maintenance (not improvements, see below).</li><li>Service charges and ground rent on a leasehold property.</li><li>Legal fees for a lease shorter than one year, or renewal of a lease of less than 50 years.</li><li>Accountant fees for preparing the rental part of your return.</li><li>Mileage to the property at 45p per mile for the first 10,000 miles, then 25p after.</li></ul><h2>The mortgage interest rule</h2><p>Since April 2020, you no longer deduct mortgage interest from rental income directly. Instead you get a basic-rate tax credit worth 20% of the interest you paid. For a basic-rate taxpayer this is roughly neutral. For a higher-rate taxpayer it costs real money, because you are effectively paying tax on income you never saw.</p><p>If the property is held in a limited company, this rule does not apply and interest is fully deductible against company profits. Whether that is worth the restructuring cost is a separate question.</p><h2>Repair or improvement</h2><p>This is where most mistakes happen. The test is like-for-like replacement.</p><ul><li>A broken boiler replaced with a similar-spec boiler is a repair. Deductible this year.</li><li>A kitchen refit that upgrades layout and specification is an improvement. Not deductible against rental income, but it increases your base cost for capital gains tax when you sell.</li><li>Replacing a carpet with a similar carpet, or a sofa with a similar sofa in a furnished let, is covered by Replacement of Domestic Items relief. Deductible.</li></ul><h2>Multiple properties</h2><p>UK property is treated as one business for tax, even if you own several. You pool the rents and expenses across properties and declare one net figure. Losses on one property offset profits on another in the same year. Unused losses carry forward.</p>`,
  },
  {
    slug: "vat-registration",
    icon: "④",
    cardTitle: "VAT registration and schemes",
    cardBlurb:
      "The UK VAT threshold, when registration is compulsory, and a plain-English look at the three main schemes.",
    seoTitle:
      "VAT registration. When you must register and which scheme to use.",
    seoDescription:
      "The UK VAT threshold, when registration is compulsory, and a plain-English look at the three main schemes.",
    heroH1: "VAT registration, in plain English.",
    heroIntro:
      "When you must register, when you can register voluntarily, and which of the three main schemes probably fits.",
    cta: "start",
    body: `<h2>You must register when either is true</h2><ul><li>Your taxable turnover in any rolling 12 months has gone over <strong>£90,000</strong>.</li><li>You expect to go over £90,000 in the next 30 days alone, for example a single large contract.</li></ul><p>Taxable turnover means sales of goods and services that would carry VAT if you were registered. Some supplies are exempt (certain financial services, insurance, education, residential rent), and those do not count toward the threshold.</p><h2>What changes once you register</h2><p>You charge VAT on your invoices, you reclaim VAT on your business purchases, and you file quarterly VAT returns to HMRC through Making Tax Digital compatible software. The deadline for each return is one month and seven days after the end of the VAT quarter.</p><h2>The three schemes worth knowing</h2><h3>Standard VAT</h3><p>The default. You charge 20% output VAT on sales, reclaim 20% input VAT on purchases, and pay HMRC the difference. Best for businesses that buy a lot from VAT-registered suppliers, because you get the input VAT back.</p><h3>Flat Rate Scheme</h3><p>You charge full VAT to your customers but pay HMRC a fixed percentage of your gross turnover and keep the difference. The percentage depends on your industry. You cannot reclaim input VAT on most purchases.</p><p>Simpler administratively, and sometimes financially better for service businesses with few costs. Available if your taxable turnover is £150,000 or less.</p><h3>Cash Accounting Scheme</h3><p>You account for VAT only when money actually moves (customer pays you, you pay a supplier), rather than when invoices are issued. Useful if you have slow-paying customers. Available if your taxable turnover is £1.35 million or less.</p><h2>Voluntary registration</h2><p>You can register below £90,000. It is worth doing if your customers are VAT-registered businesses (they do not care about the extra 20% because they reclaim it) and your purchases carry a lot of input VAT you would otherwise lose.</p><h2>Timing matters</h2><p>If you breach the threshold on, say, 30 June, you have until 30 July to tell HMRC. You must start charging VAT from 1 August. Late registration brings penalties plus the VAT you should have charged, which in practice you often cannot recover from past customers. Watch the number as you grow.</p>`,
  },
  {
    slug: "cis-subcontractor-rebate",
    icon: "⑤",
    cardTitle: "CIS subcontractors and the rebate",
    cardBlurb:
      "How the Construction Industry Scheme deducts tax at source, and the simple way to reconcile it and claim your refund.",
    seoTitle:
      "CIS subcontractors. How the rebate works and what you are owed.",
    seoDescription:
      "The Construction Industry Scheme explained for subcontractors, with the simple way to reconcile deductions and claim your refund.",
    heroH1: "CIS subcontractors, and how your rebate actually works.",
    heroIntro:
      "The deduction has already gone to HMRC. You get the overpaid part back through Self Assessment. Here is the plain version.",
    cta: "start",
    body: `<h2>What CIS actually does</h2><p>Under the Construction Industry Scheme, contractors in the UK construction sector must deduct tax at source from payments to their subcontractors. If you are the subcontractor, that money has already gone to HMRC on your behalf. You get it back (or part of it) through your Self Assessment return.</p><h2>The deduction rate depends on your status</h2><ul><li><strong>20%</strong> if you are CIS-registered and HMRC has verified you. This is the usual rate for most subcontractors.</li><li><strong>30%</strong> if you are not registered under CIS. Register as soon as possible to drop to 20%.</li><li><strong>0%</strong> if you have gross-payment status, which has strict turnover and compliance criteria.</li></ul><h2>How the reconciliation works</h2><p>Every month, your contractor should give you a CIS statement showing gross pay, deductions, and net pay. Keep every single one. These are your proof when it comes to filing.</p><p>On your Self Assessment, you declare your <strong>gross income</strong> from CIS work (not net), then claim the total deductions as tax already paid. If the deductions were more than your final tax bill plus Class 2 and Class 4 National Insurance for the year, HMRC refunds the difference.</p><h2>Why rebates are the common outcome</h2><p>For most sole-trader subcontractors with normal running expenses, 20% deducted at source is more than their eventual tax bill works out to. The 20% applies to gross income, but you only pay tax on profit after expenses. So the maths usually leaves HMRC owing you money, not the other way round.</p><h2>What boosts the rebate</h2><p>Anything that reduces your taxable profit:</p><ul><li>Tools and consumables.</li><li>PPE and work clothing.</li><li>Mileage to each site (not your normal commute).</li><li>Phone and admin costs, work portion only.</li><li>Public liability insurance.</li><li>Accountant fees for preparing the return.</li></ul><h2>Keep two things</h2><p>Every receipt, and every CIS statement. The two together are what we use to work out exactly what you are owed. HMRC usually pays the rebate into your bank within three to four weeks of the return being filed.</p>`,
  },
  {
    slug: "sole-trader-vs-limited-company",
    icon: "⑥",
    cardTitle: "Sole trader or limited company",
    cardBlurb:
      "A grounded look at the tradeoffs, with the profit level at which the choice usually flips.",
    seoTitle: "Sole trader or limited company. Which to pick, and when.",
    seoDescription:
      "A grounded look at the tradeoffs between operating as a UK sole trader and as a limited company, with the point at which the choice usually flips.",
    heroH1: "Sole trader or limited company. Which one, when.",
    heroIntro:
      "There is no single right answer, but there is a profit level where the maths and the practicalities start to tilt.",
    cta: "consult",
    body: `<h2>Sole trader is simpler</h2><ul><li>You and the business are the same legal entity.</li><li>One Self Assessment return per year.</li><li>No separate accounts to file at Companies House.</li><li>Profit taxed at your personal income tax rates plus Class 2 and Class 4 NI.</li><li>Losses can be set against your other income in the same year.</li></ul><h2>Limited company gives separation and (eventually) efficiency</h2><ul><li>A separate legal entity. Your personal assets are generally protected from business liabilities.</li><li>Pays Corporation Tax on profits, currently 19% up to £50,000 of profit, tapering to 25% at £250,000.</li><li>You extract money as a mix of salary and dividends, which at higher income levels is taxed at lower combined rates than straight self-employment.</li><li>Must file annual accounts at Companies House, a Corporation Tax return (CT600) at HMRC, and your personal Self Assessment covering dividends and salary.</li></ul><h2>Where each one actually works</h2><h3>Under about £30,000 profit</h3><p>Sole trader is usually both simpler and no more expensive. The limited company&#x27;s lower tax rates do not yet offset the extra accounting cost and administrative load.</p><h3>Between £30,000 and £50,000 profit</h3><p>Depends on your situation. If you need the limited liability (property work, consulting with large clients, anything with real downside risk) or if you want to leave profit in the business to reinvest rather than draw it out, a company starts to make sense. If you need every penny personally, sole trader is still the practical pick.</p><h3>Above £50,000 profit</h3><p>Especially if you can leave some profit in the company and draw dividends efficiently, a limited company usually wins on total tax paid. The admin cost becomes a small percentage of the saving.</p><h2>Non-tax reasons to incorporate</h2><ul><li>Clients requiring you to invoice through a limited company.</li><li>Protecting personal assets against real business liabilities.</li><li>Making the business easier to sell or bring investors into later.</li></ul><h2>Non-tax reasons not to</h2><ul><li>You want to use all the money personally and quickly. Dividend-only extraction has a 1 January tax lag that catches new company owners out.</li><li>Your work is low-margin, where the extra admin cost would eat the saving.</li></ul><p>The right call is specific to your numbers. A thirty-minute consultation gets to the answer faster than any blog post.</p>`,
  },
  {
    slug: "private-hire-driver-tax",
    icon: "⑦",
    cardTitle: "Uber, Bolt, and private-hire driver tax",
    cardBlurb:
      "What UK private-hire drivers pay tax on, which expenses actually come off, and the record-keeping that saves you money.",
    seoTitle: "Uber, Bolt, and private-hire driver tax basics.",
    seoDescription:
      "What UK private-hire drivers pay tax on, which expenses actually come off, and the simple record-keeping that saves you money.",
    heroH1: "Driving for Uber or Bolt? Here is your tax.",
    heroIntro:
      "HMRC gets your earnings data from the platforms now. The simplest way to come out ahead is to know what you can claim.",
    cta: "start",
    body: `<h2>You are self-employed</h2><p>If you drive for Uber, Bolt, Addison Lee, or any licensed private-hire operator, HMRC treats you as self-employed. The platform does not withhold tax. You are responsible for registering with HMRC, filing a Self Assessment every year, and paying income tax plus National Insurance on your profit.</p><p>Platforms now share driver earnings with HMRC under the UK&#x27;s digital-platform reporting rules. HMRC already knows what Uber paid you. Not declaring is not a quiet option any more.</p><h2>You are taxed on profit, not gross fares</h2><p>Profit is gross fares received minus allowable expenses in the same tax year.</p><h2>What you can claim</h2><ul><li>Fuel used for work driving.</li><li>Vehicle insurance, specifically the private-hire policy.</li><li>Vehicle maintenance, servicing, MOT, tyres, breakdown cover.</li><li>Vehicle finance interest (not the capital portion of a loan or lease).</li><li>Platform fees and commission (Uber or Bolt&#x27;s cut).</li><li>Private-hire licence renewal and medical fees.</li><li>Phone bill, business portion only.</li><li>Cleaning and valeting.</li></ul><h2>Mileage method or actual costs</h2><p><strong>Mileage method.</strong> A flat 45p per business mile for the first 10,000 miles each tax year, then 25p after. This single number covers fuel, insurance, servicing, and depreciation. Record every work trip. Simple and robust.</p><p><strong>Actual costs.</strong> Add up every running expense for the year and claim the business-use percentage. For drivers who use their car heavily for work with clean records, actual costs often beats the 45p figure, but the paperwork is heavier.</p><p>You cannot mix the two methods. Pick one for a given vehicle and stick with it.</p><h2>Keep these</h2><ul><li>Odometer reading at start and end of the tax year.</li><li>A weekly or monthly summary of business miles.</li><li>Fuel receipts if you are using actual costs.</li><li>Platform statements and payouts, every one.</li></ul><h2>One trap</h2><p>Your licence renewal and annual medical are tax-deductible. The <em>first-time</em> licence application fee is not. HMRC treats it as the cost of becoming qualified for the work, not the cost of staying qualified.</p>`,
  },
  {
    slug: "gig-economy-tax",
    icon: "⑧",
    cardTitle: "Gig economy tax (Deliveroo, Uber Eats, Amazon Flex)",
    cardBlurb:
      "If you earn through delivery or short-task apps in the UK, here is what counts, what you owe, and the £1,000 allowance.",
    seoTitle:
      "Gig economy tax. Deliveroo, Uber Eats, and what to declare.",
    seoDescription:
      "If you earn money through delivery apps, platforms, or short-task gigs in the UK, here is what counts, what you owe, and what you can claim.",
    heroH1: "Gig economy earnings and the tax that follows.",
    heroIntro:
      "Deliveroo, Uber Eats, Amazon Flex, Just Eat, Stuart, TaskRabbit. If a platform pays you, HMRC knows. Here is what to do with it.",
    cta: "start",
    body: `<h2>You are self-employed for tax</h2><p>If you earn money through a UK gig platform, you are self-employed for tax purposes. The platform pays you in full and leaves tax to you.</p><p>Under UK digital-platform reporting rules, HMRC now receives earnings data directly from the apps. If you took home over £1,000 gross in the tax year across any combination of platforms, you need to be on HMRC&#x27;s radar.</p><h2>The £1,000 trading allowance</h2><ul><li><strong>Gross income under £1,000</strong> in a tax year: no need to declare. The trading allowance covers it.</li><li><strong>Over £1,000</strong>: you must register for Self Assessment and declare. You then either deduct the £1,000 allowance from gross income (simplest), or claim actual allowable expenses, whichever gives the lower taxable figure. You cannot do both.</li></ul><h2>What counts as an allowable expense</h2><ul><li>Mileage for every work trip (45p per mile for the first 10,000 miles, then 25p).</li><li>Phone bill, work portion only.</li><li>Bike maintenance, delivery bags, waterproofs if you ride.</li><li>Platform fees or commission deducted after the fact, if any.</li><li>Public liability insurance if you took one out.</li></ul><h2>Mileage versus actual costs</h2><p>Same rule as private-hire drivers. The mileage method is simpler and works well for most gig riders. Actual costs can win if your vehicle is heavily used for work and you have clean records, but every receipt has to be there.</p><h2>Side income on top of a PAYE job</h2><p>You still declare gig earnings even if you have a day job that pays you through PAYE. Your Self Assessment combines the PAYE income (already taxed through payroll) with your gig profit, and HMRC calculates the extra tax owed. The PAYE job does not shelter gig earnings.</p><h2>National Insurance</h2><ul><li>Class 2 kicks in at £6,725 of profit, a flat £3.45 per week.</li><li>Class 4 kicks in at £12,570 of profit, 6% up to £50,270 then 2% above.</li></ul><p>Below £6,725 profit, no NI applies, but income tax still kicks in above the Personal Allowance of £12,570 (combined with any other income).</p><h2>Quick test</h2><p>Did one or more apps pay you more than £1,000 gross in the tax year? If yes, you are filing.</p>`,
  },
];

async function main() {
  await mkdir(OUT, { recursive: true });

  // Hub.
  const hubHtml = page({
    title: "UK tax guides. Plain-English explainers for individuals and businesses.",
    description:
      "Practical UK tax guides: Self Assessment basics, landlord returns, limited company essentials, VAT, and more.",
    main: hubMain(GUIDES),
  });
  await writeFile(join(OUT, "index.html"), hubHtml);
  console.log("wrote guides/index.html");

  // Articles.
  for (const g of GUIDES) {
    const html = page({
      title: g.seoTitle,
      description: g.seoDescription,
      main: articleMain({
        eyebrow: g.cardTitle,
        h1: g.heroH1,
        intro: g.heroIntro,
        body: g.body,
        cta: g.cta,
      }),
    });
    const dir = join(OUT, g.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.html"), html);
    console.log("wrote guides/" + g.slug + "/index.html");
  }

  console.log("\nDone. " + (GUIDES.length + 1) + " pages written.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
