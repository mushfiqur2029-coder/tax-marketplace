import "server-only";
import { renderPdfFromHtml } from "@/lib/engagement/pdf";
import type { PchExportPayload } from "./export-data";

// 3-page client-facing accounts pack followed by accountant working
// papers, matching the Taj Accountants reference pack layout
// (reference/pch-uber/1. PCH/SA 2084/2024-25 docs/PCH Accounts
// 2024-25.pdf):
//   Page 1  Cover: client name, "Report and Accounts", period, Prepared By firm block
//   Page 2  Accountant's Report (disclaimer + firm sign line) + Client's Approval (matching paragraph + client sign line)
//   Page 3  P&L: client header block, period, two-column £ / £ layout, Income, Less: Expenses (itemised), Total, Net Profit, client sign line
//   Page 4+ Working papers: SA103S boxes, Tax & NIC, override audit. Labelled "not for filing".

const fmtMoneyWhole = (n: number) =>
  Math.round(n ?? 0).toLocaleString("en-GB");
const fmtMoney2 = (n: number) =>
  (n ?? 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function esc(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SIGNATURE_DOTS = "………………………………………………........";

export async function renderPchExportPdf(p: PchExportPayload): Promise<Uint8Array> {
  return renderPdfFromHtml(buildHtml(p));
}

function buildHtml(p: PchExportPayload): string {
  const addressLines = (lines: string[]) =>
    lines.map((l) => `<div>${esc(l)}</div>`).join("");

  // Page 1: Cover
  const cover = `
    <section class="page cover">
      <div class="cover-stack">
        <div class="cover-title">${esc(p.client.name)}</div>
        <div class="cover-title">Report and Accounts</div>
        <div class="cover-period">
          <div>For The Period:</div>
          <div>${esc(p.periodFromDisplay)} to ${esc(p.periodToDisplay)}</div>
        </div>
        <div class="cover-firm">
          <div class="prepared-by">Prepared By:</div>
          <div class="firm-name">${esc(p.preparedBy.firmName)}</div>
          <div class="firm-address">${addressLines(p.preparedBy.addressLines)}</div>
        </div>
      </div>
    </section>`;

  // Page 2: Accountant's Report + Client's Approval
  const reportApproval = `
    <section class="page">
      <h2 class="section-head">ACCOUNTANT'S REPORT</h2>
      <p class="disclaimer">
        We have prepared without carrying out an audit the attached Profit and Loss
        Account for the period ended ${esc(p.periodEndedPhrase)}. These have been
        prepared from the information, accounting records and explanation received
        from the client named below.
      </p>
      <div class="sig-block">
        <div class="sig-left">
          <div class="sig-name"><strong>${esc(p.preparedBy.firmName)}</strong></div>
          ${addressLines(p.preparedBy.addressLines)}
        </div>
        <div class="sig-right">
          Date: &nbsp;${SIGNATURE_DOTS}
        </div>
      </div>

      <div class="spacer"></div>

      <h2 class="section-head">CLIENT'S APPROVAL</h2>
      <p class="disclaimer">
        I have approved the attached Profit and Loss Account for the period ending
        ${esc(p.periodEndedPhrase)}. These have been prepared from the information,
        records and explanations given by me.
      </p>
      <div class="sig-block">
        <div class="sig-left">
          <div class="sig-name"><strong>${esc(p.client.name)}</strong></div>
        </div>
        <div class="sig-right">
          Date: &nbsp;${SIGNATURE_DOTS}
        </div>
      </div>
    </section>`;

  // Page 3: P&L
  const pl = p.accountsPack;
  const expensesRows = pl.expenses.length === 0
    ? `<tr><td class="label" colspan="4" style="padding:12px 0;text-align:center;color:#64748b">No expenses recorded.</td></tr>`
    : pl.expenses.map((e) => `
        <tr>
          <td class="label">${esc(e.label)}</td>
          <td></td>
          <td class="num amount">${fmtMoneyWhole(e.amount)}</td>
          <td></td>
        </tr>`).join("");

  const plPage = `
    <section class="page">
      <div class="client-header">
        <div class="client-name"><strong>${esc(p.client.name)}</strong></div>
        <div><strong>(${esc(p.client.occupation)})</strong></div>
        ${p.client.addressLines.map((l) => `<div><strong>${esc(l)}</strong></div>`).join("")}
      </div>

      <h2 class="pl-head">Profit &amp; Loss Account For The Period:</h2>
      <div class="pl-period">${esc(p.periodFromDisplay)} to ${esc(p.periodToDisplay)}</div>

      <table class="pl-table">
        <thead>
          <tr>
            <td></td>
            <td></td>
            <td class="currency">£</td>
            <td class="currency">£</td>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="label"><strong>Income</strong></td>
            <td></td>
            <td></td>
            <td class="num total">${fmtMoneyWhole(pl.income)}</td>
          </tr>
          <tr><td colspan="4" class="spacer-row"></td></tr>
          <tr>
            <td class="label"><strong>Less: Expenses</strong></td>
            <td></td>
            <td></td>
            <td></td>
          </tr>
          ${expensesRows}
          <tr>
            <td colspan="4" class="rule-row"><div class="amount-rule"></div></td>
          </tr>
          <tr>
            <td class="label">Total</td>
            <td></td>
            <td></td>
            <td class="num total">${fmtMoneyWhole(pl.expensesTotal)}</td>
          </tr>
          <tr><td colspan="4" class="spacer-row"></td></tr>
          <tr>
            <td class="label"><strong>Net Profit</strong></td>
            <td></td>
            <td></td>
            <td class="num total double-underline"><strong>${fmtMoneyWhole(pl.netProfit)}</strong></td>
          </tr>
        </tbody>
      </table>

      <div class="pl-signoff">
        <div class="sig-left">${esc(p.client.name)}</div>
        <div class="sig-right"><strong>Date:</strong> &nbsp;&nbsp;${SIGNATURE_DOTS}</div>
      </div>
    </section>`;

  // Working papers (appended pages). Not for filing; the accountant's
  // internal audit trail of the SA103S boxes, tax computation and any
  // overrides applied on top of the engine.
  const wp = p.workingPapers;
  const sa103sRows = wp.sa103sBoxes.map((b) => {
    const delta = b.effective - b.engine;
    const deltaCell = Math.abs(delta) < 0.5
      ? "<td></td>"
      : `<td class="num" style="color:${delta > 0 ? "#047857" : "#be123c"}">${delta > 0 ? "+" : ""}${fmtMoneyWhole(delta)}</td>`;
    return `
      <tr>
        <td>${esc(b.label)}</td>
        <td class="num" style="color:#64748b">${fmtMoneyWhole(b.engine)}</td>
        <td class="num"><strong>${fmtMoneyWhole(b.effective)}</strong></td>
        ${deltaCell}
      </tr>`;
  }).join("");

  const overridesRows = wp.overrides.length === 0
    ? `<tr><td colspan="5" style="padding:12px 0;text-align:center;color:#94a3b8">No overrides on this case.</td></tr>`
    : wp.overrides.map((o) => {
        const isRevert = o.newValue === null;
        return `
          <tr>
            <td style="color:#64748b;font-size:11px">${esc(new Date(o.overriddenAt).toLocaleString("en-GB"))}</td>
            <td>${esc(o.fieldLabel)}</td>
            <td class="num" style="color:#64748b">${o.oldValue != null ? fmtMoneyWhole(o.oldValue) : "-"}</td>
            <td class="num"><strong>${isRevert ? "<span style=\"color:#94a3b8;font-style:italic\">reverted</span>" : fmtMoneyWhole(o.newValue!)}</strong></td>
            <td style="color:#64748b;font-size:11px">${esc(o.reason ?? "")}</td>
          </tr>`;
      }).join("");

  const workingPapersPages = `
    <section class="page wp">
      <div class="wp-banner">Working papers &middot; not for filing</div>
      <h2 class="wp-head">Accountant working papers</h2>
      <div class="wp-meta">
        Client ${esc(p.client.name)} &nbsp;&middot;&nbsp; Case ${esc(p.caseId)} &nbsp;&middot;&nbsp;
        Status ${esc(p.status)} &nbsp;&middot;&nbsp;
        ${p.snapshotAt ? "Snapshot " + esc(new Date(p.snapshotAt).toLocaleString("en-GB")) : "No snapshot yet"}
      </div>

      <div class="two-col">
        <div>
          <h3 class="wp-sub">Profit &amp; Loss</h3>
          <table class="wp-table">
            <tbody>
              ${wpRow("Turnover", fmtMoney2(wp.pl.turnover))}
              ${wpRow("Total expenses", fmtMoney2(wp.pl.expensesTotal))}
              ${wpRow("Net profit", fmtMoney2(wp.pl.netProfit))}
              ${wpRow("Capital allowances", fmtMoney2(wp.pl.capitalAllowances))}
              ${wpRow("Taxable profit", fmtMoney2(wp.pl.taxableProfit))}
            </tbody>
          </table>
        </div>
        <div>
          <h3 class="wp-sub">Tax &amp; NIC</h3>
          <table class="wp-table">
            <tbody>
              ${wpRow("Income tax", fmtMoney2(wp.tax.incomeTax))}
              ${wpRow("Class 4 NIC", fmtMoney2(wp.tax.class4))}
              ${wpRow("Class 2 NIC", wp.tax.class2Note || "-")}
              ${wpRow("Total due", fmtMoney2(wp.tax.totalDue))}
              ${wpRow("Balancing payment (31 Jan)", fmtMoney2(wp.tax.balancingPayment))}
              ${wpRow("POA each (next year)", fmtMoney2(wp.tax.poaForNextYear))}
            </tbody>
          </table>
        </div>
      </div>

      <h3 class="wp-sub" style="margin-top:28px">SA103S boxes</h3>
      <table class="wp-table">
        <thead>
          <tr>
            <td class="col-head">Field</td>
            <td class="col-head num">Engine</td>
            <td class="col-head num">Effective</td>
            <td class="col-head num">Δ</td>
          </tr>
        </thead>
        <tbody>${sa103sRows}</tbody>
      </table>

      <h3 class="wp-sub" style="margin-top:28px">Overrides audit (${wp.overrides.length})</h3>
      <table class="wp-table">
        <thead>
          <tr>
            <td class="col-head">When</td>
            <td class="col-head">Field</td>
            <td class="col-head num">Old</td>
            <td class="col-head num">New</td>
            <td class="col-head">Reason</td>
          </tr>
        </thead>
        <tbody>${overridesRows}</tbody>
      </table>
    </section>`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Report and Accounts ${esc(p.client.name)}</title>
<style>
  @page { size: A4; margin: 20mm; }
  * { box-sizing: border-box; }
  body {
    font-family: Calibri, "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: #0f172a; font-size: 12px; line-height: 1.5; margin: 0; padding: 0;
  }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }

  /* --- Cover --- */
  .cover { text-align: center; display: flex; flex-direction: column; }
  .cover-stack { padding-top: 32mm; display: flex; flex-direction: column; gap: 10mm; height: 100%; }
  .cover-title { font-size: 15px; font-weight: 700; text-decoration: underline; }
  .cover-period { font-size: 14px; font-weight: 700; text-decoration: underline; }
  .cover-period div { line-height: 1.6; }
  .cover-firm { margin-top: 55mm; }
  .prepared-by { font-weight: 700; text-decoration: underline; margin-bottom: 6mm; }
  .firm-name { font-weight: 700; }
  .firm-address { margin-top: 2mm; }
  .firm-address div { line-height: 1.4; }

  /* --- Report + Approval --- */
  .section-head { font-size: 13px; font-weight: 700; text-decoration: underline; margin: 10mm 0 6mm; }
  .disclaimer { font-size: 12px; line-height: 1.6; margin: 0 0 12mm; }
  .sig-block { display: table; width: 100%; }
  .sig-left, .sig-right { display: table-cell; vertical-align: top; }
  .sig-right { text-align: right; }
  .sig-name { margin-bottom: 2mm; }
  .spacer { height: 25mm; }

  /* --- P&L --- */
  .client-header { text-align: center; margin: 0 0 10mm; }
  .client-header div { line-height: 1.5; text-decoration: underline; }
  .pl-head { text-align: center; font-size: 13px; font-weight: 700; text-decoration: underline; margin: 10mm 0 1mm; }
  .pl-period { text-align: center; font-weight: 700; text-decoration: underline; margin-bottom: 10mm; }
  .pl-table { width: 100%; border-collapse: collapse; margin-top: 8mm; }
  .pl-table td { padding: 2.5mm 2mm; vertical-align: top; }
  .pl-table td.label { padding-left: 0; }
  .pl-table td.num { text-align: right; font-variant-numeric: tabular-nums; padding-right: 0; }
  .pl-table td.currency { text-align: right; font-weight: 700; border-bottom: 1pt solid #0f172a; padding-right: 0; width: 25mm; }
  .pl-table td.amount { width: 25mm; }
  .pl-table td.total { width: 25mm; }
  .pl-table td.double-underline { border-top: 1pt solid #0f172a; border-bottom: 3pt double #0f172a; }
  .spacer-row { height: 3mm; }
  .rule-row .amount-rule { border-top: 1pt solid #0f172a; width: 25mm; margin-left: auto; }
  .pl-signoff { display: table; width: 100%; margin-top: 25mm; }
  .pl-signoff .sig-left { display: table-cell; }
  .pl-signoff .sig-right { display: table-cell; text-align: right; }

  /* --- Working papers --- */
  .wp-banner { background: #fef3c7; color: #78350f; padding: 2mm 4mm; border-left: 3mm solid #d97706; font-weight: 700; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; margin-bottom: 8mm; }
  .wp-head { font-size: 16px; margin: 0 0 2mm; }
  .wp-meta { color: #64748b; font-size: 11px; margin-bottom: 8mm; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; }
  .wp-sub { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #475569; margin: 0 0 3mm; border-bottom: 1px solid #e2e8f0; padding-bottom: 1mm; }
  .wp-table { width: 100%; border-collapse: collapse; }
  .wp-table td { padding: 1.5mm 3mm 1.5mm 0; vertical-align: top; }
  .wp-table td.num { text-align: right; font-variant-numeric: tabular-nums; padding-right: 0; }
  .wp-table .col-head { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; border-bottom: 1px solid #e2e8f0; padding-bottom: 1.5mm; }
</style>
</head>
<body>
  ${cover}
  ${reportApproval}
  ${plPage}
  ${workingPapersPages}
</body>
</html>`;
}

function wpRow(label: string, value: string): string {
  return `<tr>
    <td style="color:#475569">${esc(label)}</td>
    <td class="num"><strong>${esc(value)}</strong></td>
  </tr>`;
}
