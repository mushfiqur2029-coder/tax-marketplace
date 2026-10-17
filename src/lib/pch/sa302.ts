// Catalogue of fields on the SA302 reconciliation screen (phase 2b).
//
// Two groups:
//   1. SA103S boxes — what the accountant copies INTO the filing
//      software (box 9 Turnover, box 12 Car/Van/Travel, etc.). These
//      come from the engine's sa103s output and are already rounded
//      to whole pounds per HMRC convention.
//   2. SA302 totals — what the filing software CALCULATES and prints
//      on the SA302 PDF (self-employment profit, income tax, Class 4,
//      balancing payment, POA each). These let the accountant verify
//      the software's maths matches the engine's.
//
// Mirrors tab 8's layout exactly: left column = engine, right column
// = software, diff column = software - engine. "Match" = diff within
// tolerance (1 for whole-pound SA103S boxes; 0.01 for decimal totals).

import type { TaxEngineOutput } from "@/lib/tax-engine";

export type Sa302Group = "SA103S boxes" | "SA302 totals";
export type Sa302Scope = "wholePound" | "decimal";

export type Sa302Field = {
  key: string;                            // jsonb key in sa302_comparison
  label: string;
  group: Sa302Group;
  scope: Sa302Scope;                      // match tolerance
  read: (s: TaxEngineOutput) => number;   // engine's calculated value
};

export const SA302_COMPARE_FIELDS: readonly Sa302Field[] = [
  // --- SA103S boxes (entered into the filing software) ---
  { key: "box9_turnover", label: "Box 9 Turnover", group: "SA103S boxes",
    scope: "wholePound", read: (s) => s.sa103s.box9_turnover },
  { key: "box12_carVanTravel", label: "Box 12 Car, van and travel",
    group: "SA103S boxes", scope: "wholePound", read: (s) => s.sa103s.box12_carVanTravel },
  { key: "box14_rentRatesPowerInsurance", label: "Box 14 Rent, rates, power, insurance",
    group: "SA103S boxes", scope: "wholePound", read: (s) => s.sa103s.box14_rentRatesPowerInsurance },
  { key: "box16_accountancyLegalProf", label: "Box 16 Accountancy, legal, professional",
    group: "SA103S boxes", scope: "wholePound", read: (s) => s.sa103s.box16_accountancyLegalProf },
  { key: "box17_interestBankCardCharges", label: "Box 17 Interest, bank, card charges",
    group: "SA103S boxes", scope: "wholePound", read: (s) => s.sa103s.box17_interestBankCardCharges },
  { key: "box18_phoneAndOfficeCosts", label: "Box 18 Phone and office costs",
    group: "SA103S boxes", scope: "wholePound", read: (s) => s.sa103s.box18_phoneAndOfficeCosts },
  { key: "box19_otherAllowable", label: "Box 19 Other allowable",
    group: "SA103S boxes", scope: "wholePound", read: (s) => s.sa103s.box19_otherAllowable },
  { key: "box20_totalAllowable", label: "Box 20 Total allowable",
    group: "SA103S boxes", scope: "wholePound", read: (s) => s.sa103s.box20_totalAllowable },
  { key: "box21_netProfit", label: "Box 21 Net profit",
    group: "SA103S boxes", scope: "wholePound", read: (s) => s.sa103s.box21_netProfit },
  { key: "box24_1_zeroEmissionCarFya", label: "Box 24.1 Zero-emission car FYA",
    group: "SA103S boxes", scope: "wholePound", read: (s) => s.sa103s.box24_1_zeroEmissionCarFya },
  { key: "box25_otherCapitalAllowances", label: "Box 25 Other capital allowances",
    group: "SA103S boxes", scope: "wholePound", read: (s) => s.sa103s.box25_otherCapitalAllowances },
  { key: "box26_balancingCharges", label: "Box 26 Balancing charges",
    group: "SA103S boxes", scope: "wholePound", read: (s) => s.sa103s.box26_balancingCharges },
  { key: "box31_totalTaxableProfits", label: "Box 31 Total taxable profits",
    group: "SA103S boxes", scope: "wholePound", read: (s) => s.sa103s.box31_totalTaxableProfits },

  // --- SA302 totals (printed by the software, not entered) ---
  { key: "sa302_self_employment_profit", label: "Profit from self-employment",
    group: "SA302 totals", scope: "decimal", read: (s) => s.tax.selfEmploymentProfit },
  { key: "sa302_income_tax", label: "Income tax due",
    group: "SA302 totals", scope: "decimal", read: (s) => s.tax.incomeTax },
  { key: "sa302_class4", label: "Class 4 NIC",
    group: "SA302 totals", scope: "decimal", read: (s) => s.tax.class4 },
  { key: "sa302_balancing_payment", label: "Balancing payment (31 Jan)",
    group: "SA302 totals", scope: "decimal", read: (s) => s.tax.balancingPayment },
  { key: "sa302_poa_each", label: "Payment on account (each)",
    group: "SA302 totals", scope: "decimal", read: (s) => s.tax.poaForNextYear },
];

export const SA302_FIELD_BY_KEY: Record<string, Sa302Field> =
  Object.fromEntries(SA302_COMPARE_FIELDS.map((f) => [f.key, f]));

// Diff logic from tab 8 column F: diff = software - engine. "Match"
// uses the field's scope: whole-pound boxes allow a £1 rounding
// tolerance (HMRC rounds down income + up for expenses), decimal
// totals use a 1p tolerance.
export function diffStatus(
  engine: number,
  software: number | null,
  scope: Sa302Scope,
): { diff: number | null; match: boolean | null } {
  if (software === null || !Number.isFinite(software)) {
    return { diff: null, match: null };
  }
  const diff = software - engine;
  const tolerance = scope === "wholePound" ? 1 : 0.01;
  return { diff, match: Math.abs(diff) < tolerance };
}

// Raw blob stored in pch_cases.sa302_comparison. All fields optional.
export type Sa302Comparison = {
  [key: string]: number | null | string | undefined;
  recorded_at?: string;
  recorded_by?: string;
};
