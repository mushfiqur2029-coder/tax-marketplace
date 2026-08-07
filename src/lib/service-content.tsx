import type { ServicePageData } from "@/components/marketing/service-page";

// Copy sourced verbatim from design-reference/content-briefs-remaining-pages.md
// and design-reference/service-self-employed.html. Do not invent new copy.

export const selfEmployedPage: ServicePageData = {
  slug: "self-employed",
  breadcrumb: "Self-employed",
  eyebrow: "Self-employed tax",
  h1: "",
  h1Jsx: (
    <>
      You run the business.
      <br />
      We handle the <span className="gradient-text">tax.</span>
    </>
  ),
  lede:
    "Every deduction found, every deadline met. Answer a few questions, upload your records, and a UK-qualified accountant prepares and files your return from £99.",
  whoHeading: "Whatever kind of self-employed you are.",
  whoIntro:
    "Sole traders, freelancers, and contractors across every trade. Your accountant has almost certainly filed for someone in your exact line of work before.",
  whoCards: [
    {
      numeral: "①",
      title: "Sole traders",
      body: "Income, expenses, and allowable deductions handled by someone who knows your trade inside out.",
    },
    {
      numeral: "②",
      title: "Freelancers & contractors",
      body: "Multiple clients, irregular income, and mixed expenses, sorted into a return that holds up.",
    },
    {
      numeral: "③",
      title: "Side income",
      body: "Running a business alongside a main job? Declared correctly without overpaying either side.",
    },
  ],
  consultCopy:
    "Should you be a sole trader or a limited company? What can you actually expense? Get a straight answer on a 30 minute call before you commit to anything, from £129.",
  faqs: [
    {
      q: "Can I do this if I just started freelancing this year?",
      a: "Yes. First-year returns are one of the most common cases we file. Your accountant will make sure you're registered with HMRC correctly at the same time.",
    },
    {
      q: "What expenses can I actually claim as a sole trader?",
      a: "It depends on your trade. Your accountant will review your records and tell you exactly which of your costs qualify. Common ones include a portion of home costs, phone, travel, and tools.",
    },
    {
      q: "Do I have to use bookkeeping software?",
      a: "No. If you have your records in a spreadsheet or even a shoebox of receipts, that's fine. Just upload what you have.",
    },
    {
      q: "What if my income is under the personal allowance?",
      a: "You may still need to file. Your accountant will confirm whether HMRC expects a return and file a nil return if that's appropriate.",
    },
  ],
};

export const landlordsPage: ServicePageData = {
  slug: "landlords",
  breadcrumb: "Landlords",
  eyebrow: "Landlord tax",
  h1: "Your rental income. Filed without the headache.",
  lede:
    "Whether it's one flat or a full portfolio, a UK-qualified accountant handles your Self Assessment, works out what you can claim, and files it correctly.",
  whoHeading: "Whatever your landlord setup looks like.",
  whoCards: [
    {
      numeral: "①",
      title: "Single property",
      body: "Rental income, mortgage interest relief, and allowable expenses, filed correctly.",
    },
    {
      numeral: "②",
      title: "Portfolio landlords",
      body: "Multiple properties and multiple income streams, one accountant across all of it.",
    },
    {
      numeral: "③",
      title: "Airbnb and short-let hosts",
      body: "Different rules apply to short-term lets. Your accountant knows which ones.",
    },
  ],
  consultCopy:
    "Not sure if incorporating your portfolio makes sense? Book a 1-to-1 before you decide.",
  faqs: [
    {
      q: "Do I need to file if I only rent out one room?",
      a: "Possibly, depending on how much you earn. Your accountant will check whether the Rent a Room scheme covers you or if you need to file.",
    },
    {
      q: "What expenses can I claim as a landlord?",
      a: "Repairs, insurance, letting agent fees, and mortgage interest (via a tax credit) are common ones. Your accountant will review your records against the current rules.",
    },
    {
      q: "What is Making Tax Digital for landlords, and when does it affect me?",
      a: "MTD for Income Tax becomes mandatory in stages from April 2026 for landlords earning over £50,000. We'll get you set up before it applies to you.",
    },
    {
      q: "Can I claim mortgage interest as an expense?",
      a: "Not directly since 2020. You get a 20% tax credit instead. Your accountant handles the calculation.",
    },
  ],
};

