import "server-only";

// SA Tax Return forwarding letter PDF generator for the Phase I
// "Generate documents" button on the accountant workspace.
//
// Mail-merged from pch_cases + the latest engine snapshot:
//   {TaxPayerName}        -> cl_name
//   {Address line(s)}     -> cl_address (+ cl_postcode)
//   {UTR}                 -> cl_utr
//   {TaxYearLabel}        -> head.tax_year (e.g. "2024/25")
//   {TaxYearEnd}          -> 5 April <endYear>
//   {Year+1}              -> endYear + 1 (deadline year)
//   {TaxLiability}        -> snapshot.tax.totalTaxAndNic
//   {DueBy31Jan}          -> snapshot.tax.dueBy31Jan
//                           (balancingPayment + poaForNextYear)
//   {DueBy31Jul}          -> snapshot.tax.dueBy31Jul (= poaForNextYear)
//   {PaymentRef}          -> plain UTR digits (no K suffix). This
//                           reverses the Phase I.2 "K-suffix confirmed"
//                           decision after the user attached a sample
//                           showing a plain-UTR reference.
//
// Letterhead: Sterling Ledger logo on the left, generated date on the
// right, same horizontal band. Firm block (name + legal + address)
// stacked under the logo on the left.
//
// Letter body copy is a verbatim transcription of the sample the user
// attached. Only {TaxpayerName}, {UTR}, {TaxYear}, {EndYear}, {YearPlus1}
// and the three money amounts are mail-merged; every other sentence is
// identical across cases.

import { renderPdfFromHtml } from "@/lib/engagement/pdf";
import { logoDataUrl } from "@/lib/branding/logo";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { TaxEngineOutput } from "@/lib/tax-engine";

export const FIRM_TRADING_NAME = "NAFH ACCOUNTANTS";
export const FIRM_LEGAL_NAME = "SHANN ACCOUNTANCY AND FINANCIAL SERVICES LTD";
export const FIRM_ADDRESS = "6 Havering Gardens, Romford, England, RM6 5AA";

type HeadRow = {
  cl_name: string | null;
  cl_address: string | null;
  cl_postcode: string | null;
  cl_utr: string | null;
  tax_year: string | null;
  engine_snapshot: unknown;
};

export async function generateSaForwardingLetterPdf(
  caseId: string,
  admin: ReturnType<typeof createAdminClient>,
): Promise<Uint8Array> {
  const { data: head, error } = await admin
    .from("pch_cases")
    .select("cl_name, cl_address, cl_postcode, cl_utr, tax_year, engine_snapshot")
    .eq("case_id", caseId)
    .single();
  if (error || !head) {
    throw new Error("Could not load pch_cases head for forwarding letter.");
  }
  const row = head as HeadRow;
  const snapshot = (row.engine_snapshot ?? null) as TaxEngineOutput | null;
  if (!snapshot) {
    throw new Error("Engine snapshot missing. Confirm the P&L before generating documents.");
  }
  const html = renderSaForwardingLetterHtml({
    taxpayerName: row.cl_name ?? "",
    address: row.cl_address ?? "",
    postcode: row.cl_postcode ?? "",
    utr: row.cl_utr ?? "",
    taxYear: row.tax_year ?? "",
    snapshot,
  });
  return renderPdfFromHtml(html);
}

