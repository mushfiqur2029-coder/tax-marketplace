// Generates /terms/index.html and /privacy/index.html for the static
// marketing site by cloning the about-page shell (header + footer +
// styles.css + sterling.js) and swapping in long-form legal content.
//
// Why not hand-build each HTML: the shell has 100+ class names from
// the compiled Tailwind + specific data-* attributes for sterling.js
// (mobile menu, pricing toggle). Cloning keeps those bits in sync for
// free — a rebuild of the main scrape updates the shell, and these
// two legal pages pick up the new shell when this script re-runs.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "marketing-static-export");

const LAST_UPDATED = "13 October 2026";

async function build() {
  const template = await readFile(join(OUT, "about", "index.html"), "utf8");

  for (const page of PAGES) {
    const html = applyToTemplate(template, page);
    await mkdir(join(OUT, page.slug), { recursive: true });
    await writeFile(join(OUT, page.slug, "index.html"), html);
    console.log(`wrote ${page.slug}/index.html (${html.length} bytes)`);
  }
}

function applyToTemplate(template, page) {
  // Replace <title> + meta description.
  let html = template.replace(
    /<title>[^<]*<\/title>/,
    `<title>${page.title}</title>`,
  );
  html = html.replace(
    /<meta name="description" content="[^"]*"\/>/,
    `<meta name="description" content="${page.description}"/>`,
  );
  // Swap the entire <main>...</main> for the legal content.
  html = html.replace(/<main[^>]*>[\s\S]*?<\/main>/, mainHtml(page));
  return html;
}

function mainHtml(page) {
  return `<main class="relative flex-1"><div class="relative z-10 mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
<span class="eyebrow">${page.eyebrow}</span>
<h1 class="mt-5 text-3xl leading-tight sm:text-4xl" style="font-family:var(--font-heading)">${page.heading}</h1>
<p class="mt-3 text-sm text-slate" style="font-family:var(--font-mono)">Last updated: ${LAST_UPDATED}</p>
<div class="legal-body mt-10 space-y-6">${page.body}</div>
<div class="mt-14 border-t border-line pt-6 text-xs text-slate">
<p><strong>Not legal advice.</strong> This page is a plain-English summary of our terms. For the authoritative version, or for anything you&rsquo;re uncertain about, email <a class="underline underline-offset-4 hover:text-sky" href="mailto:info@sterlingledger.co.uk">info@sterlingledger.co.uk</a>.</p>
</div>
<div class="mt-10"><a class="text-sm font-semibold text-navy-deep underline underline-offset-4 hover:text-sky" href="/">&larr; Back to homepage</a></div>
</div></main>`;
}

