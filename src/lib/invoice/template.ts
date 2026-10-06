import "server-only";
import fs from "node:fs";
import path from "node:path";

// Invoice PDF template. Modelled on the Invoice.xlsx the user shared,
// cleaned up visually to the same quality bar as the engagement
// letter. Same logo + heading font family + muted navy accent so
// recipients see one consistent Sterling Ledger brand.
//
// Rendered as a full HTML document that Puppeteer prints to A4 PDF
// via the shared src/lib/engagement/pdf.ts helper — no duplicate
// chromium pipeline.

export type InvoiceLineItem = {
  description: string;
  // Unit price in pence. One line = one unit, so unit price equals
  // the row total; keeping both columns matches the spreadsheet
  // template's shape and leaves room for multi-unit items later.
  unitPricePence: number;
};

export type InvoiceData = {
  invoiceNumber: string;        // e.g. "SL-2026-000042"
  // "Invoice for" block. billingPrimary is the big name on top
  // (company name on a Limited Company invoice, client's full name
  // on a Personal one). billingSecondary is a smaller muted line
  // underneath (client name + email for LC; just email for Personal).
  // The template never falls back to the email as the primary.
  billingPrimary: string;
  billingSecondary: string | null;
  // Paid date, in Europe/London. Rendered as "6 October 2026".
  paidDateLabel: string;
  // Stripe payment-intent id (or similar reference). Printed in the
  // Payment Information section under "Reference".
  paymentReference: string;
  // Human-readable payment method, e.g. "Card (Visa .. 4242)" when
  // we have the brand+last4, otherwise just "Card". Callers resolve
  // this; the template just prints what it's given.
  paymentMethod: string;
  // One or more lines. Case path: service + optional urgent fee.
  // Add-on path: a single row for the add-on itself.
  items: InvoiceLineItem[];
};

