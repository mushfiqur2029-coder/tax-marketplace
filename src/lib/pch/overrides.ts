// Overridable fields on the engine snapshot + the "effective display
// value" helper that overlays accountant overrides on top of the
// calculated figures.
//
// Append-only audit log: every change (apply or revert) is a new row
// in pch_overrides. The "current" value for a field is the newest row;
// if that row has new_value = null the field is un-overridden and the
// engine's calculated value shows.
//
// Phase 2b scope: SA103S filing boxes + the four most-material P&L /
// tax totals. P&L category subtotals are not in this list because the
// accountant usually edits the individual expense lines (which flows
// through the engine) rather than overriding the subtotal.

import type { TaxEngineOutput } from "@/lib/tax-engine";

export type OverrideScope = "money" | "taxableProfit" | "fixed";

export type FieldDef = {
  path: string;          // Dot path used in pch_overrides.field_path
  label: string;         // Human label shown in the UI
  group: "P&L" | "Tax & NIC" | "SA103S boxes";
  // Reads the engine's calculated value from the snapshot.
  read: (s: TaxEngineOutput) => number;
  // For the delta rule (reason required when |delta| > £500 OR > 10%).
  // Fixed-scope fields (whole-pound SA boxes) use a smaller abs
  // threshold so a £1 nudge still prompts for context.
  scope: OverrideScope;
};

export const PCH_OVERRIDE_FIELDS: readonly FieldDef[] = [
  // --- P&L / tax summary ---
  { path: "pl.capitalAllowances", label: "Capital allowances", group: "P&L",
    read: (s) => s.pl.capitalAllowances, scope: "money" },
  { path: "pl.taxableProfit", label: "Taxable profit", group: "P&L",
    read: (s) => s.pl.taxableProfit, scope: "taxableProfit" },
  { path: "tax.incomeTax", label: "Income tax", group: "Tax & NIC",
    read: (s) => s.tax.incomeTax, scope: "money" },
  { path: "tax.class4", label: "Class 4 NIC", group: "Tax & NIC",
    read: (s) => s.tax.class4, scope: "money" },

  // --- SA103S boxes (what gets copied into the filing software) ---
  { path: "sa103s.box9_turnover", label: "Box 9 Turnover", group: "SA103S boxes",
    read: (s) => s.sa103s.box9_turnover, scope: "fixed" },
  { path: "sa103s.box12_carVanTravel", label: "Box 12 Car, van and travel", group: "SA103S boxes",
    read: (s) => s.sa103s.box12_carVanTravel, scope: "fixed" },
  { path: "sa103s.box14_rentRatesPowerInsurance", label: "Box 14 Rent, rates, power, insurance", group: "SA103S boxes",
    read: (s) => s.sa103s.box14_rentRatesPowerInsurance, scope: "fixed" },
  { path: "sa103s.box16_accountancyLegalProf", label: "Box 16 Accountancy, legal, professional", group: "SA103S boxes",
    read: (s) => s.sa103s.box16_accountancyLegalProf, scope: "fixed" },
  { path: "sa103s.box17_interestBankCardCharges", label: "Box 17 Interest, bank, card charges", group: "SA103S boxes",
    read: (s) => s.sa103s.box17_interestBankCardCharges, scope: "fixed" },
  { path: "sa103s.box18_phoneAndOfficeCosts", label: "Box 18 Phone and office costs", group: "SA103S boxes",
    read: (s) => s.sa103s.box18_phoneAndOfficeCosts, scope: "fixed" },
  { path: "sa103s.box19_otherAllowable", label: "Box 19 Other allowable", group: "SA103S boxes",
    read: (s) => s.sa103s.box19_otherAllowable, scope: "fixed" },
  { path: "sa103s.box20_totalAllowable", label: "Box 20 Total allowable", group: "SA103S boxes",
    read: (s) => s.sa103s.box20_totalAllowable, scope: "fixed" },
  { path: "sa103s.box21_netProfit", label: "Box 21 Net profit", group: "SA103S boxes",
    read: (s) => s.sa103s.box21_netProfit, scope: "fixed" },
  { path: "sa103s.box24_1_zeroEmissionCarFya", label: "Box 24.1 Zero-emission car FYA", group: "SA103S boxes",
    read: (s) => s.sa103s.box24_1_zeroEmissionCarFya, scope: "fixed" },
  { path: "sa103s.box25_otherCapitalAllowances", label: "Box 25 Other capital allowances", group: "SA103S boxes",
    read: (s) => s.sa103s.box25_otherCapitalAllowances, scope: "fixed" },
  { path: "sa103s.box26_balancingCharges", label: "Box 26 Balancing charges", group: "SA103S boxes",
    read: (s) => s.sa103s.box26_balancingCharges, scope: "fixed" },
  { path: "sa103s.box31_totalTaxableProfits", label: "Box 31 Total taxable profits", group: "SA103S boxes",
    read: (s) => s.sa103s.box31_totalTaxableProfits, scope: "fixed" },
];