export const firstTimeFilersPage: ServicePageData = {
  slug: "first-time-filers",
  breadcrumb: "First-time filers",
  eyebrow: "First tax return",
  h1: "Your first Self Assessment. Done properly, first time.",
  lede:
    "New to filing? You're not expected to know the rules. Answer a short questionnaire and a qualified accountant takes it from there.",
  whoHeading: "Whichever way you ended up here.",
  whoCards: [
    {
      numeral: "①",
      title: "New to self-employment",
      body: "Just started freelancing or trading? We'll tell you exactly what's needed.",
    },
    {
      numeral: "②",
      title: "Side income",
      body: "A first return triggered by a second income stream on top of a main job.",
    },
    {
      numeral: "③",
      title: "HMRC told you to file",
      body: "Received a letter out of the blue? We'll help you understand why and get it done.",
    },
  ],
  consultCopy:
    "Confused about whether you even need to file? Ask an accountant directly.",
  faqs: [
    {
      q: "How do I know if I need to file a Self Assessment at all?",
      a: "Common triggers: you earned over £1,000 from self-employment or side income, over £150,000 from a salary, £10,000+ from savings and investments, or HMRC sent you a notice. Your accountant will check on the consultation.",
    },
    {
      q: "What happens if I miss the deadline?",
      a: "There's an automatic £100 fine, then daily penalties after 3 months. If you're already late, we can still file. the faster we do it, the less it costs.",
    },
    {
      q: "Do I need to register with HMRC before I file?",
      a: "Yes, and if you haven't, your accountant will do it for you as part of the return.",
    },
    {
      q: "What documents do I actually need?",
      a: "Whatever you have: P60, P45, invoices, bank statements, receipts. Upload what you've got; your accountant will tell you if anything's missing.",
    },
  ],
};

export const investorsPage: ServicePageData = {
  slug: "investors",
  breadcrumb: "Investors",
  eyebrow: "Investor tax",
  h1: "Capital gains, sorted properly.",
  lede:
    "Shares, crypto, property, or a business sale. Get your Capital Gains Tax worked out and filed by someone who deals with this every day.",
  whoHeading: "For every kind of disposal.",
  whoCards: [
    {
      numeral: "①",
      title: "Share and fund sales",
      body: "Realised gains from investing, calculated and reported correctly.",
    },
    {
      numeral: "②",
      title: "Crypto disposals",
      body: "Every taxable event tracked and worked out, not just the obvious ones.",
    },
    {
      numeral: "③",
      title: "Property and business sales",
      body: "Larger, one-off gains that need careful handling.",
    },
  ],
  consultCopy:
    "Thinking about when to sell? A quick call before you do can save real money.",
  faqs: [
    {
      q: "Do I owe Capital Gains Tax or Income Tax on this?",
      a: "Depends on the asset and how you held it. Your accountant will classify each disposal correctly.",
    },
    {
      q: "What's my Capital Gains Tax allowance this year?",
      a: "£3,000 for 2024/25, down from £6,000. Below that, no CGT is due. Above it, tax kicks in.",
    },
    {
      q: "Do I need to report a loss as well as a gain?",
      a: "Yes. reporting losses lets you offset them against future gains. We'll make sure they're recorded.",
    },
    {
      q: "How does crypto get taxed in the UK?",
      a: "Every disposal (sale, swap, or spend) is a taxable event. Your accountant will work through your transaction history and calculate the position.",
    },
  ],
};

export const highEarnersPage: ServicePageData = {
  slug: "high-earners",
  breadcrumb: "High earners",
  eyebrow: "High earner tax",
  h1: "Complex income. Straightforward filing.",
  lede:
    "Multiple income sources, tapered allowances, and higher-rate thresholds. An accountant who works with high earners regularly keeps it all correct.",
  whoHeading: "When your income is anything but simple.",
  whoCards: [
    {
      numeral: "①",
      title: "Multiple income streams",
      body: "Salary, dividends, rental, and investment income, brought together properly.",
    },
    {
      numeral: "②",
      title: "Tapered allowances",
      body: "Personal Allowance and pension annual allowance tapering, calculated correctly.",
    },
    {
      numeral: "③",
      title: "Bonus and share schemes",
      body: "Employer share schemes and bonus structures, reported accurately.",
    },
  ],
  consultCopy:
    "Want a tax-efficiency review before the year ends? Book a 1-to-1.",
  faqs: [
    {
      q: "At what income does my Personal Allowance start reducing?",
      a: "Above £100,000, your Personal Allowance is reduced by £1 for every £2 over that. It's gone entirely at £125,140.",
    },
    {
      q: "How does the additional rate threshold work?",
      a: "45% additional rate kicks in at £125,140. Your accountant makes sure the right bands are applied to each part of your income.",
    },
    {
      q: "Can pension contributions reduce my tax bill?",
      a: "Yes, subject to the annual allowance (which itself tapers at higher incomes). We'll calculate the optimal position for you.",
    },
    {
      q: "Do I need to declare dividend income separately?",
      a: "Yes. dividends have their own rates and allowance (£500 for 2024/25). Your accountant will report them alongside your other income.",
    },
  ],
};

