import "server-only";
import type { PchExportPayload } from "./export-data";

// CSV formatted for Capium Self Assessment import. One row per figure
// using box-number keys that match Capium's SA103 input grid, plus
// client header fields so the row can be matched to the right client
// at import time.
//
// Capium's documented CSV import for Self Assessment uses a key-value
// layout; we emit one "field,value" per row so the accountant can
// drag-and-drop into Capium's import mapper without reshaping. Values
// are in whole GBP (Capium's SA103S fields are whole-pound entries).
//
// Keys mirror the HMRC SA103S box numbers for the P&L section plus a
// short "SA302" group of final tax/NIC totals the accountant usually
// has to type into Capium's Self Assessment screen.

function csvEscape(value: string | number | null | undefined): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

const whole = (n: number) => Math.round(n ?? 0);

export function renderPchExportCapiumCsv(p: PchExportPayload): string {
  const w = p.workingPapers;
  const sa103 = (path: string) =>
    w.sa103sBoxes.find((b) => b.path === "sa103s." + path)?.effective ?? 0;

  const header = ["field", "box", "value_gbp", "note"];
  const rows: (string | number | null)[][] = [
    // Client identifiers
    ["client_name", "", p.client.name, ""],
    ["client_utr", "", p.client.utr ?? "", ""],
    ["client_ni_number", "", p.client.niNumber ?? "", ""],
    ["tax_year", "", p.taxYear, ""],
    ["period_from", "", p.periodFromIso, ""],
    ["period_to", "", p.periodToIso, ""],

    // SA103S P&L boxes (what the accountant copies into Capium's SA103S form)
    ["turnover", "SA103S box 9", whole(sa103("box9_turnover")), "Gross trading income"],
    ["car_van_travel", "SA103S box 12", whole(sa103("box12_carVanTravel")), ""],
    ["rent_rates_power_insurance", "SA103S box 14", whole(sa103("box14_rentRatesPowerInsurance")), ""],
    ["accountancy_legal_prof", "SA103S box 16", whole(sa103("box16_accountancyLegalProf")), ""],
    ["interest_bank_card_charges", "SA103S box 17", whole(sa103("box17_interestBankCardCharges")), ""],
    ["phone_office_costs", "SA103S box 18", whole(sa103("box18_phoneAndOfficeCosts")), ""],
    ["other_allowable", "SA103S box 19", whole(sa103("box19_otherAllowable")), ""],
    ["total_allowable", "SA103S box 20", whole(sa103("box20_totalAllowable")), ""],
    ["net_profit", "SA103S box 21", whole(sa103("box21_netProfit")), ""],

    // Capital allowances (SA103S boxes 24.1-26, 31)
    ["zero_emission_car_fya", "SA103S box 24.1", whole(sa103("box24_1_zeroEmissionCarFya")), ""],
    ["other_capital_allowances", "SA103S box 25", whole(sa103("box25_otherCapitalAllowances")), ""],
    ["balancing_charges", "SA103S box 26", whole(sa103("box26_balancingCharges")), ""],
    ["total_taxable_profits", "SA103S box 31", whole(sa103("box31_totalTaxableProfits")), "Final taxable profit"],

    // Tax + NIC totals (Capium's SA302 preview; usually computed by
    // Capium itself but included here so the accountant can double-
    // check that import matches what we signed off on)
    ["taxable_profit_effective", "", whole(w.pl.taxableProfit), "After capital allowances, override-adjusted"],
    ["income_tax", "", whole(w.tax.incomeTax), "Override-adjusted"],
    ["class_4_nic", "", whole(w.tax.class4), "Override-adjusted"],
    ["class_2_nic", "", "", w.tax.class2Note || ""],
    ["total_tax_due", "", whole(w.tax.totalDue), "Income tax + Class 4 NIC"],
    ["balancing_payment_31_jan", "", whole(w.tax.balancingPayment), ""],
    ["poa_each_next_year", "", whole(w.tax.poaForNextYear), "Each of two POAs (31 Jan + 31 Jul)"],

    // Sign-off trail
    ["accountant_firm", "", p.preparedBy.firmName, ""],
    ["approved_by", "", p.approval.name ?? "", ""],
    ["approved_at_iso", "", p.approval.at ?? "", ""],
    ["case_id", "", p.caseId, ""],
    ["case_status", "", p.status, ""],
  ];

  const lines = [
    "# Sterling Ledger PCH automated: Capium Self Assessment import",
    "# Field keys match HMRC SA103S boxes; values are override-aware (what the accountant signed off on).",
    header.join(","),
    ...rows.map((r) => r.map(csvEscape).join(",")),
  ];
  return lines.join("\n") + "\n";
}