// Quick lookup by field path (useful on the server when applying an
// override to validate the path is one we allow).
export const PCH_OVERRIDE_FIELD_BY_PATH: Record<string, FieldDef> =
  Object.fromEntries(PCH_OVERRIDE_FIELDS.map((f) => [f.path, f]));

// Delta rule: when is a reason required?
//   - fixed-scope (whole-pound SA boxes): any non-trivial change
//   - taxableProfit (biggest-impact field): any change
//   - money: £500 abs OR 10% rel
// Returns true when a reason is MANDATORY for this delta.
export function reasonRequired(
  oldValue: number,
  newValue: number,
  scope: OverrideScope,
): boolean {
  const abs = Math.abs(newValue - oldValue);
  if (abs < 0.005) return false; // No meaningful change
  if (scope === "taxableProfit") return true;
  if (scope === "fixed") return abs >= 1;
  // money
  if (abs >= 500) return true;
  if (oldValue !== 0 && abs / Math.abs(oldValue) >= 0.1) return true;
  return false;
}

// ------------------------------------------------------------------
// Current overrides (one per field_path) built from the full history.
// ------------------------------------------------------------------

export type OverrideRow = {
  id: string;
  field_path: string;
  old_value: string | null;
  new_value: string | null;
  reason: string | null;
  overridden_by: string | null;
  overridden_at: string;
};

// Fold the full chronological history into a per-field "current state".
// Current value = the newest row. If its new_value is null (revert row)
// the field is un-overridden.
export function currentOverrides(
  history: OverrideRow[],
): Map<string, { value: number; reason: string | null; at: string }> {
  // Newest-first per field_path; we trust the caller to sort DESC by
  // overridden_at, but defensively sort here too.
  const sorted = [...history].sort(
    (a, b) => b.overridden_at.localeCompare(a.overridden_at),
  );
  const current = new Map<string, { value: number; reason: string | null; at: string }>();
  const seen = new Set<string>();
  for (const row of sorted) {
    if (seen.has(row.field_path)) continue;
    seen.add(row.field_path);
    if (row.new_value === null) continue; // Reverted
    const v = Number(row.new_value);
    if (Number.isNaN(v)) continue;
    current.set(row.field_path, { value: v, reason: row.reason, at: row.overridden_at });
  }
  return current;
}

// Apply current overrides onto the snapshot and return the
// "effective display value" for each overridable field. The raw
// snapshot is left untouched; the UI reads from this map when
// rendering override-aware figures.
export function effectiveValues(
  snapshot: TaxEngineOutput,
  history: OverrideRow[],
): Map<string, { value: number; isOverride: boolean; calculated: number }> {
  const current = currentOverrides(history);
  const out = new Map<string, { value: number; isOverride: boolean; calculated: number }>();
  for (const field of PCH_OVERRIDE_FIELDS) {
    const calc = field.read(snapshot);
    const override = current.get(field.path);
    out.set(field.path, override
      ? { value: override.value, isOverride: true, calculated: calc }
      : { value: calc, isOverride: false, calculated: calc });
  }
  return out;
}
