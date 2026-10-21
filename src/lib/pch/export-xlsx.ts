import "server-only";
import * as XLSX from "xlsx";
import type { PchExportPayload } from "./export-data";
import { SA103S_UI } from "./sa103s-labels";

// Workbook structure mirrors the Taj Accountants reference pack
// (reference/pch-uber/1. PCH/SA 2084/2024-25 docs/PCH Accounts
// 2024-25.xlsx):
//   Information                         - client meta table
//   Cover Page                          - vertical title block
//   Accntnt's Rprt & Clients Apprvl     - disclaimers + signature lines
//   P&L                                 - two-column P&L (£ / £)
//   Working papers - P&L & Tax          - accountant tax calc
//   Working papers - SA103S boxes       - engine/effective/delta rows
//   Working papers - Overrides          - full audit trail

const SIGNATURE_DOTS = "………………………………………………........";

// Same fallback as the PDF builder: a real date once that step has
// actually happened, a blank dotted line beforehand.
function sigDate(iso: string | null): string {
  if (!iso) return SIGNATURE_DOTS;
  return new Date(iso).toLocaleDateString("en-GB");
}

function newSheet(aoa: (string | number | null | undefined)[][]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(aoa as unknown as (string | number)[][]);
}

export function renderPchExportXlsx(p: PchExportPayload): Uint8Array {
  const wb = XLSX.utils.book_new();

  // --- Information ---
  const infoAddress: (string | null | undefined)[][] = p.client.addressLines.map((l, i) =>
    i === 0 ? ["Client's Address:", l] : [null, l],
  );
  const infoSheet = newSheet([
    ["Client's Information"],
    [],
    ["Client Name:", p.client.name],
    [],
    ["Client's Reference:", p.client.reference],
    [],
    ["Client's Occupation:", `(${p.client.occupation})`],
    [],
    ...infoAddress,
    [],
    ["For The Period:", `${p.periodFromDisplay} to ${p.periodToDisplay}`],
    [],
    ["UTR:", p.client.utr ?? ""],
    ["NI Number:", p.client.niNumber ?? ""],
  ]);
  infoSheet["!cols"] = [{ wch: 24 }, { wch: 44 }];
  XLSX.utils.book_append_sheet(wb, infoSheet, "Information");

  // --- Cover Page ---
  const coverRows: (string | null)[][] = [
    [], [], [],
    [p.client.name],
    [],
    ["Report and Accounts"],
    [],
    ["For The Period:"],
    [`${p.periodFromDisplay} to ${p.periodToDisplay}`],
  ];
  // Pad to match reference layout: Prepared By block sits lower down.
  while (coverRows.length < 33) coverRows.push([]);
  coverRows.push(["Prepared By:"]);
  coverRows.push([]);
  coverRows.push([p.preparedBy.firmName]);
  for (const line of p.preparedBy.addressLines) coverRows.push([line]);
  const coverSheet = newSheet(coverRows);
  coverSheet["!cols"] = [{ wch: 48 }];
  XLSX.utils.book_append_sheet(wb, coverSheet, "Cover Page");

  // --- Accountant's Report & Client's Approval ---
  const accountantReportDate = `Date: ${sigDate(p.finalPack.sentAt)}`;
  const clientApprovalDate = `Date: ${sigDate(p.finalPack.confirmedAt)}`;
  const reportAoa: (string | null)[][] = [
    [], [],
    ["ACCOUNTANT'S REPORT"],
    [],
    [`We have prepared without carrying out an audit the attached Profit and Loss Account for the period ended ${p.periodEndedPhrase}. These have been prepared from the information, accounting records and explanation received from the client named below.`],
  ];
  while (reportAoa.length < 14) reportAoa.push([]);
  reportAoa.push([p.preparedBy.firmName, null, null, accountantReportDate]);
  for (const line of p.preparedBy.addressLines) reportAoa.push([line]);
  while (reportAoa.length < 26) reportAoa.push([]);
  reportAoa.push(["CLIENT'S APPROVAL"]);
  reportAoa.push([]);
  reportAoa.push([`I have approved the attached Profit and Loss Account for the period ending ${p.periodEndedPhrase}. These have been prepared from the information, records and explanations given by me.`]);
  while (reportAoa.length < 38) reportAoa.push([]);
  reportAoa.push([p.client.name, null, null, clientApprovalDate]);
  const reportSheet = newSheet(reportAoa);
  reportSheet["!cols"] = [{ wch: 32 }, { wch: 20 }, { wch: 10 }, { wch: 44 }];
  // Widen row 4 (disclaimer) so the long paragraph wraps nicely in Excel.
  XLSX.utils.book_append_sheet(wb, reportSheet, "Report & Approval");

  // --- P&L ---
  const headerRows: (string | number | null)[][] = [
    [p.client.name],
    [`(${p.client.occupation})`],
    ...p.client.addressLines.map((l) => [l]),
  ];
  // Pad to row index 6
  while (headerRows.length < 6) headerRows.push([]);
  headerRows.push(["Profit & Loss Account For The Period:"]);
  headerRows.push([`${p.periodFromDisplay} to ${p.periodToDisplay}`]);
  while (headerRows.length < 11) headerRows.push([]);
  headerRows.push([null, null, null, "£", null, "£"]);
  headerRows.push(["Income", null, null, null, null, p.accountsPack.income]);
  headerRows.push([]);
  headerRows.push(["Less: Expenses"]);
  for (const e of p.accountsPack.expenses) {
    headerRows.push([e.label, null, null, Math.round(e.amount)]);
  }
  headerRows.push([]);
  headerRows.push(["Total", null, null, null, null, Math.round(p.accountsPack.expensesTotal)]);
  headerRows.push([]);
  headerRows.push(["Net Profit", null, null, null, null, Math.round(p.accountsPack.netProfit)]);
  headerRows.push([]);
  headerRows.push([]);
  headerRows.push([p.client.name, null, null, clientApprovalDate]);
  const plSheet = newSheet(headerRows);
  plSheet["!cols"] = [{ wch: 28 }, { wch: 4 }, { wch: 4 }, { wch: 14 }, { wch: 4 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, plSheet, "P&L");

  // --- Working papers (not for filing) ---
  const wp = p.workingPapers;

  const taxCalcSheet = newSheet([
    ["Working papers, not for filing"],
    [],
    ["Snapshot at", p.snapshotAt ? new Date(p.snapshotAt).toISOString() : ""],
    ["Status", p.status],
    ["Approved by", p.approval.name ?? ""],
    ["Approved at", p.approval.at ? new Date(p.approval.at).toISOString() : ""],
    [],
    ["Profit & Loss (effective)", "£"],
    ["Turnover", wp.pl.turnover],
    ["Total expenses", wp.pl.expensesTotal],
    ["Net profit", wp.pl.netProfit],
    ["Capital allowances", wp.pl.capitalAllowances],
    ["Taxable profit", wp.pl.taxableProfit],
    [],
    ["Tax & NIC", "£"],
    ["Income tax", wp.tax.incomeTax],
    ["Class 4 NIC", wp.tax.class4],
    ["Class 2 NIC", wp.tax.class2Note || "-"],
    ["Total due", wp.tax.totalDue],
    ["Balancing payment (31 Jan)", wp.tax.balancingPayment],
    ["POA each (next year)", wp.tax.poaForNextYear],
  ]);
  taxCalcSheet["!cols"] = [{ wch: 32 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, taxCalcSheet, "WP - Tax calc");

  // Phase 7: drop the raw-path column, use the shared SA103S_UI's
  // human-readable label as the primary field text, keep the HMRC box
  // number as a narrow secondary column (sortable + filterable rather
  // than embedded in the label string). Falls back to the raw b.label
  // if a path isn't in the map (defensive).
  const sa103Rows: (string | number)[][] = [
    ["Working papers, SA103S filing boxes"],
    [],
    ["Field", "Box", "Engine £", "Effective £", "Delta £"],
    ...wp.sa103sBoxes.map((b) => {
      const ui = SA103S_UI[b.path];
      return [
        ui?.friendly ?? b.label,
        ui?.box ?? "",
        b.engine,
        b.effective,
        b.effective - b.engine,
      ];
    }),
  ];
  const sa103Sheet = newSheet(sa103Rows);
  sa103Sheet["!cols"] = [{ wch: 42 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, sa103Sheet, "WP - SA103S");

  const overrideRows: (string | number | null)[][] = [
    ["Working papers, override audit trail"],
    [],
    ["When", "Field", "Old £", "New £", "Reason", "By"],
    ...wp.overrides.map((o) => [
      new Date(o.overriddenAt).toISOString(),
      o.fieldLabel,
      o.oldValue,
      o.newValue,
      o.reason ?? "",
      o.overriddenByEmail ?? "",
    ]),
  ];
  const overrideSheet = newSheet(overrideRows);
  overrideSheet["!cols"] = [{ wch: 22 }, { wch: 36 }, { wch: 12 }, { wch: 12 }, { wch: 40 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, overrideSheet, "WP - Overrides");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