const TERMS_BODY = `
<h2>1. Who we are</h2>
<p>Sterling Ledger is a UK marketplace that matches individuals and businesses with qualified, independent accountants. The accountants prepare and file your tax returns; we provide the platform, the matching, the client experience, and payment handling. We are not a firm of accountants ourselves and do not provide tax advice directly.</p>

<h2>2. The service</h2>
<p>You pick a service tier at a flat fee, sign an engagement letter with an assigned accountant, pay via Stripe, upload your documents, and your accountant prepares and files your return. For bespoke engagements (large companies, VAT over &pound;200k turnover) we scope the work on a call before quoting.</p>
<p>Every accountant on the platform is independently verified as a member of ACCA, CIMA, CTA, or an equivalent UK professional body before being approved to take cases.</p>

<h2>3. Your account</h2>
<p>You must be at least 18 and provide accurate information when registering. Keep your login credentials secret &mdash; you are responsible for everything done through your account. Notify us at the email below if you suspect unauthorised access.</p>

<h2>4. Pricing and payment</h2>
<p>Each service tier has a flat fee listed on this site. Add-ons and urgent-filing uplifts are shown before you commit. Prices may change but any change does not apply to a case you have already signed the engagement letter for &mdash; your signed quote is binding.</p>
<p>Payment is taken at checkout via Stripe. For two-stage engagements (bespoke), a deposit is taken on signing and the balance on approval of the prepared work.</p>

<h2>5. Refunds</h2>
<p>If we have not yet started work on your case, you can request a full refund by emailing us within 14 days of payment. Once your assigned accountant has begun preparing the return, refunds are at our discretion depending on how much work has been done.</p>
<p>Your statutory right to a refund under the Consumer Rights Act 2015 is unaffected.</p>

<h2>6. Accuracy guarantee</h2>
<p>If a mistake on our side (your accountant&rsquo;s or ours) causes you to incur an HMRC penalty, we cover the penalty amount. This does not cover penalties caused by incomplete, incorrect, or late information you provided, or by HMRC decisions outside our control.</p>

<h2>7. Your obligations</h2>
<p>You agree to provide accurate information, upload complete documents, respond to your accountant&rsquo;s messages in reasonable time, and review and approve your return before it is filed. We cannot file a return on your behalf without your explicit approval through the platform.</p>

<h2>8. The accountants</h2>
<p>Although Sterling Ledger vets and approves every accountant on the platform, the professional relationship for your return is between you and the individual accountant assigned to your case, documented in the engagement letter you sign at the start. Sterling Ledger is not your accountant.</p>

<h2>9. Our liability</h2>
<p>To the fullest extent permitted by law, our liability for any claim arising out of your use of the platform is limited to the fee you paid for the service that gave rise to the claim. Nothing in these terms limits our liability for death, personal injury caused by our negligence, or fraud.</p>

<h2>10. Suspension and termination</h2>
<p>We may suspend or close an account for breach of these terms, for suspected fraud, or where we are legally required to. You can close your account at any time; emailing us from the registered address is enough.</p>

<h2>11. Changes to these terms</h2>
<p>We may update these terms as the service evolves. The current version is always at this URL and the &ldquo;last updated&rdquo; date reflects the most recent change. Material changes will be notified by email where we can reach you.</p>

<h2>12. Law and jurisdiction</h2>
<p>These terms are governed by the laws of England and Wales. The courts of England and Wales have exclusive jurisdiction over any dispute.</p>

<h2>13. Contact</h2>
<p>Questions about these terms: <a class="underline underline-offset-4 hover:text-sky" href="mailto:info@sterlingledger.co.uk">info@sterlingledger.co.uk</a>.</p>
`;

