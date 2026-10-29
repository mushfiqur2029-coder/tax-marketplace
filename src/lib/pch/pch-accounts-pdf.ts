import "server-only";

// PCH Accounts PDF generator for the Phase I "Generate documents"
// button on the accountant workspace. Scope confirmed with the user:
// Cover Page, Information, P&L, and "Accntnts Rprt & Clients Apprvl"
// sheets from the PCH_Accounts_TAX_PERIOD_YEAR.xlsx template, plus
// one extra page per declaration section (5-15) the client marked
// "applicable" in pch_cases.cl_declaration_status.
//
// Deliberately out of scope (confirmed with user): the Income &
// Expenses monthly table and the Interest / Calculation sheets.
//
// Firm block + payment-ref format are shared with the SA Forwarding
// Letter (see sa-forwarding-letter.ts) so the two docs always carry
// the same letterhead.
//
// P&L page row set mirrors the accountant portal's PlSummaryTable
// (pl-review-panel.tsx) exactly: raw per-slot amounts the client
// typed in, one row per INCOME_FIXED_SLOTS / EXPENSE_FIXED_SLOTS
// entry in that fixed order, plus "Other income" / "Other adjust-
// ments" catch-alls for any custom-labelled lines. The bottom-line
// Total / Taxable profit / Net Profit figures still come off the
// confirmed engine snapshot - the engine applies business-use % per
// car-cost line that a raw sum can't reproduce without duplicating
// that math, which is the exact drift risk the summary table also
// guards against.
//
// Rendered as HTML + puppeteer, same path as the SA Forwarding
// Letter and the old export-pdf.ts.

import { renderPdfFromHtml } from "@/lib/engagement/pdf";
import { logoDataUrl } from "@/lib/branding/logo";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { TaxEngineOutput } from "@/lib/tax-engine";
import {
  FIRM_ADDRESS,
  FIRM_LEGAL_NAME,
  FIRM_TRADING_NAME,
} from "./sa-forwarding-letter";
import {
  EXPENSE_FIXED_SLOTS,
  INCOME_FIXED_SLOTS,
} from "./intake-slots";

type DeclarationStatuses = Partial<Record<string, "applicable" | "not_applicable">>;

type HeadRow = {
  cl_name: string | null;
  cl_address: string | null;
  cl_postcode: string | null;
  cl_utr: string | null;
  tax_year: string | null;
  cl_declaration_status: unknown;
  engine_snapshot: unknown;
  // Declaration-card scalar fields (section 5-15).
  benefits_note: string | null;
  employment_income_pence: number | null;
  p11d_pence: number | null;
  bank_interest_pence: number | null;
  dividend_income_pence: number | null;
  capital_gains_pence: number | null;
  capital_gains_note: string | null;
  gross_rent_received_pence: number | null;
  rental_profit_pence: number | null;
  personal_pension_net_pence: number | null;
  gift_aid_net_pence: number | null;
  child_benefit_pence: number | null;
  overseas_income_pence: number | null;
  overseas_tax_paid_pence: number | null;
  student_loan_plan: string | null;
  anything_else_note: string | null;
  // Phase I signature fields; populated by the client's approval
  // card. When present they get stamped on the Accountant's Report &
  // Client's Approval page.
  client_approved_at: string | null;
  client_approved_signature_name: string | null;
};

type GiftAidEntry = {
  charity_name: string | null;
  donation_date: string | null;
  amount_pence: number;
};