export const expatsPage: ServicePageData = {
  slug: "expats",
  breadcrumb: "Expats",
  eyebrow: "Expat tax",
  h1: "UK tax, wherever you're living.",
  lede:
    "Moved abroad, moved to the UK, or earning UK income while living elsewhere. Residency rules are complicated. Getting them right isn't.",
  whoHeading: "Whichever direction you moved.",
  whoCards: [
    {
      numeral: "①",
      title: "Moving abroad",
      body: "Understand what UK tax still applies once you've left.",
    },
    {
      numeral: "②",
      title: "Moving to the UK",
      body: "First time paying UK tax? We'll get your residency status right from the start.",
    },
    {
      numeral: "③",
      title: "UK income while living overseas",
      body: "Rental income, pensions, or investments still taxed in the UK.",
    },
  ],
  consultCopy:
    "Not sure about your residency status? That's exactly what the consultation is for.",
  faqs: [
    {
      q: "How does the Statutory Residence Test work?",
      a: "It's a set of rules that determine whether you're UK-resident for tax purposes in a given year, based on days spent here and other ties. Your accountant will apply it to your situation.",
    },
    {
      q: "Do I pay UK tax on foreign income?",
      a: "Depends on your residency and domicile. Non-UK residents generally don't pay UK tax on foreign income; residents usually do.",
    },
    {
      q: "What's a split-year treatment?",
      a: "In the year you arrive or leave the UK, tax can sometimes be split so you're only UK-resident for part of the year. We'll check if that applies to you.",
    },
    {
      q: "Do I still need to file if I've left the UK?",
      a: "Often yes, at least for the year you leave, plus any year you have UK income. Your accountant will confirm and file if needed.",
    },
  ],
};

export const cisConstructionPage: ServicePageData = {
  slug: "cis-construction",
  breadcrumb: "CIS / Construction",
  eyebrow: "CIS tax",
  h1: "Most CIS workers are owed a refund. Let's find yours.",
  lede:
    "Construction Industry Scheme deductions are usually higher than what you actually owe. An accountant checks and claims back what's yours.",
  whoHeading: "For everyone on the tools.",
  whoCards: [
    {
      numeral: "①",
      title: "Subcontractors",
      body: "CIS deductions reviewed against your actual expenses and tax owed.",
    },
    {
      numeral: "②",
      title: "Multiple contractors",
      body: "Income and deductions from several sites and contractors, brought together.",
    },
    {
      numeral: "③",
      title: "Tools and travel expenses",
      body: "The expenses CIS workers most commonly miss, claimed properly.",
    },
  ],
  consultCopy: "Not sure how much you're owed? Ask before you file.",
  faqs: [
    {
      q: "Why was 20% (or 30%) deducted from my pay?",
      a: "That's CIS. contractors deduct 20% (registered) or 30% (not registered) from your invoices. It's an advance on the tax you'd owe on that income.",
    },
    {
      q: "What expenses can I claim as a CIS subcontractor?",
      a: "Tools, safety gear, travel between sites, materials you paid for, and other legitimate work costs. Your accountant will go through it with you.",
    },
    {
      q: "How long does a CIS refund take?",
      a: "Usually 4 to 6 weeks after HMRC receive your return. We file quickly to get you the refund as soon as possible.",
    },
    {
      q: "Do I need to register for CIS myself?",
      a: "If you're a subcontractor, yes. otherwise you're on the 30% deduction rate. Your accountant will register you if you haven't already.",
    },
  ],
};