const PRIVACY_BODY = `
<h2>1. Who we are</h2>
<p>Sterling Ledger (&ldquo;we&rdquo;, &ldquo;us&rdquo;) operates this website and the marketplace at <a class="underline underline-offset-4 hover:text-sky" href="https://apisterlingledger.co.uk/">apisterlingledger.co.uk</a>. We are the data controller for the personal data you give us. You can contact us at <a class="underline underline-offset-4 hover:text-sky" href="mailto:info@sterlingledger.co.uk">info@sterlingledger.co.uk</a>.</p>

<h2>2. What data we collect</h2>
<p><strong>Account data</strong> &mdash; name, email, phone, postal address, password (stored hashed by our auth provider), profile picture.</p>
<p><strong>Case data</strong> &mdash; the information you fill in to prepare your return: income, expenses, employer, bank interest, property details, company numbers, documents you upload (payslips, invoices, bank statements, HMRC letters, previous returns, etc.). For limited company clients, this includes your Companies House number and the Companies House authentication code (encrypted at rest).</p>
<p><strong>Payment data</strong> &mdash; handled by Stripe. We never see your full card details. We retain Stripe charge IDs, amounts, invoice numbers, and payment status.</p>
<p><strong>Communications</strong> &mdash; messages between you and your accountant through the platform, support messages, and attachments.</p>
<p><strong>Technical data</strong> &mdash; IP address, device + browser info, pages visited, timestamps. Standard for every website.</p>

<h2>3. Why we collect it</h2>
<p>We process your data to deliver the service you&rsquo;re paying us for: match you with an accountant, let you upload documents, let your accountant prepare and file your return, charge you, and send you receipts + reminders. The lawful basis for this is <strong>contract</strong> &mdash; we need the data to perform the service.</p>
<p>Where we send you occasional service emails (e.g. an incident on the platform, policy changes), the lawful basis is <strong>legitimate interest</strong>. We don&rsquo;t do marketing emails without your opt-in.</p>

<h2>4. Who we share it with</h2>
<p><strong>Your assigned accountant</strong> &mdash; sees everything on your case. Changes if we reassign the case; the previous accountant loses visibility.</p>
<p><strong>Stripe</strong> &mdash; payment processing. See <a class="underline underline-offset-4 hover:text-sky" href="https://stripe.com/gb/privacy" target="_blank" rel="noopener">Stripe&rsquo;s privacy notice</a>.</p>
<p><strong>Supabase</strong> &mdash; hosts our database and file storage. See <a class="underline underline-offset-4 hover:text-sky" href="https://supabase.com/privacy" target="_blank" rel="noopener">Supabase&rsquo;s privacy notice</a>.</p>
<p><strong>Vercel</strong> &mdash; hosts the application. See <a class="underline underline-offset-4 hover:text-sky" href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener">Vercel&rsquo;s privacy notice</a>.</p>
<p><strong>HMRC and Companies House</strong> &mdash; where submitting your return or company accounts, your data is sent to these authorities as required.</p>
<p>We do not sell your data to anyone, ever.</p>

<h2>5. International transfers</h2>
<p>Stripe, Supabase, and Vercel all involve data stored in or routed through servers outside the UK (primarily in the US and EU). These transfers are protected by standard contractual clauses (SCCs) as required by UK GDPR.</p>

<h2>6. How long we keep it</h2>
<p>We retain your data for as long as you have an account with us, and for a reasonable period after you close it, so we can meet legal, accounting, and tax recordkeeping obligations. In practice this is <strong>6 years</strong> after the last activity, which matches the retention period HMRC expects for tax records.</p>
<p>Payment records are retained for the period our payment processor and tax law require.</p>

<h2>7. Your rights</h2>
<p>Under UK GDPR you have the right to:</p>
<ul class="list-disc space-y-1 pl-6">
<li>access the personal data we hold about you</li>
<li>correct inaccurate data</li>
<li>ask us to delete your data (where we don&rsquo;t have a legal obligation to keep it)</li>
<li>object to processing or ask us to restrict it</li>
<li>receive your data in a portable format</li>
<li>withdraw consent at any time, where consent is the lawful basis</li>
</ul>
<p>Email us at <a class="underline underline-offset-4 hover:text-sky" href="mailto:info@sterlingledger.co.uk">info@sterlingledger.co.uk</a> to exercise any of these. We respond within one calendar month.</p>

<h2>8. Complaints</h2>
<p>If you think we&rsquo;ve mishandled your data, you can complain to the UK Information Commissioner&rsquo;s Office: <a class="underline underline-offset-4 hover:text-sky" href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noopener">ico.org.uk</a>. We&rsquo;d rather hear from you first so we can fix it.</p>

<h2>9. Cookies</h2>
<p>The marketing site uses a single functional cookie set by our hosting provider for basic performance tracking. The application sets authentication cookies when you&rsquo;re signed in &mdash; these are strictly necessary to keep you logged in. We don&rsquo;t use advertising or cross-site tracking cookies.</p>

<h2>10. Children</h2>
<p>The service is not for anyone under 18. Don&rsquo;t register if you&rsquo;re younger than that.</p>

<h2>11. Changes</h2>
<p>We update this policy when the service changes materially. The current version is always at this URL. Material changes are emailed to active users.</p>
`;

