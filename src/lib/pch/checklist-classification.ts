// Phase 7 Slice 7.4: static classification map for the 33-point
// accountant review checklist.
//
// Hardcoded TS rather than a DB column so adding a new row is a
// migration + code change (schema-driven stays in sync with the engine)
// and the shape never drifts. The 33 items are stable; if that changes
// we re-visit.
//
// kind decides how the CheckRow in the accountant workspace renders:
//
//   auto      derivable from existing captured data (bank categoriser,
//             vehicle interview, Photo ID extraction, prior-year
//             engine snapshot, current engine snapshot). The row shows
//             the derived verdict + evidence string + a one-click
//             Confirm button; the manual Done / N/A / Reset buttons
//             stay available as an escape hatch.
//
//   interview answerable by the client, not something the accountant
//             should have to tick blindly. Row shows a "Collect from
//             client" badge; once the matching interview flow has
//             captured an answer (Slice 7.6), the client's text shows
//             above a Confirm button.
//
//   manual    genuine accountant judgement, HMRC-side knowledge, or a
//             post-filing deliverable step. Row renders the original
//             Done / N/A / Reset tri-state unchanged.
//
// source + interview are presentation-only hints so Slice 7.5 can keep
// the derivation code colocated and the UI can label the badge
// consistently per cluster.

export type ChecklistKind = "auto" | "interview" | "manual";

export type ChecklistSource =
  | "head"              // pch_cases head columns (identity, POA, approval)
  | "income_lines"      // aggregated pch_income_lines
  | "expense_lines"     // pch_expense_lines (evidence coverage etc.)
  | "bank_txns"         // raw pch_bank_transactions (date range, penalty scan)
  | "vehicle"           // pch_vehicle (business %, CO2, WDV, method)
  | "prior_year"        // prior-year pch_cases.engine_snapshot
  | "engine"            // current pch_cases.engine_snapshot
  | "sa302_comparison"  // pch_cases.sa302_comparison blob
  | null;               // for kind !== 'auto'

export type ChecklistInterview =
  | "INCOME_PROBE"      // item 5 (nil platforms)
  | "EXPENSES_PROBE"    // items 11 + 27 (often-missed costs, estimate workings)
  | "VEHICLE_CA_EXT"    // item 16 (vehicle disposal; extends VEHICLE_CA)
  | "RELIEFS"           // item 19 (pension, Gift Aid, Marriage Allowance)
  | "FILING_DETAILS"    // item 31 (repayment account name)
  | null;               // for kind !== 'interview'

export type ChecklistClassificationEntry = {
  kind: ChecklistKind;
  source: ChecklistSource;
  interview: ChecklistInterview;
};

// Order mirrors the pch_check_items.item_number key so the Record lookup
// stays O(1) at render time. Every item from 1..33 must have an entry;
// a sanity assert at module load catches typos.
export const CHECKLIST_CLASSIFICATION: Record<number, ChecklistClassificationEntry> = {
  // Identity
  1:  { kind: "auto",      source: "head",             interview: null },
  2:  { kind: "manual",    source: null,               interview: null },

  // Income
  3:  { kind: "auto",      source: "income_lines",     interview: null },
  // Item 4 is marked manual because HMRC-side digital platform reporting
  // is not accessible from the app; the accountant cross-checks via the
  // Agent Services Account outside this surface.
  4:  { kind: "manual",    source: null,               interview: null },
  5:  { kind: "interview", source: null,               interview: "INCOME_PROBE" },
  6:  { kind: "auto",      source: "income_lines",     interview: null },
  7:  { kind: "auto",      source: "income_lines",     interview: null },

  // Expenses
  8:  { kind: "auto",      source: "expense_lines",    interview: null },
  9:  { kind: "auto",      source: "bank_txns",        interview: null },
  10: { kind: "auto",      source: "bank_txns",        interview: null },
  11: { kind: "interview", source: null,               interview: "EXPENSES_PROBE" },

  // Car
  12: { kind: "auto",      source: "vehicle",          interview: null },
  13: { kind: "auto",      source: "vehicle",          interview: null },
  14: { kind: "auto",      source: "prior_year",       interview: null },
  15: { kind: "auto",      source: "vehicle",          interview: null },
  16: { kind: "interview", source: null,               interview: "VEHICLE_CA_EXT" },

  // Review
  17: { kind: "auto",      source: "prior_year",       interview: null },
  18: { kind: "manual",    source: null,               interview: null },

  // Reliefs
  19: { kind: "interview", source: null,               interview: "RELIEFS" },
  20: { kind: "manual",    source: null,               interview: null },
  21: { kind: "manual",    source: null,               interview: null },

  // VAT
  22: { kind: "auto",      source: "engine",           interview: null },

  // MTD
  23: { kind: "auto",      source: "engine",           interview: null },
  24: { kind: "auto",      source: "engine",           interview: null },

  // POA
  25: { kind: "auto",      source: "head",             interview: null },
  26: { kind: "auto",      source: "head",             interview: null },

  // Evidence
  27: { kind: "interview", source: null,               interview: "EXPENSES_PROBE" },

  // Approval
  28: { kind: "auto",      source: "head",             interview: null },

  // Return
  29: { kind: "auto",      source: "sa302_comparison", interview: null },
  30: { kind: "auto",      source: "engine",           interview: null },
  31: { kind: "interview", source: null,               interview: "FILING_DETAILS" },

  // Deliver
  32: { kind: "manual",    source: null,               interview: null },
  33: { kind: "manual",    source: null,               interview: null },
};

// Sanity check at module load: every item_number 1..33 must be mapped
// and no stray keys outside that range. Prevents a copy-paste typo from
// silently rendering a row with a "manual" fallback kind.
(() => {
  for (let n = 1; n <= 33; n++) {
    if (!CHECKLIST_CLASSIFICATION[n]) {
      throw new Error(`CHECKLIST_CLASSIFICATION missing entry for item ${n}`);
    }
  }
  const extra = Object.keys(CHECKLIST_CLASSIFICATION)
    .map(Number)
    .filter((n) => n < 1 || n > 33);
  if (extra.length > 0) {
    throw new Error(`CHECKLIST_CLASSIFICATION has stray keys: ${extra.join(", ")}`);
  }
})();

// Convenience accessor used by the view + derivation code. Falls back
// to manual on an unknown item so a mid-refactor missing entry is
// visible but non-fatal.
export function classifyChecklistItem(itemNumber: number): ChecklistClassificationEntry {
  return CHECKLIST_CLASSIFICATION[itemNumber] ?? { kind: "manual", source: null, interview: null };
}