export const ltdDirectorsPage: ServicePageData = {
  slug: "ltd-company-directors",
  breadcrumb: "Ltd company directors",
  eyebrow: "Director tax",
  h1: "Your personal return, alongside your company's.",
  lede:
    "As a director, your personal Self Assessment and your company's obligations are linked. One accountant across both keeps everything consistent.",
  whoHeading: "Every angle of running your own company.",
  whoCards: [
    {
      numeral: "①",
      title: "Salary and dividends",
      body: "The most tax-efficient split between salary and dividends, worked out for you.",
    },
    {
      numeral: "②",
      title: "Directors' loans",
      body: "Loans to or from your company, reported correctly to avoid extra charges.",
    },
    {
      numeral: "③",
      title: "Benefits in kind",
      body: "Company car, health insurance, or other benefits, declared properly.",
    },
  ],
  consultCopy:
    "Want to check your salary/dividend split is still the most efficient one? Book a call.",
  faqs: [
    {
      q: "Do I still need to file a personal return if my company files its own?",
      a: "Yes. the company's Corporation Tax return is separate from your personal Self Assessment. You need both.",
    },
    {
      q: "What's the most tax-efficient way to pay myself as a director?",
      a: "Usually a small salary up to the NI threshold plus dividends, but it varies. Your accountant will run the numbers for your situation.",
    },
    {
      q: "What happens if I owe money to my own company?",
      a: "If a director's loan isn't repaid within 9 months of year end, the company faces an extra tax charge. We'll flag it before that happens.",
    },
    {
      q: "Do I need to declare dividends I haven't withdrawn yet?",
      a: "Only declared dividends need to go on your return. Undeclared amounts stay as retained profit in the company.",
    },
  ],
};

export const mtdPage: ServicePageData = {
  slug: "making-tax-digital",
  breadcrumb: "Making Tax Digital",
  eyebrow: "Making Tax Digital",
  h1: "MTD is coming. Get ahead of it now.",
  lede:
    "From April 2026, self-employed people and landlords earning over £50,000 must file quarterly digital updates instead of one annual return. We'll get you set up before it's mandatory.",
  whoHeading: "Depending on where you sit.",
  whoCards: [
    {
      numeral: "①",
      title: "Over £50,000",
      body: "Mandatory from April 2026. We'll get your digital record-keeping in place now.",
    },
    {
      numeral: "②",
      title: "£30,000 to £50,000",
      body: "Mandatory from April 2027. Plenty of time to prepare properly.",
    },
    {
      numeral: "③",
      title: "Not sure if it applies to you",
      body: "We'll check your income sources and tell you your actual start date.",
    },
  ],
  consultCopy:
    "Not sure when MTD applies to you? Ask an accountant directly.",
  faqs: [
    {
      q: "What is Making Tax Digital for Income Tax?",
      a: "A shift to quarterly digital updates to HMRC (plus a year-end return), replacing the current single annual Self Assessment for landlords and the self-employed above the income thresholds.",
    },
    {
      q: "When exactly does it become mandatory for me?",
      a: "Depends on income: April 2026 for over £50,000, April 2027 for £30,000 to £50,000, April 2028 for £20,000 to £30,000.",
    },
    {
      q: "What software do I need?",
      a: "HMRC-compatible bookkeeping software. We recommend and set up the right one for your situation as part of onboarding.",
    },
    {
      q: "Does MTD replace my Self Assessment entirely?",
      a: "The quarterly updates replace some of it. You'll still submit a year-end return that finalises the picture.",
    },
  ],
};

export const limitedCompanyPage: ServicePageData = {
  slug: "limited-company-tax-returns",
  breadcrumb: "Limited company tax returns",
  eyebrow: "Company tax returns",
  h1: "Your company's tax return, filed properly.",
  lede:
    "Corporation tax return prepared and filed by an accountant who understands your business, not a generic template.",
  whoHeading: "Fits companies of every size.",
  whoCards: [
    {
      numeral: "①",
      title: "Small limited companies",
      body: "Straightforward corporation tax returns, filed accurately and on time.",
    },
    {
      numeral: "②",
      title: "Companies with a director",
      body: "Corporation tax and director self-assessment handled together.",
    },
    {
      numeral: "③",
      title: "Growing businesses",
      body: "As your company grows, your accountant grows with it, not a new provider every year.",
    },
  ],
  consultCopy:
    "Not sure if your company structure is still the right one? Ask before your next filing.",
  faqs: [
    {
      q: "When is my corporation tax return due?",
      a: "12 months after your accounting period ends. But the tax itself is due 9 months + 1 day after year end, so filing early is safer.",
    },
    {
      q: "What can my company claim as an expense?",
      a: "Anything incurred wholly and exclusively for the business. from staff costs to rent to legitimate travel. Your accountant will review and advise.",
    },
    {
      q: "Do I need an accountant if my company is dormant?",
      a: "You still need to file a dormant company return. Cheaper than a trading return, but still required. we can handle it.",
    },
    {
      q: "What's the difference between this and my personal Self Assessment?",
      a: "The company return covers Corporation Tax on company profits. Your personal Self Assessment covers salary, dividends and other personal income. They're separate but should be handled consistently.",
    },
  ],
};