const CONTACT_BODY = `
<p class="text-base text-slate" style="margin-top:1.25rem">Send us the question in your own words, pick a time to talk if you want to, and we&rsquo;ll take it from there.</p>

<ol data-step-indicator class="step-indicator mt-10">
  <li class="step-indicator-item" data-step-marker="1"><span class="step-indicator-dot">1</span><span class="step-indicator-label">Your details</span></li>
  <li class="step-indicator-item" data-step-marker="2"><span class="step-indicator-dot">2</span><span class="step-indicator-label">Pick a time</span></li>
  <li class="step-indicator-item" data-step-marker="3"><span class="step-indicator-dot">3</span><span class="step-indicator-label">All set</span></li>
</ol>

<div data-contact-flow>

  <section data-step="1" class="contact-step">
    <form data-contact-form class="space-y-5" novalidate>
      <div class="contact-grid">
        <label class="contact-field">
          <span class="contact-label">Name</span>
          <input type="text" name="name" autocomplete="name" required class="contact-input"/>
        </label>
        <label class="contact-field">
          <span class="contact-label">Phone <span class="contact-label-aux">optional</span></span>
          <input type="tel" name="phone" autocomplete="tel" class="contact-input"/>
        </label>
      </div>
      <label class="contact-field">
        <span class="contact-label">Email</span>
        <input type="email" name="email" autocomplete="email" required class="contact-input"/>
      </label>
      <label class="contact-field">
        <span class="contact-label">Message</span>
        <textarea name="message" rows="5" required class="contact-input contact-textarea" placeholder="A sentence or two is enough. Your accountant will come prepared."></textarea>
      </label>
      <div class="flex flex-wrap items-center gap-3 pt-1">
        <button type="submit" class="btn-sl btn-sl-primary">Continue</button>
        <span class="text-xs text-slate">Or email <a class="underline underline-offset-4 hover:text-sky" href="mailto:info@sterlingledger.co.uk">info@sterlingledger.co.uk</a>.</span>
      </div>
      <p data-contact-status class="contact-status" hidden></p>
    </form>
  </section>

  <section data-step="2" class="contact-step" hidden>
    <div class="step-head">
      <h2>Pick a 30-minute slot</h2>
      <p>Pick any time that works for you. Your accountant will join by phone or video.</p>
    </div>
    <div class="contact-booking">
      <iframe src="https://calendar.app.google/XrzpFp1NbH4QjdLF6" title="Pick a consultation slot" loading="lazy"></iframe>
    </div>
    <div class="step-actions">
      <button type="button" data-step-done="2" class="btn-sl btn-sl-primary">I&rsquo;ve booked my time</button>
      <button type="button" data-step-skip="2" class="btn-sl btn-sl-ghost">Skip this for now</button>
    </div>
    <p class="step-fallback">Calendar not loading in the frame? <a href="https://calendar.app.google/XrzpFp1NbH4QjdLF6" target="_blank" rel="noopener">Open it in a new tab</a>.</p>
  </section>

  <section data-step="3" class="contact-step" hidden>
    <div class="step-done-card">
      <div class="step-done-check" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12 10 18 20 6"></polyline></svg>
      </div>
      <h2>You&rsquo;re all set.</h2>
      <p class="step-done-body">We&rsquo;ve got your message. If you booked a call you&rsquo;ll get a Google Calendar invite with the meeting link. We reply to messages inside one working day.</p>
      <div class="step-done-actions">
        <a href="/" class="btn-sl btn-sl-primary">Back to homepage</a>
        <a href="/guides" class="btn-sl btn-sl-ghost">Read the guides</a>
      </div>
    </div>
  </section>

</div>

<div class="mt-16 border-t border-line pt-6 text-xs text-slate">
<p>We only use what you send us to answer your question. Nothing is shared with third parties. See the <a class="underline underline-offset-4 hover:text-sky" href="/privacy">privacy policy</a> for details.</p>
</div>
`;

const PAGES = [
  {
    slug: "contact",
    title: "Contact Sterling Ledger. Get in touch with a real accountant.",
    description:
      "Send Sterling Ledger a question or book a consultation call. UK-qualified accountants, replies within one working day.",
    eyebrow: "Contact",
    heading: "Get in touch",
    body: CONTACT_BODY,
  },
  {
    slug: "terms",
    title: "Terms of Service. Sterling Ledger.",
    description:
      "The terms of using Sterling Ledger — service description, pricing, payment, refunds, liability, and your rights.",
    eyebrow: "Legal",
    heading: "Terms of Service",
    body: TERMS_BODY,
  },
  {
    slug: "privacy",
    title: "Privacy Policy. Sterling Ledger.",
    description:
      "How Sterling Ledger collects, uses, and protects your personal data under UK GDPR. Your rights, our contacts.",
    eyebrow: "Legal",
    heading: "Privacy Policy",
    body: PRIVACY_BODY,
  },
];

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