export type PchAccountsPdfInputs = {
  taxpayerName: string;
  address: string;
  postcode: string;
  utr: string;
  taxYear: string;
  // Private use is read from snapshot.pl.privateUseAmount, no longer
  // a separate input - the "Less: Private use" row on the PDF and
  // the Taxable profit figure now share a single source of truth,
  // so they can't drift apart.
  snapshot: TaxEngineOutput;
  // Raw per-slot amounts the client typed in. The P&L page lists one
  // row per INCOME_FIXED_SLOTS / EXPENSE_FIXED_SLOTS entry, in that
  // fixed order, matching PlSummaryTable in pl-review-panel.tsx
  // exactly. Any custom-labelled row the accountant added rolls up
  // into the "Other income" / "Other adjustments" catch-all rows.
  // Bottom-line Total / Taxable profit / Net Profit figures still
  // read off snapshot.pl (same reasoning PlSummaryTable's comment
  // gives: the engine applies business-use % that a raw sum can't
  // reproduce).
  incomeLines: Array<{ source: string; gross_takings_pence: number }>;
  expenseLines: Array<{ label: string; amount_paid_pence: number }>;
  declarationStatuses: DeclarationStatuses;
  // Scalar fields consulted by the declaration pages.
  decl: {
    p11dPence: number;
    employmentIncomePence: number;
    benefitsNote: string;
    bankInterestPence: number;
    dividendIncomePence: number;
    capitalGainsPence: number;
    capitalGainsNote: string;
    grossRentReceivedPence: number;
    rentalProfitPence: number;
    personalPensionNetPence: number;
    giftAidNetPence: number;
    childBenefitPence: number;
    overseasIncomePence: number;
    overseasTaxPaidPence: number;
    studentLoanPlan: string;
    anythingElseNote: string;
    giftAidEntries: GiftAidEntry[];
  };
  // When the client has approved via PchApprovalReviewCard (Phase I.5)
  // these drive the "Signed on behalf of the client" block on the
  // Accountant's Report & Client's Approval page. Null when the pack
  // is being generated BEFORE approval; the page then shows the
  // client's block blank (dotted sign-line + date) as per the Taj
  // template convention.
  clientApproval: { approvedAt: string; signatureName: string } | null;
  // Date the accountant generated / regenerated this pack. Stamped on
  // the firm's signature block on the approval page.
  generatedAt: Date;
};

export async function generatePchAccountsPdf(
  caseId: string,
  admin: ReturnType<typeof createAdminClient>,
): Promise<Uint8Array> {
  // Private use lives on snapshot.pl.privateUseAmount (post the Phase
  // M+5 engine wiring), so we no longer need a separate pch_vehicle
  // read here. One source of truth: the "Less: Private use" row and
  // the Taxable profit figure both read from the same snapshot and
  // can't drift apart.
  const [
    { data: head, error: headErr },
    { data: giftAid },
    { data: incomeRows },
    { data: expenseRows },
  ] = await Promise.all([
    admin
      .from("pch_cases")
      .select(
        "cl_name, cl_address, cl_postcode, cl_utr, tax_year, cl_declaration_status, engine_snapshot, benefits_note, employment_income_pence, p11d_pence, bank_interest_pence, dividend_income_pence, capital_gains_pence, capital_gains_note, gross_rent_received_pence, rental_profit_pence, personal_pension_net_pence, gift_aid_net_pence, child_benefit_pence, overseas_income_pence, overseas_tax_paid_pence, student_loan_plan, anything_else_note, client_approved_at, client_approved_signature_name",
      )
      .eq("case_id", caseId)
      .single(),
    admin
      .from("pch_gift_aid_entries")
      .select("charity_name, donation_date, amount_pence")
      .eq("case_id", caseId)
      .order("sort_order"),
    admin
      .from("pch_income_lines")
      .select("source, gross_takings_pence")
      .eq("case_id", caseId),
    admin
      .from("pch_expense_lines")
      .select("label, amount_paid_pence")
      .eq("case_id", caseId),
  ]);

  if (headErr || !head) {
    throw new Error("Could not load pch_cases head for PCH Accounts.");
  }
  const row = head as HeadRow;
  const snapshot = (row.engine_snapshot ?? null) as TaxEngineOutput | null;
  if (!snapshot) {
    throw new Error("Engine snapshot missing. Confirm the P&L before generating documents.");
  }

  const html = renderPchAccountsHtml({
    taxpayerName: row.cl_name ?? "",
    address: row.cl_address ?? "",
    postcode: row.cl_postcode ?? "",
    utr: row.cl_utr ?? "",
    taxYear: row.tax_year ?? "",
    snapshot,
    incomeLines: (incomeRows ?? []).map((r) => ({
      source: (r.source as string | null) ?? "",
      gross_takings_pence: Number(r.gross_takings_pence ?? 0),
    })),
    expenseLines: (expenseRows ?? []).map((r) => ({
      label: (r.label as string | null) ?? "",
      amount_paid_pence: Number(r.amount_paid_pence ?? 0),
    })),
    declarationStatuses:
      (row.cl_declaration_status ?? {}) as DeclarationStatuses,
    decl: {
      p11dPence: Number(row.p11d_pence ?? 0),
      employmentIncomePence: Number(row.employment_income_pence ?? 0),
      benefitsNote: row.benefits_note ?? "",
      bankInterestPence: Number(row.bank_interest_pence ?? 0),
      dividendIncomePence: Number(row.dividend_income_pence ?? 0),
      capitalGainsPence: Number(row.capital_gains_pence ?? 0),
      capitalGainsNote: row.capital_gains_note ?? "",
      grossRentReceivedPence: Number(row.gross_rent_received_pence ?? 0),
      rentalProfitPence: Number(row.rental_profit_pence ?? 0),
      personalPensionNetPence: Number(row.personal_pension_net_pence ?? 0),
      giftAidNetPence: Number(row.gift_aid_net_pence ?? 0),
      childBenefitPence: Number(row.child_benefit_pence ?? 0),
      overseasIncomePence: Number(row.overseas_income_pence ?? 0),
      overseasTaxPaidPence: Number(row.overseas_tax_paid_pence ?? 0),
      studentLoanPlan: row.student_loan_plan ?? "",
      anythingElseNote: row.anything_else_note ?? "",
      giftAidEntries: (giftAid ?? []).map((e) => ({
        charity_name: (e.charity_name as string | null) ?? "",
        donation_date: (e.donation_date as string | null) ?? "",
        amount_pence: Number(e.amount_pence ?? 0),
      })),
    },
    clientApproval:
      row.client_approved_at && row.client_approved_signature_name
        ? {
            approvedAt: row.client_approved_at,
            signatureName: row.client_approved_signature_name,
          }
        : null,
    generatedAt: new Date(),
  });

  return renderPdfFromHtml(html);
}