export const taxAdvicePage: ServicePageData = {
  slug: "tax-advice",
  breadcrumb: "Tax advice",
  eyebrow: "Tax advice",
  h1: "A straight answer, from a real accountant.",
  lede:
    "Got a tax question that isn't about filing? Book a 30-minute call with a qualified accountant and get a written summary afterwards, from £129.",
  whoHeading: "The kind of questions we get asked.",
  whoCards: [
    {
      numeral: "①",
      title: "Self Assessment questions",
      body: "Sole trader vs limited company, what to expense, which allowances apply.",
    },
    {
      numeral: "②",
      title: "Capital Gains questions",
      body: "What you owe, what you need to declare, and when.",
    },
    {
      numeral: "③",
      title: "Foreign income questions",
      body: "Moving abroad, moving to the UK, or earning UK income from overseas.",
    },
  ],
  consultCopy: "",
  showPricing: false,
  showConsult: false,
  howHeading: "Three steps to a real answer.",
  howSteps: [
    {
      n: 1,
      title: "Tell us your situation",
      body: "A short intake, so your accountant comes prepared and doesn't spend the call catching up.",
    },
    {
      n: 2,
      title: "Book your 30-minute call",
      body: "Choose a time that suits you, by phone or video. You'll be matched with an accountant who knows your area.",
    },
    {
      n: 3,
      title: "Get a written summary",
      body: "After the call, you receive a written summary and clear next steps, saved to your account.",
    },
  ],
  faqs: [
    {
      q: "What's the difference between tax advice and filing a return?",
      a: "Advice is a conversation to answer a question or check a plan. Filing is preparing and submitting the actual return to HMRC. You can do one, the other, or both.",
    },
    {
      q: "Can I use this more than once?",
      a: "Yes. book as many consultations as you need. Each is a separate 30-minute call.",
    },
    {
      q: "Will you contact HMRC on my behalf?",
      a: "Advice calls don't include HMRC representation, but if you'd like your accountant to become your registered agent, we can arrange that separately.",
    },
    {
      q: "Can this be combined with filing my return?",
      a: "Absolutely. Many clients start with a consultation, then continue with a filing service through the same accountant.",
    },
  ],
};

export const vatBusinessPage: ServicePageData = {
  slug: "vat-business",
  breadcrumb: "VAT & business",
  eyebrow: "VAT & business",
  h1: "VAT-registered? We handle the paperwork.",
  lede:
    "Quarterly VAT returns, registration, and scheme selection. A qualified accountant takes care of the whole VAT side of your business so you can focus on running it.",
  whoHeading: "Whichever VAT problem you're solving.",
  whoCards: [
    {
      numeral: "①",
      title: "Quarterly VAT returns",
      body: "Filed on time, every quarter, with an accountant who knows your VAT scheme.",
    },
    {
      numeral: "②",
      title: "VAT registration",
      body: "Approaching the threshold? We handle registration and scheme selection.",
    },
    {
      numeral: "③",
      title: "Flat rate vs standard",
      body: "We work out which VAT scheme actually saves your business money.",
    },
  ],
  consultCopy:
    "Not sure if you should register voluntarily, or which VAT scheme fits? Book a 1-to-1 to decide before you file.",
  faqs: [
    {
      q: "When do I have to register for VAT?",
      a: "Once your rolling 12-month turnover crosses £90,000 (2024/25). You can also register voluntarily below that, which sometimes makes sense.",
    },
    {
      q: "How often are VAT returns due?",
      a: "Usually quarterly, via the Making Tax Digital system. Your accountant handles filing and payment reminders.",
    },
    {
      q: "What's the flat rate scheme?",
      a: "A simplified VAT scheme where you pay a flat percentage of turnover instead of tracking every input and output. Suits some small businesses; not others. We'll work out which is cheaper for you.",
    },
    {
      q: "What happens if I miss a VAT deadline?",
      a: "HMRC's penalty points system kicks in after repeated defaults. Miss the threshold and you get financial penalties. We file on time to avoid all of it.",
    },
  ],
};
