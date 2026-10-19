// Shared SA103S filing-box UI metadata: friendly label (primary),
// the raw HMRC box number (shown as a muted secondary tag), and the
// subgroup the row belongs to on the accountant snapshot panel.
//
// Lifted out of src/app/accountant/cases/[id]/pch/pch-accountant-view.tsx
// so the PDF + XLSX working-papers exports can reuse the exact same
// label set rather than deriving their own (and drifting).
//
// Keep in sync with the FieldDef list in src/lib/pch/overrides.ts; this
// is presentation-only, no override logic depends on it.

export type Sa103sSubgroup = "Income" | "Allowable expenses" | "Capital allowances" | "Totals";

export type Sa103sUiEntry = {
  friendly: string;
  box: string;
  subgroup: Sa103sSubgroup;
};

export const SA103S_UI: Record<string, Sa103sUiEntry> = {
  "sa103s.box9_turnover":                    { friendly: "Turnover",                              box: "Box 9",    subgroup: "Income" },
  "sa103s.box12_carVanTravel":               { friendly: "Car, van and travel costs",             box: "Box 12",   subgroup: "Allowable expenses" },
  "sa103s.box14_rentRatesPowerInsurance":    { friendly: "Rent, rates, power, insurance",         box: "Box 14",   subgroup: "Allowable expenses" },
  "sa103s.box16_accountancyLegalProf":       { friendly: "Accountancy, legal, professional",      box: "Box 16",   subgroup: "Allowable expenses" },
  "sa103s.box17_interestBankCardCharges":    { friendly: "Interest, bank and card charges",       box: "Box 17",   subgroup: "Allowable expenses" },
  "sa103s.box18_phoneAndOfficeCosts":        { friendly: "Phone and office costs",                box: "Box 18",   subgroup: "Allowable expenses" },
  "sa103s.box19_otherAllowable":             { friendly: "Other allowable expenses",              box: "Box 19",   subgroup: "Allowable expenses" },
  "sa103s.box20_totalAllowable":             { friendly: "Total allowable expenses",              box: "Box 20",   subgroup: "Totals" },
  "sa103s.box21_netProfit":                  { friendly: "Net profit before capital allowances",  box: "Box 21",   subgroup: "Totals" },
  "sa103s.box24_1_zeroEmissionCarFya":       { friendly: "Zero-emission car FYA",                 box: "Box 24.1", subgroup: "Capital allowances" },
  "sa103s.box25_otherCapitalAllowances":     { friendly: "Other capital allowances",              box: "Box 25",   subgroup: "Capital allowances" },
  "sa103s.box26_balancingCharges":           { friendly: "Balancing charges",                     box: "Box 26",   subgroup: "Capital allowances" },
  "sa103s.box31_totalTaxableProfits":        { friendly: "Total taxable profit",                  box: "Box 31",   subgroup: "Totals" },
};

export const SA103S_SUBGROUP_ORDER: Sa103sSubgroup[] =
  ["Income", "Allowable expenses", "Capital allowances", "Totals"];