// ---------------------------------------------------------------
// Pure renderer, exported for the I.4b dry-run preview script.
// ---------------------------------------------------------------

export function renderPchAccountsHtml(p: PchAccountsPdfInputs): string {
  const { startYear, endYear } = parseTaxYear(p.taxYear);
  const periodLabel = `6 April ${startYear} to 5 April ${endYear}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>PCH Accounts, Tax Period ${esc(p.taxYear)}</title>
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
  .page { page-break-after: always; min-height: 257mm; }
  .page:last-of-type { page-break-after: auto; }
  h1 { font-size: 22pt; margin: 0 0 4mm 0; }
  h2 { font-size: 15pt; margin: 0 0 4mm 0; }
  h3 { font-size: 12pt; margin: 4mm 0 2mm 0; }
  .muted { color: #555; }
  .firm-trading { font-weight: 700; letter-spacing: 0.02em; }
  .firm-legal { color: #333; font-size: 10pt; }
  .firm-address { color: #555; font-size: 10pt; }

  /* Cover page */
  .cover {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-height: 230mm;
  }
  .cover-title { margin-top: 60mm; text-align: center; }
  .cover-title .for { color: #666; font-size: 12pt; margin-bottom: 3mm; }
  .cover-title .client { font-size: 26pt; font-weight: 700; margin-bottom: 2mm; }
  .cover-title .period { font-size: 13pt; color: #333; margin-top: 6mm; }
  .cover-prepared {
    margin-bottom: 8mm;
    text-align: center;
    font-size: 10.5pt;
    color: #333;
  }
  .cover-prepared .label {
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: 9.5pt;
    color: #777;
    margin-bottom: 2mm;
  }
  .powered-by {
    margin-top: 10mm;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 3mm;
    opacity: 0.75;
  }
  .powered-label {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 8pt;
    color: #777;
  }
  .powered-logo { height: 7mm; width: auto; display: block; }
  .powered-fallback {
    font-weight: 700;
    font-size: 10pt;
    letter-spacing: 0.03em;
    color: #0f1e4d;
  }

  /* Information + P&L shared table style */
  table.info { width: 100%; border-collapse: collapse; margin-top: 4mm; }
  table.info td { padding: 2mm 3mm; border-bottom: 1px solid #eee; vertical-align: top; }
  table.info td.label {
    width: 42%;
    color: #666;
    font-size: 10pt;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  table.pl { width: 100%; border-collapse: collapse; margin-top: 4mm; font-variant-numeric: tabular-nums; }
  table.pl th, table.pl td { padding: 1.5mm 3mm; }
  table.pl th.item, table.pl td.item { text-align: left; color: #222; }
  table.pl th.expense-col, table.pl td.expense-col,
  table.pl th.income-col, table.pl td.income-col {
    text-align: right;
    width: 30mm;
  }
  table.pl thead tr.head th {
    border-bottom: 1px solid #333;
    font-size: 10pt;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #555;
    font-weight: 700;
  }
  table.pl tr.section td { padding-top: 4mm; font-weight: 700; }
  table.pl tr.sub td { color: #444; }
  table.pl tr.total td { border-top: 1px solid #333; font-weight: 700; }
  table.pl tr.grand td { border-top: 2px solid #333; border-bottom: 2px solid #333; font-weight: 700; }
  table.pl tr.less td { color: #555; }

  /* Accountant's report / Approval */
  .block { margin: 8mm 0; }
  .block h2 { margin-bottom: 2mm; }
  .block p { margin: 2mm 0; text-align: justify; }
  .sign-row { display: flex; justify-content: space-between; gap: 10mm; margin-top: 8mm; }
  .sign-cell { flex: 1 1 0; font-size: 10.5pt; }
  .sign-cell .line { border-bottom: 1px solid #333; height: 6mm; margin-bottom: 2mm; }
  .sign-cell .label { color: #666; font-size: 9.5pt; }
  .sign-cell .value { font-weight: 600; }

  /* Declaration pages */
  .decl-section-label {
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: 10pt;
    color: #777;
    margin-bottom: 2mm;
  }
  .decl-field { margin: 3mm 0; }
  .decl-field .label {
    font-size: 10pt;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .decl-field .value { font-size: 12pt; font-weight: 600; color: #111; margin-top: 1mm; }
  .decl-field .value.money { font-variant-numeric: tabular-nums; }
  .decl-field .value.multi { font-weight: 500; white-space: pre-wrap; }
  table.giftaid { width: 100%; border-collapse: collapse; margin-top: 2mm; font-size: 10pt; }
  table.giftaid td, table.giftaid th {
    padding: 1.5mm 2mm;
    border-bottom: 1px solid #eee;
    text-align: left;
  }
  table.giftaid td.amount { text-align: right; font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
  ${renderCover({ taxpayerName: p.taxpayerName, periodLabel })}
  ${renderInformation({
    taxpayerName: p.taxpayerName,
    address: p.address,
    postcode: p.postcode,
    utr: p.utr,
    periodLabel,
  })}
  ${renderAccountantReportAndApproval({
    taxpayerName: p.taxpayerName,
    periodLabel,
    generatedAt: p.generatedAt,
    clientApproval: p.clientApproval,
  })}
  ${renderProfitAndLoss({
    taxpayerName: p.taxpayerName,
    periodLabel,
    snapshot: p.snapshot,
    incomeLines: p.incomeLines,
    expenseLines: p.expenseLines,
  })}
  ${renderDeclarationPages(p.declarationStatuses, p.decl, periodLabel)}
</body>
</html>`;
}

