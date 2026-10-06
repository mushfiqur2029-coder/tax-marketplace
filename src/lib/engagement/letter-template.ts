import "server-only";
import fs from "node:fs";
import path from "node:path";

export type EngagementLetterVariant = "limited_company" | "personal";

export type EngagementLetterFields = {
  effectiveDate: string;      // e.g. "1 October 2026"
  // Which engagement shape to render. Limited Company shows the full
  // Parties block (company name + number + director labels). Personal
  // shows a client-only Parties block and skips the company rows.
  // Defaults to limited_company for backward compat with existing
  // callers.
  variant?: EngagementLetterVariant;
  // Captured on the engagement page before signing. Empty string for
  // legacy cases that signed before the Companies House lookup landed —
  // rendered as "—" rather than skipping the row, so the PDF layout
  // stays stable across versions. Ignored when variant is "personal".
  companyName: string;
  companyNumber: string;      // 8 chars, Companies House format
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  serviceName: string;        // e.g. "VAT-registered company"
  totalFee: string;           // e.g. "£400"
  // Signature embedded in the PDF. Null for the pre-sign in-browser
  // preview, present after the client signs for the stored PDF.
  signatureDataUrl: string | null;
  signDate: string | null;    // e.g. "1 October 2026"
};

// Cached logo. Read once per process, embedded as a data URL so the final
// HTML is fully self-contained (Puppeteer prints without any network
// fetches, which also means a tightened Content-Security-Policy would
// not fire).
let logoDataUrlCache: string | null = null;
function logoDataUrl(): string {
  if (logoDataUrlCache !== null) return logoDataUrlCache;
  try {
    const p = path.resolve(process.cwd(), "design-reference/Logo3s.png");
    const bytes = fs.readFileSync(p);
    logoDataUrlCache = `data:image/png;base64,${bytes.toString("base64")}`;
  } catch (err) {
    // Keep an empty string so the template can render a text wordmark
    // fallback instead of a broken image. Log so prod misconfigurations
    // show up in logs rather than silently in the PDF.
    console.error(
      `[engagement-letter] logo load failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    logoDataUrlCache = "";
  }
  return logoDataUrlCache;
}

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Full HTML document for the engagement letter. Suitable for:
//   • iframe srcDoc on the client sign page (preview before signing)
//   • Puppeteer page.setContent() → page.pdf() to produce the stored PDF
// Same source so what the client reads on screen is what's in the signed
// PDF. All content below is transcribed from
// design-reference/engagement-letter-template.md with the user's PROPOSED
// edits applied inline (clauses 5, 12, 13, 15, 15.1, 16, 22). The source
// of truth stays the markdown file; this template mirrors it.
export function renderEngagementLetterHtml(
  f: EngagementLetterFields,
): string {
  const logo = logoDataUrl();
  const logoBlock = logo
    ? `<img class="logo" alt="Sterling Ledger" src="${logo}" />`
    : `<div class="logo-fallback">STERLING LEDGER</div>`;

  const signatureBlock = f.signatureDataUrl
    ? `<img class="signature" alt="Client signature" src="${esc(f.signatureDataUrl)}" />`
    : `<div class="signature-placeholder">Awaiting signature</div>`;

  const signDateBlock = f.signDate ? esc(f.signDate) : "—";

  const variant: EngagementLetterVariant = f.variant ?? "limited_company";
  // Parties block differs by variant. Personal has no company name /
  // number and uses Client Name/Email/Phone instead of Director. LC
  // keeps the full director labels under a Company Name + Number
  // header.
  const partiesRows =
    variant === "personal"
      ? `
    <dt>Client Name</dt><dd>${esc(f.clientName)}</dd>
    <dt>Client Email</dt><dd>${esc(f.clientEmail)}</dd>
    <dt>Client Phone</dt><dd>${esc(f.clientPhone)}</dd>
    <dt>Accountants</dt><dd>NAFH ACCOUNTANTS LTD</dd>
    <dt>Platform</dt><dd>STERLING LEDGER ADVISORY LTD</dd>
    <dt>Trading Name</dt><dd>Sterling Ledger</dd>`
      : `
    <dt>Company Name</dt><dd>${esc(f.companyName) || "—"}</dd>
    <dt>Company Number</dt><dd>${esc(f.companyNumber) || "—"}</dd>
    <dt>Director Name</dt><dd>${esc(f.clientName)}</dd>
    <dt>Director Email</dt><dd>${esc(f.clientEmail)}</dd>
    <dt>Director Number</dt><dd>${esc(f.clientPhone)}</dd>
    <dt>Accountants</dt><dd>NAFH ACCOUNTANTS LTD</dd>
    <dt>Platform</dt><dd>STERLING LEDGER ADVISORY LTD</dd>
    <dt>Trading Name</dt><dd>Sterling Ledger</dd>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Engagement Letter · Sterling Ledger</title>
<style>
  @page { size: A4 portrait; margin: 20mm; }
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #0f1e4d;
    font-family: "Georgia", "Times New Roman", "Times", serif;
    font-size: 11pt;
    line-height: 1.55;
  }
  .page {
    padding: 20mm;
    max-width: 170mm;
    margin: 0 auto;
  }
  .masthead {
    display: flex;
    align-items: center;
    gap: 16px;
    border-bottom: 1px solid #e2e5ee;
    padding-bottom: 14px;
    margin-bottom: 24px;
  }
  .logo { height: 46px; width: auto; }
  .logo-fallback {
    font-family: "Helvetica Neue", "Arial", sans-serif;
    font-weight: 700;
    font-size: 20pt;
    letter-spacing: 0.03em;
    color: #0f1e4d;
  }
  .masthead .brand {
    font-family: "Helvetica Neue", "Arial", sans-serif;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-size: 10pt;
    color: #4b5c89;
  }
  h1 {
    font-family: "Helvetica Neue", "Arial", sans-serif;
    font-size: 22pt;
    letter-spacing: 0.01em;
    margin: 0 0 4px 0;
  }
  h2 {
    font-family: "Helvetica Neue", "Arial", sans-serif;
    font-size: 14pt;
    margin: 24px 0 8px 0;
  }
  h3 {
    font-family: "Helvetica Neue", "Arial", sans-serif;
    font-size: 11pt;
    margin: 18px 0 6px 0;
  }
  p { margin: 8px 0; }
  ul { margin: 6px 0 10px 20px; padding: 0; }
  li { margin: 3px 0; }
  .meta {
    display: grid;
    grid-template-columns: 160px 1fr;
    row-gap: 4px;
    column-gap: 12px;
    margin: 10px 0 18px 0;
    font-size: 10.5pt;
  }
  .meta dt {
    color: #4b5c89;
    font-weight: 600;
  }
  .fee-panel {
    border: 1px solid #e2e5ee;
    background: #f6f8fc;
    border-radius: 8px;
    padding: 12px 14px;
    margin: 10px 0;
  }
  .fee-panel .row {
    display: flex;
    justify-content: space-between;
    padding: 4px 0;
  }
  .fee-panel .row.total {
    border-top: 1px solid #e2e5ee;
    margin-top: 6px;
    padding-top: 10px;
    font-weight: 700;
  }
  .proposed-note {
    display: none;
  }
  .accept {
    margin-top: 30px;
    border-top: 1px solid #e2e5ee;
    padding-top: 18px;
  }
  .accept .label {
    font-size: 10pt;
    color: #4b5c89;
    margin-bottom: 6px;
  }
  .signature {
    display: block;
    max-width: 220px;
    max-height: 80px;
    border-bottom: 1px solid #0f1e4d;
    padding-bottom: 2px;
  }
  .signature-placeholder {
    border-bottom: 1px solid #0f1e4d;
    width: 220px;
    height: 60px;
    display: flex;
    align-items: flex-end;
    padding-bottom: 2px;
    font-style: italic;
    color: #9aa3bb;
    font-size: 10pt;
  }
  .footer {
    margin-top: 30px;
    padding-top: 10px;
    border-top: 1px solid #e2e5ee;
    font-size: 9pt;
    color: #4b5c89;
  }
</style>
</head>
<body>
<div class="page">

  <header class="masthead">
    ${logoBlock}
    <div>
      <div class="brand">Sterling Ledger</div>
    </div>
  </header>

  <h1>Engagement Letter</h1>
  <p>Effective Date: <strong>${esc(f.effectiveDate)}</strong></p>

  <h3>Parties involved with this engagement</h3>
  <dl class="meta">${partiesRows}
  </dl>

  <p>Thank you for choosing the Platform and engaging the accountants. This
  Engagement Letter, together with our Terms and Conditions, Refund Policy,
  and Privacy Policy, forms a legally binding agreement between you and
  the accountant.</p>

  <h2>1. Role of the Platform</h2>
  <p>The services are introduced and administratively facilitated via the
  Platform, which operates solely as a service platform and intermediary.
  The Platform does not provide regulated accounting or tax advice. All
  professional services, compliance work, and advisory responsibilities
  are carried out exclusively by the accountant.</p>

  <h2>2. Scope of Services</h2>
  <p>The accountant agrees to provide services as selected through the
  Platform, which may include: VAT registration, VAT return filing
  (including Flat Rate Scheme advisory where applicable), Self-Assessment
  filing, preparation of statutory accounts, corporation tax returns,
  payroll services, management accounting, or business advisory support
  covered by the practice license. Any additional services outside the
  agreed scope will require written confirmation and may incur additional
  fees.</p>

  <h2>3. Responsibilities of the Accountant</h2>
  <p>The accountant will perform services with reasonable skill, care, and
  diligence in accordance with UK law, HMRC regulations, and the Practice
  Licence provider&rsquo;s Code of Ethics. Confidentiality, objectivity,
  and professional integrity will be maintained at all times.</p>

  <h2>4. Responsibilities of the Client</h2>
  <p>The Client is responsible for maintaining accurate accounting records
  and providing complete and timely information. The Client remains legally
  responsible for all statutory filings, registrations, and tax
  submissions, including those prepared or submitted on their behalf. The
  Client is responsible for safeguarding assets, preventing fraud, and
  ensuring compliance with applicable legislation.</p>

  <h2>5. Fees and Payment Terms</h2>
  <p>Fees will be agreed through the Platform based on the selected
  service. This is a one-time, fixed fee, payable in full before work
  begins. Once paid, the fee is not billed again for this engagement.</p>
  <div class="fee-panel">
    <div class="row">
      <span>Service</span>
      <span><strong>${esc(f.serviceName)}</strong></span>
    </div>
    <div class="row total">
      <span>Total fee</span>
      <span>${esc(f.totalFee)}</span>
    </div>
  </div>

  <h2>6. Confidentiality and Data Protection</h2>
  <p>All information obtained during this engagement will be treated as
  confidential, except where disclosure is required by law or professional
  obligation. Personal data will be processed in accordance with UK GDPR
  and Data Protection legislation.</p>

  <h2>7. Anti-Money Laundering</h2>
  <p>In compliance with UK Anti-Money Laundering Regulations, identity
  verification may be required. The accountant may be legally obliged to
  report suspicious activities to the relevant authorities without prior
  notice to the Client.</p>

  <h2>8. Limitation of Liability</h2>
  <p>The accountant&rsquo;s liability shall be limited to the maximum
  extent permitted by law. No liability shall arise from inaccurate,
  incomplete, or misleading information provided by the Client or third
  parties.</p>

  <h2>9. Termination</h2>
  <p>Either party may terminate this engagement in writing with reasonable
  notice. Fees for work completed up to the date of termination remain
  payable.</p>

  <h2>10. Governing Law</h2>
  <p>This agreement shall be governed by and construed in accordance with
  the laws of England and Wales.</p>

  <h2>11. Authority to Act</h2>
  <p>You authorise the Accounting Firms to act on your behalf where
  reasonably necessary to deliver the agreed services, including
  communication with HMRC where appropriate.</p>

  <h2>Terms and Conditions</h2>

  <h2>12. Cooling Off and Work Commencing</h2>
  <p>Your statutory 14-day cooling off period applies from the date of
  this agreement. If you ask us to begin work before that period ends,
  you acknowledge work may start immediately, and a reasonable charge may
  apply for work already completed if you cancel, as set out in clause
  14.</p>

  <h2>13. Engagement Term</h2>
  <p>This engagement covers the single service selected and paid for
  above. There is no minimum term or recurring commitment beyond this
  engagement. Nothing in this clause removes your statutory consumer
  rights.</p>

  <h2>14. Your Consumer Cancellation Rights</h2>
  <p>If you are a consumer, you have the right to cancel this agreement
  within 14 days of entering into it under the Consumer Contracts
  (Information, Cancellation and Additional Charges) Regulations 2013.
  Where you expressly request us to begin work during the cooling off
  period, you acknowledge and agree that:</p>
  <ul>
    <li>Work will begin immediately</li>
    <li>A reasonable and proportionate charge may apply if you cancel
    after work has started, of £100.00</li>
    <li>Where statutory submissions have been made, refunds may not be
    available</li>
  </ul>
  <p>STERLING LEDGER ADVISORY LTD will always act fairly and in
  accordance with UK consumer protection law.</p>

  <h2>15. Payment Terms</h2>
  <ul>
    <li>The fee is collected in full via the Platform before work begins</li>
    <li>Payments are collected using your chosen payment method at
    checkout</li>
    <li>This is a one-time charge, there is no recurring billing for this
    engagement</li>
  </ul>

  <h3>15.1. Debt Recovery and Collection</h3>
  <p>Since the fee is collected in full before work begins, this clause
  does not apply to this engagement.</p>

  <h2>16. Early Termination</h2>
  <p>After expiry of the cooling off period, this engagement may be
  terminated by either party under clause 9. As this is a one-time fixed
  fee, no ongoing fees apply after termination. Nothing in this clause
  overrides your statutory rights.</p>

  <h2>17. Our Right to Suspend or Terminate</h2>
  <p>We may suspend or terminate services where reasonably necessary,
  including where:</p>
  <ul>
    <li>Information provided is false, misleading or incomplete</li>
    <li>Payment fails or is reversed</li>
    <li>Regulatory or legal obligations require action</li>
    <li>There is abusive, threatening or unlawful conduct</li>
    <li>Anti money laundering concerns arise</li>
  </ul>
  <p>Where reasonably possible, we will provide prior notice.</p>

  <h2>18. Limitation of Liability</h2>
  <p>To the fullest extent permitted by law:</p>
  <ul>
    <li>Accountants are not responsible for HMRC processing times or
    decisions</li>
    <li>Accountants are not responsible for penalties arising from
    inaccurate client information</li>
    <li>Accountants are not responsible for matters outside the agreed
    scope of services</li>
    <li>Accountants&rsquo; liability is limited to the fee paid by you
    for this engagement</li>
  </ul>
  <p>Nothing in these terms excludes or limits liability for death or
  personal injury caused by negligence, fraud, or any liability which
  cannot legally be limited.</p>

  <h2>19. Client Indemnity</h2>
  <p>You agree to reimburse reasonable losses, costs or legal expenses
  that arise directly from:</p>
  <ul>
    <li>Your breach of this agreement</li>
    <li>False, misleading or incomplete information supplied by you</li>
    <li>Your failure to comply with HMRC or statutory obligations</li>
    <li>Claims arising from your business activities</li>
  </ul>
  <p>This indemnity applies only where such costs are reasonably incurred
  and recoverable under applicable UK law.</p>

  <h2>20. Complaints Procedure</h2>
  <p>If you are dissatisfied with our service, you should contact our
  support team in the first instance so that we can investigate and
  attempt to resolve the matter promptly and fairly. Nothing in this
  clause restricts your statutory rights.</p>

  <h2>21. Refund Policy</h2>
  <h3>Platform&rsquo;s Refund Policy</h3>
  <h3>Cooling Off Period</h3>
  <p>You may cancel within 14 days of entering into the agreement in line
  with UK consumer regulations. Where you have requested immediate
  commencement of services, a reasonable charge may apply for work
  already performed.</p>
  <h3>After Work Has Started</h3>
  <p>Refunds are generally not available where:</p>
  <ul>
    <li>VAT registration has been submitted</li>
    <li>Self-Assessment preparation has commenced</li>
    <li>HMRC submissions have been prepared or filed</li>
    <li>Identity verification and onboarding work has been materially
    completed</li>
    <li>Services have otherwise been materially delivered</li>
  </ul>
  <p>Each case will be assessed fairly.</p>
  <h3>Fair Treatment Commitment</h3>
  <p>STERLING LEDGER ADVISORY LTD considers all refund requests fairly,
  reasonably and in line with UK consumer protection law and good
  industry practice.</p>

  <h2>22. Payment Authorisation</h2>
  <p>I confirm that I request the platform to begin work with the
  accountant and I authorise the one-time payment for my selected
  service. I understand my statutory cancellation rights and confirm I
  have read and agree to the Engagement Letter, Terms and Conditions,
  Refund Policy and Privacy Policy.</p>

  <h2>23. Privacy and Data Sharing</h2>
  <p>Platform and Accountant process personal data in accordance with UK
  GDPR and the Data Protection Act 2018.</p>
  <h3>How We Use Your Data</h3>
  <p>By proceeding, you expressly consent to the accountant and platform,
  limited to scope by engagement and law:</p>
  <ul>
    <li>Processing of your personal, financial and tax information</li>
    <li>Identity verification checks where required</li>
    <li>Secure sharing with our approved partner accounting firms where
    necessary</li>
    <li>Submission of information to HMRC where required</li>
    <li>Secure electronic storage and processing of your records</li>
  </ul>
  <h3>Legal Basis</h3>
  <p>Processing is carried out under one or more of the following lawful
  bases:</p>
  <ul>
    <li>Performance of a contract</li>
    <li>Compliance with legal obligations</li>
    <li>Legitimate business interests</li>
    <li>Your consent where required</li>
  </ul>
  <h3>Your Rights</h3>
  <p>You have the right to:</p>
  <ul>
    <li>Access your data</li>
    <li>Request correction</li>
    <li>Request erasure where applicable</li>
    <li>Restrict processing in certain circumstances</li>
    <li>Lodge a complaint with the Information Commissioner&rsquo;s
    Office</li>
  </ul>
  <p>We implement appropriate technical and organisational measures to
  protect your data.</p>

  <h2>24. Acceptance</h2>
  <p>By ticking the agreement box and proceeding, you confirm that you
  have read, understood, and accepted:</p>
  <ul>
    <li>This Engagement Letter</li>
    <li>Terms and Conditions</li>
    <li>Refund Policy</li>
    <li>Privacy Policy</li>
  </ul>

  <div class="accept">
    <div class="label">Accepted by</div>
    ${signatureBlock}
    <div class="label" style="margin-top:12px;">
      Date: <strong>${signDateBlock}</strong>
    </div>
  </div>

  <div class="footer">
    Sterling Ledger Advisory Ltd &middot; NAFH Accountants Ltd &middot;
    England &amp; Wales
  </div>

</div>
</body>
</html>`;
}