// Logo as a data URL, cached per process. Matches the engagement
// letter path — same file, same base64 pipeline, same text wordmark
// fallback if the file ever goes missing.
let logoDataUrlCache: string | null = null;
function logoDataUrl(): string {
  if (logoDataUrlCache !== null) return logoDataUrlCache;
  try {
    const p = path.resolve(process.cwd(), "design-reference/Logo3s.png");
    const bytes = fs.readFileSync(p);
    logoDataUrlCache = `data:image/png;base64,${bytes.toString("base64")}`;
  } catch (err) {
    console.error(
      `[invoice] logo load failed: ${err instanceof Error ? err.message : String(err)}`,
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

// Pretty-print pence as "£1,250" or "£1,249.99". Matches
// src/lib/case/pricing.ts formatFeeGbp semantics so the invoice's
// numbers line up exactly with every other place the fee is shown.
function money(pence: number): string {
  const whole = Math.floor(Math.abs(pence) / 100);
  const remainder = Math.abs(pence) % 100;
  const sign = pence < 0 ? "-" : "";
  const formatted = whole.toLocaleString("en-GB");
  return remainder === 0
    ? `${sign}£${formatted}`
    : `${sign}£${formatted}.${remainder.toString().padStart(2, "0")}`;
}

export function renderInvoiceHtml(d: InvoiceData): string {
  const logo = logoDataUrl();
  const logoBlock = logo
    ? `<img class="logo" alt="Sterling Ledger" src="${logo}" />`
    : `<div class="logo-fallback">STERLING LEDGER</div>`;

  const subtotalPence = d.items.reduce(
    (sum, i) => sum + i.unitPricePence,
    0,
  );
  const totalPence = subtotalPence;

  const rows = d.items
    .map(
      (i) => `
      <tr>
        <td class="desc">${esc(i.description)}</td>
        <td class="num">${money(i.unitPricePence)}</td>
        <td class="num">${money(i.unitPricePence)}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Invoice ${esc(d.invoiceNumber)} · Sterling Ledger</title>
<style>
  @page { size: A4 portrait; margin: 20mm; }
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #0f1e4d;
    font-family: "Helvetica Neue", "Arial", "Helvetica", sans-serif;
    font-size: 10.5pt;
    line-height: 1.5;
  }
  .page {
    padding: 20mm;
    max-width: 170mm;
    margin: 0 auto;
    position: relative;
  }

  /* Masthead -------------------------------------------------------- */
  .masthead {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 24px;
    border-bottom: 1px solid #e2e5ee;
    padding-bottom: 16px;
    margin-bottom: 28px;
  }
  .masthead .brand-left { max-width: 60%; }
  .logo { height: 54px; width: auto; display: block; margin-bottom: 10px; }
  .logo-fallback {
    font-weight: 700;
    font-size: 20pt;
    letter-spacing: 0.03em;
    color: #0f1e4d;
    margin-bottom: 10px;
  }
  .org-addr {
    font-size: 9.5pt;
    color: #4b5c89;
    margin-top: 2px;
  }
  .org-url {
    font-size: 9.5pt;
    color: #4b5c89;
    margin-top: 4px;
  }
  .masthead .doc-id {
    text-align: right;
    min-width: 160px;
  }
  .doc-title {
    font-weight: 700;
    font-size: 26pt;
    letter-spacing: 0.02em;
    color: #0f1e4d;
    margin: 0;
    line-height: 1;
  }
  .doc-num {
    margin-top: 6px;
    font-size: 10pt;
    color: #4b5c89;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .doc-num strong {
    display: block;
    margin-top: 2px;
    font-size: 11pt;
    letter-spacing: 0.01em;
    color: #0f1e4d;
    text-transform: none;
  }

  /* "Invoice for" + Paid date ---------------------------------------- */
  .meta {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin-bottom: 22px;
  }
  .meta .block {
    font-size: 10pt;
  }
  .meta .label {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 9pt;
    color: #4b5c89;
    margin-bottom: 4px;
  }
  .meta .value {
    font-weight: 600;
    font-size: 12pt;
    color: #0f1e4d;
  }
  .meta .value-sub {
    margin-top: 2px;
    font-weight: 400;
    font-size: 9.5pt;
    color: #4b5c89;
    letter-spacing: 0;
  }
  .meta .block.right { text-align: right; }

  /* Line items ------------------------------------------------------- */
  table.items {
    width: 100%;
    border-collapse: collapse;
    margin-top: 10px;
    margin-bottom: 18px;
  }
  table.items thead th {
    text-align: left;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    font-size: 9pt;
    color: #4b5c89;
    padding: 10px 12px;
    background: #f6f8fc;
    border-bottom: 1px solid #e2e5ee;
  }
  table.items thead th.num { text-align: right; }
  table.items tbody td {
    padding: 11px 12px;
    border-bottom: 1px solid #eef0f6;
    vertical-align: top;
  }
  table.items tbody td.desc { color: #0f1e4d; }
  table.items tbody td.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: #0f1e4d;
  }

  /* Totals panel ----------------------------------------------------- */
  .totals {
    display: grid;
    grid-template-columns: 1fr 240px;
    gap: 24px;
    margin-bottom: 24px;
  }
  .totals .left { position: relative; }
  .totals .box {
    border: 1px solid #e2e5ee;
    background: #f6f8fc;
    border-radius: 8px;
    padding: 12px 14px;
  }
  .totals .row {
    display: flex;
    justify-content: space-between;
    padding: 5px 0;
    font-variant-numeric: tabular-nums;
  }
  .totals .row.total {
    border-top: 1px solid #d5dae8;
    margin-top: 6px;
    padding-top: 10px;
    font-weight: 700;
    font-size: 12.5pt;
  }

  /* PAID stamp ------------------------------------------------------- */
  .paid-stamp {
    position: absolute;
    left: 20mm;
    top: 20mm;
    display: inline-block;
    transform: translate(-10px, -2px) rotate(-6deg);
    padding: 8px 22px;
    border: 3px solid #0E9E77;
    color: #0E9E77;
    font-weight: 800;
    font-size: 24pt;
    letter-spacing: 0.08em;
    border-radius: 4px;
    background: rgba(19, 217, 160, 0.08);
  }
  /* Within the totals grid, pin to the empty left column. */
  .totals .left .paid-stamp {
    position: static;
    transform: rotate(-6deg);
  }

  /* Payment information --------------------------------------------- */
  .pay-info {
    border-top: 1px solid #e2e5ee;
    padding-top: 16px;
    margin-top: 10px;
  }
  .pay-info h3 {
    font-size: 10pt;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #4b5c89;
    margin: 0 0 10px 0;
  }
  .pay-info dl {
    display: grid;
    grid-template-columns: 150px 1fr;
    row-gap: 4px;
    column-gap: 12px;
    margin: 0;
  }
  .pay-info dt {
    color: #4b5c89;
    font-size: 10pt;
  }
  .pay-info dd {
    margin: 0;
    color: #0f1e4d;
    font-size: 10pt;
    word-break: break-all;
  }

  /* Footer ----------------------------------------------------------- */
  .footer {
    margin-top: 36px;
    padding-top: 12px;
    border-top: 1px solid #e2e5ee;
    font-size: 9pt;
    color: #4b5c89;
    text-align: center;
  }
</style>
</head>
<body>
<div class="page">

  <header class="masthead">
    <div class="brand-left">
      ${logoBlock}
      <div class="org-addr">
        Office 9218, 321-323 High Road<br/>
        Romford, England, RM6 6AX
      </div>
      <div class="org-url">www.sterlingledger.co.uk</div>
    </div>
    <div class="doc-id">
      <div class="doc-title">INVOICE</div>
      <div class="doc-num">
        Invoice No.
        <strong>${esc(d.invoiceNumber)}</strong>
      </div>
    </div>
  </header>

  <section class="meta">
    <div class="block">
      <div class="label">Invoice for</div>
      <div class="value">${esc(d.billingPrimary)}</div>
      ${d.billingSecondary ? `<div class="value-sub">${esc(d.billingSecondary)}</div>` : ""}
    </div>
    <div class="block right">
      <div class="label">Paid date</div>
      <div class="value">${esc(d.paidDateLabel)}</div>
    </div>
  </section>

  <table class="items">
    <thead>
      <tr>
        <th>Description</th>
        <th class="num">Unit price</th>
        <th class="num">Total price</th>
      </tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>

  <section class="totals">
    <div class="left">
      <div class="paid-stamp">PAID</div>
    </div>
    <div class="box">
      <div class="row">
        <span>Subtotal</span>
        <span>${money(subtotalPence)}</span>
      </div>
      <div class="row total">
        <span>Total</span>
        <span>${money(totalPence)}</span>
      </div>
    </div>
  </section>

  <section class="pay-info">
    <h3>Payment information</h3>
    <dl>
      <dt>Payment method</dt><dd>${esc(d.paymentMethod)}</dd>
      <dt>Reference</dt><dd>${esc(d.paymentReference)}</dd>
      <dt>Paid date</dt><dd>${esc(d.paidDateLabel)}</dd>
    </dl>
  </section>

  <div class="footer">
    Thank you — this invoice is a receipt for a payment that has
    already settled. No further action is required.
  </div>

</div>
</body>
</html>`;
}