// ---------------------------------------------------------------
// Page renderers
// ---------------------------------------------------------------

function renderCover(args: {
  taxpayerName: string;
  periodLabel: string;
}): string {
  const logo = logoDataUrl();
  const sterlingBlock = logo
    ? `<img class="powered-logo" alt="Sterling Ledger" src="${logo}" />`
    : `<div class="powered-fallback">STERLING LEDGER</div>`;
  return `<section class="page cover">
    <div></div>
    <div class="cover-title">
      <div class="for">Report and Accounts for</div>
      <div class="client">${esc(args.taxpayerName)}</div>
      <div class="period">${esc(args.periodLabel)}</div>
    </div>
    <div class="cover-prepared">
      <div class="label">Prepared by</div>
      <div class="firm-trading">${esc(FIRM_TRADING_NAME)}</div>
      <div class="firm-legal">trading name of ${esc(FIRM_LEGAL_NAME)}</div>
      <div class="firm-address">${esc(FIRM_ADDRESS)}</div>
      <div class="powered-by">
        <span class="powered-label">Powered by</span>
        ${sterlingBlock}
      </div>
    </div>
  </section>`;
}

function renderInformation(args: {
  taxpayerName: string;
  address: string;
  postcode: string;
  utr: string;
  periodLabel: string;
}): string {
  const rows: Array<[string, string]> = [
    ["Client name", args.taxpayerName || "---"],
    ["Occupation", "Private hire car driver"],
    ["Client's case reference", args.utr || "---"],
    ["Residential address", args.address || "---"],
    ["Postcode", args.postcode || "---"],
    ["Period", args.periodLabel],
  ];
  return `<section class="page">
    <h1>Information</h1>
    <p class="muted">Reference details for this return.</p>
    <table class="info">
      ${rows
        .map(
          ([label, value]) => `<tr>
        <td class="label">${esc(label)}</td>
        <td>${esc(value)}</td>
      </tr>`,
        )
        .join("")}
    </table>
  </section>`;
}

