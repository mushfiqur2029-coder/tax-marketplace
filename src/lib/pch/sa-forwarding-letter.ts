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
//   {PaymentRef}          -> UTR + "K" (no space), e.g. 1234567890K
//
// Firm block (confirmed with the user in Phase I.2 report):
//   "NAFH ACCOUNTANTS, trading name of SHANN ACCOUNTANCY AND
//    FINANCIAL SERVICES LTD"
//   "6 Havering Gardens, Romford, England, RM6 5AA"
//
// Static boilerplate wording below is a best-read of a standard UK
// SA Tax Return forwarding letter and has NOT been confirmed against
// the attached SA_Tax_return_forwarding.docx.pdf template. The I.4a
// report shows the full rendered copy so the user can diff + correct.
//
// Rendered as HTML + puppeteer, same pattern as src/lib/pch/export-
// pdf.ts and src/lib/engagement/pdf.ts.

import { renderPdfFromHtml } from "@/lib/engagement/pdf";
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

// Pure HTML renderer, exported for the I.4a dry-run report so the
// final wording can be previewed without round-tripping through
// puppeteer. All merge-field values pass through esc() so a client
// name or address with "<", ">", "&", "'" or '"' can't break the
// template.
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
  const lines = {
    taxLiability: fmtMoney(fields.snapshot.tax.totalTaxAndNic),
    dueBy31Jan: fmtMoney(fields.snapshot.tax.dueBy31Jan),
    dueBy31Jul: fmtMoney(fields.snapshot.tax.dueBy31Jul),
  };
  const todayFmt = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

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
  .firm-block {
    text-align: right;
    font-size: 10pt;
    line-height: 1.35;
    margin-bottom: 8mm;
  }
  .firm-trading { font-weight: 700; letter-spacing: 0.02em; }
  .firm-legal { color: #333; font-size: 9.5pt; }
  .firm-address { color: #555; font-size: 9.5pt; }
  .date { margin: 4mm 0 8mm 0; }
  .recipient { margin-bottom: 10mm; }
  .recipient-line { display: block; }
  .subject { font-weight: 700; margin: 6mm 0; }
  .amounts {
    margin: 6mm 0;
    padding: 4mm 5mm;
    border: 1px solid #ddd;
    border-radius: 4px;
    background: #fafafa;
  }
  .amount-row { display: flex; justify-content: space-between; margin: 1mm 0; }
  .amount-label { color: #333; }
  .amount-value { font-weight: 600; font-variant-numeric: tabular-nums; }
  .pay-ref {
    margin: 6mm 0;
    padding: 3mm 4mm;
    border-left: 3px solid #333;
    background: #f5f5f5;
    font-size: 10.5pt;
  }
  .pay-ref-code { font-family: "Courier New", monospace; font-weight: 700; }
  p { margin: 3mm 0; }
  .signoff { margin-top: 10mm; }
  .signoff-firm { font-weight: 700; margin-top: 6mm; }
</style>
</head>
<body>
  <div class="firm-block">
    <div class="firm-trading">${esc(FIRM_TRADING_NAME)}</div>
    <div class="firm-legal">trading name of ${esc(FIRM_LEGAL_NAME)}</div>
    <div class="firm-address">${esc(FIRM_ADDRESS)}</div>
  </div>

  <div class="date">${esc(todayFmt)}</div>

  <div class="recipient">
    <span class="recipient-line">${esc(fields.taxpayerName)}</span>
    ${fields.address
      ? `<span class="recipient-line">${esc(fields.address)}</span>`
      : ""}
    ${fields.postcode
      ? `<span class="recipient-line">${esc(fields.postcode)}</span>`
      : ""}
  </div>

  <p>Dear ${esc(firstNameOrFallback(fields.taxpayerName))},</p>

  <div class="subject">
    Self Assessment Tax Return for the year ended 5 April ${endYear}
  </div>

  <p>
    We enclose for your approval your Self Assessment Tax Return for the
    tax year ${esc(fields.taxYear)} (year ended 5 April ${endYear}),
    together with the supporting accounts and schedules we have prepared
    on your behalf.
  </p>

  <p>
    Your tax liability for the year is set out below. Please pay HMRC
    directly, using the payment reference shown further down. Nothing
    will be filed with HMRC until you have approved the figures.
  </p>

  <div class="amounts">
    <div class="amount-row">
      <span class="amount-label">Tax liability for the year</span>
      <span class="amount-value">${lines.taxLiability}</span>
    </div>
    <div class="amount-row">
      <span class="amount-label">Due by 31 January ${yearPlus1}
        (balancing payment plus first payment on account)</span>
      <span class="amount-value">${lines.dueBy31Jan}</span>
    </div>
    <div class="amount-row">
      <span class="amount-label">Due by 31 July ${yearPlus1}
        (second payment on account)</span>
      <span class="amount-value">${lines.dueBy31Jul}</span>
    </div>
  </div>

  <div class="pay-ref">
    HMRC payment reference:
    <span class="pay-ref-code">${esc(paymentRef)}</span>
  </div>

  <p>
    Please review the enclosed accounts and tax return carefully. If
    everything is in order, approve the figures via the link in your
    client portal; we will then file the return with HMRC on your
    behalf. If anything looks wrong, reply with the correction and we
    will update the return before filing.
  </p>

  <p>
    Please note it is your responsibility to pay HMRC by the deadlines
    above. HMRC will charge interest and penalties on amounts not paid
    on time, even where the return itself has been filed.
  </p>

  <div class="signoff">
    <p>Kind regards,</p>
    <div class="signoff-firm">${esc(FIRM_TRADING_NAME)}</div>
    <div class="firm-legal">${esc(FIRM_LEGAL_NAME)}</div>
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

// HMRC SA payment reference: 10-digit UTR followed by the letter K,
// e.g. 1234567890K. Confirmed with the user in the Phase I.2 report.
export function buildPaymentRef(utr: string): string {
  const digits = (utr ?? "").replace(/[^0-9]/g, "");
  if (digits.length === 0) return "";
  return digits + "K";
}

function firstNameOrFallback(fullName: string): string {
  const trimmed = (fullName ?? "").trim();
  if (!trimmed) return "Taxpayer";
  const first = trimmed.split(/\s+/)[0] ?? "";
  return first || "Taxpayer";
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