// Pure HTML renderer, exported for the preview script so wording can
// be sanity-checked without round-tripping through puppeteer. All
// merge values pass through esc() so a client name or address with
// "<", ">", "&", "'" or '"' can't break the template.
export function renderSaForwardingLetterHtml(fields: {
  taxpayerName: string;
  address: string;
  postcode: string;
  utr: string;
  taxYear: string;
  snapshot: TaxEngineOutput;
}): string {
  const { endYear } = parseTaxYear(fields.taxYear);
  const yearPlus1 = endYear + 1;
  const paymentRef = buildPaymentRef(fields.utr);
  const taxLiability = fmtMoney(fields.snapshot.tax.totalTaxAndNic);
  const dueBy31Jan = fmtMoney(fields.snapshot.tax.dueBy31Jan);
  const dueBy31Jul = fmtMoney(fields.snapshot.tax.dueBy31Jul);
  const todayFmt = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const logo = logoDataUrl();
  const logoBlock = logo
    ? `<img class="logo" alt="Sterling Ledger" src="${logo}" />`
    : `<div class="logo-fallback">STERLING LEDGER</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>SA Tax Return forwarding letter</title>
<style>
  @page { size: A4; margin: 20mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 11pt;
    color: #111;
    line-height: 1.5;
    margin: 0;
  }
  .letterhead {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10mm;
    margin-bottom: 10mm;
  }
  .letterhead-left { text-align: left; }
  .letterhead-right { text-align: right; font-size: 10.5pt; color: #333; padding-top: 2mm; }
  .logo { height: 16mm; width: auto; margin-bottom: 3mm; display: block; }
  .logo-fallback {
    font-weight: 700;
    font-size: 14pt;
    letter-spacing: 0.03em;
    color: #0f1e4d;
    margin-bottom: 3mm;
  }
  .firm-trading { font-weight: 700; letter-spacing: 0.02em; font-size: 10.5pt; }
  .firm-legal { color: #333; font-size: 9.5pt; }
  .firm-address { color: #555; font-size: 9.5pt; }
  .recipient { margin-bottom: 8mm; }
  .recipient-line { display: block; }
  .pay-details {
    margin: 6mm 0;
    padding: 3mm 4mm;
    border-left: 3px solid #333;
    background: #f5f5f5;
    font-size: 10.5pt;
  }
  .pay-details .line { margin: 0.6mm 0; }
  .pay-ref-code { font-family: "Courier New", monospace; font-weight: 700; }
  p { margin: 3mm 0; }
  .signoff { margin-top: 10mm; }
  .signoff-firm { font-weight: 700; margin-top: 6mm; }
</style>
</head>
<body>
  <div class="letterhead">
    <div class="letterhead-left">
      ${logoBlock}
      <div class="firm-trading">${esc(FIRM_TRADING_NAME)}</div>
      <div class="firm-legal">trading name of ${esc(FIRM_LEGAL_NAME)}</div>
      <div class="firm-address">${esc(FIRM_ADDRESS)}</div>
    </div>
    <div class="letterhead-right">${esc(todayFmt)}</div>
  </div>

  <div class="recipient">
    <span class="recipient-line">${esc(fields.taxpayerName)}</span>
    ${fields.address
      ? `<span class="recipient-line">${esc(fields.address)}</span>`
      : ""}
    ${fields.postcode
      ? `<span class="recipient-line">${esc(fields.postcode)}</span>`
      : ""}
  </div>

  <p>Hi ${esc(fields.taxpayerName)},</p>
  <p>I hope this email finds you well!</p>

  <p>
    I hereby attach your Personal Tax Return and Tax Calculation (SA302)
    for the year ended 5 April ${endYear}.
  </p>

  <p>Your tax liability for the year is as follows:</p>

  <p>
    <strong>Tax Payer Name:</strong> ${esc(fields.taxpayerName)}<br />
    <strong>UTR Number:</strong> ${esc(fields.utr)}<br />
    <strong>Tax liability ${esc(fields.taxYear)}:</strong> ${taxLiability}<br />
    <strong>Tax due and payable by 31 January ${yearPlus1} is</strong> ${dueBy31Jan}<br />
    <strong>Tax due and payable by 31 July ${yearPlus1} is</strong> ${dueBy31Jul}
  </p>

  <p>
    Please can you review and subsequently approve the attached
    document(s), we require Page TR8 of the Personal Tax Return to be
    signed and dated by yourself, before we can proceed with submission
    to HM Revenue &amp; Customs.
  </p>

  <p>
    Alternatively, if you are unable to print and return the signed
    page at this time, please provide a response to this e-mail as a
    formal approval of the Tax Return and subsequent submission to HM
    Revenue and Customs. Should this be the case please provide us
    with the signed page, at a later date when you are able to.
  </p>

  <p>
    You will be able to make the payment using the following link:
    https://www.gov.uk/pay-self-assessment-tax-bill
  </p>

  <p>
    If you wish to pay the above liability directly from your salary
    from the next tax year we will be able to request for HMRC to do
    this, please respond to this e-mail with confirmation if you would
    like us to arrange for this.
  </p>

  <p>
    Alternatively, you may wish to make the payment via bank transfer
    in which case you can use the following details:
  </p>

  <div class="pay-details">
    <div class="line"><strong>HMRC Payment Details</strong></div>
    <div class="line">Account name: HMRC Cumbernauld</div>
    <div class="line">Account number: 12001039</div>
    <div class="line">Sort code: 08-32-10</div>
    <div class="line">Your payment reference is: <span class="pay-ref-code">${esc(paymentRef)}</span></div>
  </div>

  <p>
    Please ensure you enter the payment reference (your 10-Digit
    Personal UTR) exactly as shown above, as a single error may end up
    in the payment being lost.
  </p>

  <p>
    I trust the above is clear, however if you have any questions
    please do not hesitate to get in touch.
  </p>

  <div class="signoff">
    <p>Kind regards,</p>
    <div class="signoff-firm">${esc(FIRM_TRADING_NAME)}</div>
  </div>
</body>
</html>`;
}

// Parse "YYYY/YY" (e.g. "2024/25") into year start/end. Defensive on
// malformed input: the letter still needs to render without blowing up
// if tax_year is missing or malformed; a sensible fallback is better
// than a 500.
function parseTaxYear(ty: string): { startYear: number; endYear: number } {
  const m = /^(\d{4})\/(\d{2})$/.exec(ty.trim());
  if (!m) {
    const now = new Date().getUTCFullYear();
    return { startYear: now - 1, endYear: now };
  }
  const startYear = Number(m[1]);
  const endYear = startYear + 1;
  return { startYear, endYear };
}

// HMRC SA payment reference: plain 10-digit UTR, no suffix. The user
// attached a sample letter explicitly showing a plain-UTR reference
// ("Your payment reference is: 5739372194"), which reverses the Phase
// I.2 decision to append a "K" suffix. The sample is the source of
// truth here.
export function buildPaymentRef(utr: string): string {
  return (utr ?? "").replace(/[^0-9]/g, "");
}

function fmtMoney(n: number): string {
  const safe = Number.isFinite(n) ? n : 0;
  return "£" + safe.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function esc(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