function renderProfitAndLoss(args: {
  taxpayerName: string;
  periodLabel: string;
  snapshot: TaxEngineOutput;
  incomeLines: Array<{ source: string; gross_takings_pence: number }>;
  expenseLines: Array<{ label: string; amount_paid_pence: number }>;
}): string {
  const t = args.snapshot.pl;

  // Row set mirrors PlSummaryTable in pl-review-panel.tsx exactly:
  // one row per INCOME_FIXED_SLOTS entry (Uber / Bolt / Free Now / Cash
  // receipt / Others income) in that fixed order, then one row per
  // EXPENSE_FIXED_SLOTS entry (Fuel / Insurance / ... / Other expense),
  // then "Other income" / "Other adjustments" catch-alls for any custom-
  // labelled lines the accountant added. Values are the raw per-slot
  // amounts the client typed in (summed by label) so the accountant's
  // live Summary and this printed P&L stay 1:1.
  //
  // Bottom-line Total expenses / Taxable profit / Net Profit come off
  // the engine snapshot, matching PlSummaryTable's bottom block: the
  // engine applies business-use % per car-cost line in
  // allowablePerLine, which a raw sum here can't reproduce without
  // duplicating that math, which was the whole point of making
  // PlSummaryTable read the snapshot for those three figures.
  const incomePerLabel = INCOME_FIXED_SLOTS.map((slot) => ({
    label: slot.label,
    pence: sumByLabel(
      args.incomeLines.map((l) => ({ label: l.source, pence: l.gross_takings_pence })),
      slot.label,
    ),
  }));
  const incomeFixedLabelsLower = new Set(
    INCOME_FIXED_SLOTS.map((s) => s.label.trim().toLowerCase()),
  );
  const otherIncomePence = args.incomeLines.reduce(
    (s, r) =>
      incomeFixedLabelsLower.has((r.source ?? "").trim().toLowerCase())
        ? s
        : s + (r.gross_takings_pence ?? 0),
    0,
  );
  const totalIncomePence =
    incomePerLabel.reduce((s, r) => s + r.pence, 0) + otherIncomePence;

  const expensePerLabel = EXPENSE_FIXED_SLOTS.map((slot) => ({
    label: slot.label,
    pence: sumByLabel(
      args.expenseLines.map((l) => ({ label: l.label, pence: l.amount_paid_pence })),
      slot.label,
    ),
  }));
  const expenseFixedLabelsLower = new Set(
    EXPENSE_FIXED_SLOTS.map((s) => s.label.trim().toLowerCase()),
  );
  const otherExpensesPence = args.expenseLines.reduce(
    (s, r) =>
      expenseFixedLabelsLower.has((r.label ?? "").trim().toLowerCase())
        ? s
        : s + (r.amount_paid_pence ?? 0),
    0,
  );

  const privateUsePence = Math.round(t.privateUseAmount * 100);
  const toPence = (pounds: number) => Math.round(pounds * 100);

  return `<section class="page">
    <h1>Profit and Loss Account</h1>
    <p class="muted">
      ${esc(args.taxpayerName)} &middot; ${esc(args.periodLabel)}
    </p>
    <table class="pl">
      <thead>
        <tr class="head">
          <th class="item">Line item</th>
          <th class="expense-col">Expenses &pound;</th>
          <th class="income-col">Income &pound;</th>
        </tr>
      </thead>
      <tbody>
        <tr class="section">
          <td class="item" colspan="3">Income</td>
        </tr>
        ${incomePerLabel
          .map(
            (r) => `<tr class="sub">
          <td class="item">${esc(r.label)}</td>
          <td class="expense-col"></td>
          <td class="income-col">${fmtMoneyPence(r.pence)}</td>
        </tr>`,
          )
          .join("")}
        ${otherIncomePence > 0
          ? `<tr class="sub">
          <td class="item">Other income</td>
          <td class="expense-col"></td>
          <td class="income-col">${fmtMoneyPence(otherIncomePence)}</td>
        </tr>`
          : ""}
        <tr class="total">
          <td class="item">Total income</td>
          <td class="expense-col"></td>
          <td class="income-col">${fmtMoneyPence(totalIncomePence)}</td>
        </tr>

        <tr class="section">
          <td class="item" colspan="3">Less: Expenses</td>
        </tr>
        ${expensePerLabel
          .map(
            (r) => `<tr class="sub">
          <td class="item">${esc(r.label)}</td>
          <td class="expense-col">${fmtMoneyPence(r.pence)}</td>
          <td class="income-col"></td>
        </tr>`,
          )
          .join("")}
        ${otherExpensesPence > 0
          ? `<tr class="sub">
          <td class="item">Other adjustments</td>
          <td class="expense-col">${fmtMoneyPence(otherExpensesPence)}</td>
          <td class="income-col"></td>
        </tr>`
          : ""}
        <tr class="total">
          <td class="item">Total</td>
          <td class="expense-col">${fmtMoneyPence(toPence(t.expensesTotal))}</td>
          <td class="income-col"></td>
        </tr>

        <tr class="less">
          <td class="item">Less: Private use</td>
          <td class="expense-col">${fmtMoneyPence(privateUsePence)}</td>
          <td class="income-col"></td>
        </tr>

        <tr class="grand">
          <td class="item">Taxable profit</td>
          <td class="expense-col"></td>
          <td class="income-col">${fmtMoneyPence(toPence(t.taxableProfit))}</td>
        </tr>

        <tr class="grand">
          <td class="item">Net Profit</td>
          <td class="expense-col"></td>
          <td class="income-col">${fmtMoneyPence(toPence(t.netProfit))}</td>
        </tr>
      </tbody>
    </table>
  </section>`;
}

// Case-insensitive trim match, sum pence for a given label across the
// passed-in rows. Direct port of PlSummaryTable's sumByLabel helper
// (pl-review-panel.tsx) so the PDF's per-row sums and the accountant's
// live Summary table can't drift apart on label-matching semantics.
function sumByLabel(
  rows: Array<{ label: string; pence: number }>,
  label: string,
): number {
  const wanted = label.trim().toLowerCase();
  return rows.reduce(
    (s, r) =>
      (r.label ?? "").trim().toLowerCase() === wanted ? s + (r.pence ?? 0) : s,
    0,
  );
}

function fmtMoneyPence(pence: number): string {
  const safe = Number.isFinite(pence) ? pence : 0;
  return "£" + (safe / 100).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const ACCOUNTANT_REPORT_PARAGRAPH = `In accordance with the engagement letter dated and signed by you, we have compiled the Profit and Loss Account for the year on the basis of the accounting records provided and the information and explanations given to us. Our work has been carried out on the understanding that you have taken responsibility for the completeness and accuracy of the records; accordingly, we do not express an audit opinion on the figures. The accounts are prepared solely for the purpose of your Self Assessment tax return, and are not intended for any other purpose.`;

const CLIENT_APPROVAL_PARAGRAPH = `I approve the attached Profit and Loss Account for the year as prepared on the basis of the records and information I have supplied, and I confirm that these figures are complete and accurate to the best of my knowledge. I authorise the firm named above to use these figures as the basis for my Self Assessment tax return and to submit the return to HMRC on my behalf.`;

function renderAccountantReportAndApproval(args: {
  taxpayerName: string;
  periodLabel: string;
  generatedAt: Date;
  clientApproval: { approvedAt: string; signatureName: string } | null;
}): string {
  const genDate = args.generatedAt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const clientDate = args.clientApproval
    ? new Date(args.clientApproval.approvedAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";
  return `<section class="page">
    <h1>Accountant's Report &amp; Client's Approval</h1>
    <p class="muted">
      ${esc(args.taxpayerName)} &middot; ${esc(args.periodLabel)}
    </p>

    <div class="block">
      <h2>Accountant's Report</h2>
      <p>${esc(ACCOUNTANT_REPORT_PARAGRAPH)}</p>
      <div class="sign-row">
        <div class="sign-cell">
          <div class="line"></div>
          <div class="label">Signed for and on behalf of</div>
          <div class="value">${esc(FIRM_TRADING_NAME)}</div>
          <div class="firm-legal">${esc(FIRM_LEGAL_NAME)}</div>
        </div>
        <div class="sign-cell">
          <div class="line">${esc(genDate)}</div>
          <div class="label">Date</div>
        </div>
      </div>
    </div>

    <div class="block">
      <h2>Client's Approval</h2>
      <p>${esc(CLIENT_APPROVAL_PARAGRAPH)}</p>
      <div class="sign-row">
        <div class="sign-cell">
          <div class="line">${args.clientApproval ? esc(args.clientApproval.signatureName) : ""}</div>
          <div class="label">Signed</div>
          <div class="value">${esc(args.taxpayerName)}</div>
        </div>
        <div class="sign-cell">
          <div class="line">${esc(clientDate)}</div>
          <div class="label">Date</div>
        </div>
      </div>
    </div>
  </section>`;
}

// ---------------------------------------------------------------
// Declaration pages (sections 5-15). One page per card the client
// marked "applicable" in cl_declaration_status.
// ---------------------------------------------------------------

type DeclSpec = {
  key: string;
  sectionNumber: number;
  title: string;
};

// Section numbers mirror the client intake order after commit 7dde25a
// moved Rental to position 6 (right after P11D) and shifted Interest /
// Dividend / Capital gains down to 7 / 8 / 9. A declaration page in
// the filed pack now shows the same section number the client saw in
// section-4-14-declarations.tsx during intake.
const DECLARATION_PAGES: DeclSpec[] = [
  { key: "p11d", sectionNumber: 5, title: "Employment income and P11D benefits" },
  { key: "rental", sectionNumber: 6, title: "Rental income (UK or overseas)" },
  { key: "interest", sectionNumber: 7, title: "Interest income" },
  { key: "dividend", sectionNumber: 8, title: "Dividend income" },
  { key: "capital_gains", sectionNumber: 9, title: "Capital gains for the year" },
  { key: "pension", sectionNumber: 10, title: "Private pension contributions" },
  { key: "gift_aid", sectionNumber: 11, title: "Gift Aid charitable donations" },
  { key: "child_benefit", sectionNumber: 12, title: "Child benefit received" },
  { key: "overseas", sectionNumber: 13, title: "Overseas income and overseas tax paid" },
  { key: "student_loan", sectionNumber: 14, title: "Student loan plan" },
  { key: "anything_else", sectionNumber: 15, title: "Anything else relevant" },
];

function renderDeclarationPages(
  statuses: DeclarationStatuses,
  decl: PchAccountsPdfInputs["decl"],
  periodLabel: string,
): string {
  return DECLARATION_PAGES
    .filter((d) => statuses[d.key] === "applicable")
    .map((d) => renderDeclarationPage(d, decl, periodLabel))
    .join("");
}

function renderDeclarationPage(
  spec: DeclSpec,
  decl: PchAccountsPdfInputs["decl"],
  periodLabel: string,
): string {
  const body = renderDeclarationBody(spec.key, decl);
  return `<section class="page">
    <div class="decl-section-label">Section ${spec.sectionNumber}</div>
    <h1>${esc(spec.title)}</h1>
    <p class="muted">${esc(periodLabel)}</p>
    ${body}
  </section>`;
}

function renderDeclarationBody(
  key: string,
  decl: PchAccountsPdfInputs["decl"],
): string {
  switch (key) {
    case "p11d":
      return (
        field("Employment income (gross for the year)", moneyOrEmpty(decl.employmentIncomePence))
        + field("P11D benefits (total cash equivalent)", moneyOrEmpty(decl.p11dPence))
        + fieldMulti("Benefits summary", decl.benefitsNote)
      );
    case "interest":
      return field("Total interest for the year", moneyOrEmpty(decl.bankInterestPence));
    case "dividend":
      return field("Total dividends for the year", moneyOrEmpty(decl.dividendIncomePence));
    case "capital_gains":
      return (
        field("Approximate total gain", moneyOrEmpty(decl.capitalGainsPence))
        + fieldMulti("What was sold", decl.capitalGainsNote)
      );
    case "rental":
      return (
        field("Gross rent received", moneyOrEmpty(decl.grossRentReceivedPence))
        + field("Net rental profit", moneyOrEmpty(decl.rentalProfitPence))
      );
    case "pension":
      return field("Net amount paid for the year", moneyOrEmpty(decl.personalPensionNetPence));
    case "gift_aid":
      return (
        field("Gift Aid donations total (net)", moneyOrEmpty(decl.giftAidNetPence))
        + renderGiftAidTable(decl.giftAidEntries)
      );
    case "child_benefit":
      return field("Total received for the year", moneyOrEmpty(decl.childBenefitPence));
    case "overseas":
      return (
        field("Overseas income (gross)", moneyOrEmpty(decl.overseasIncomePence))
        + field("Overseas tax already paid", moneyOrEmpty(decl.overseasTaxPaidPence))
      );
    case "student_loan":
      return field("Student loan plan", decl.studentLoanPlan || "---");
    case "anything_else":
      return fieldMulti("Note", decl.anythingElseNote);
    default:
      return "";
  }
}

function field(label: string, value: string): string {
  const isMoney = value.startsWith("£");
  return `<div class="decl-field">
    <div class="label">${esc(label)}</div>
    <div class="value${isMoney ? " money" : ""}">${esc(value)}</div>
  </div>`;
}

function fieldMulti(label: string, value: string): string {
  const safe = (value ?? "").trim();
  return `<div class="decl-field">
    <div class="label">${esc(label)}</div>
    <div class="value multi">${esc(safe.length === 0 ? "---" : safe)}</div>
  </div>`;
}

function renderGiftAidTable(entries: GiftAidEntry[]): string {
  if (entries.length === 0) return "";
  const rows = entries
    .map(
      (e) => `<tr>
    <td>${esc(e.charity_name ?? "")}</td>
    <td>${esc(formatDonationDate(e.donation_date))}</td>
    <td class="amount">${fmtMoney(e.amount_pence / 100)}</td>
  </tr>`,
    )
    .join("");
  return `<div class="decl-field">
    <div class="label">Donations</div>
    <table class="giftaid">
      <tr>
        <th>Charity</th>
        <th>Date</th>
        <th style="text-align: right">Amount</th>
      </tr>
      ${rows}
    </table>
  </div>`;
}

function formatDonationDate(iso: string | null | undefined): string {
  const safe = (iso ?? "").trim();
  if (!safe) return "---";
  const d = new Date(safe);
  if (Number.isNaN(d.getTime())) return safe;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function moneyOrEmpty(pence: number): string {
  if (!Number.isFinite(pence) || pence <= 0) return "---";
  return fmtMoney(pence / 100);
}

// ---------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------

function parseTaxYear(ty: string): { startYear: number; endYear: number } {
  const m = /^(\d{4})\/(\d{2})$/.exec(ty.trim());
  if (!m) {
    const now = new Date().getUTCFullYear();
    return { startYear: now - 1, endYear: now };
  }
  const startYear = Number(m[1]);
  return { startYear, endYear: startYear + 1 };
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
