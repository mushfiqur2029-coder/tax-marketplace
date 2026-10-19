// Per-slot mapping of extracted field keys to intake-table columns.
// The review UI reads this registry to render friendly field labels;
// applyPchExtractionAction reads it to write accepted values into the
// right pch_cases / pch_income_lines / pch_expense_lines / pch_vehicle
// row. New slot? Add an entry here; no UI code change required.
//
// NEVER WRITES AUTOMATICALLY. applyPchExtractionAction runs only when
// the client clicks "Apply confirmed fields" in the review UI, and
// only writes fields whose per-field status is 'accepted' or 'edited'.

export type ApplyTarget =
  | { table: "pch_cases"; column: string; transform?: ValueTransform }
  | { table: "pch_vehicle"; column: string; transform?: ValueTransform }
  | { table: "pch_income_lines"; row: "primary_platform" | "cash" | "weekly"; column: string; transform?: ValueTransform }
  | { table: "pch_expense_lines"; row: string; column: string; transform?: ValueTransform }
  // "none" means the extracted field is informational only (e.g.
  // sanity-check totals, document type) and never writes anywhere.
  | { table: "none" };

type ValueTransform = "pounds_to_pence" | "integer" | "yes_no_boolean";

export type SlotApplyMap = {
  // Human label used in the client review UI. Falls back to the raw
  // field key when absent, so the mapping stays optional for a new
  // slot in development.
  label: Partial<Record<string, string>>;
  // Where each extracted field key should land.
  targets: Record<string, ApplyTarget>;
};

export const SLOT_APPLY_MAPS: Record<string, SlotApplyMap> = {
  // Phase 6 Slice 7: only PCH-24 (Photo ID) survives. PCH-01..22 were
  // the slot-by-slot document extractions from Phase 3; the Phase 6
  // bookkeeping-first flow collapses income + expenses + vehicle
  // capture into the bank-statement pipeline + Vehicle_CA chat, so
  // their apply maps are deleted along with the SLOT_DEFINITIONS they
  // used to pair with.
  "PCH-24": {
    label: {
      documentNumber: "ID document number",
      fullName: "Full name",
      dateOfBirth: "Date of birth",
      address: "Address",
      postcode: "Postcode",
    },
    targets: {
      // documentNumber is kept for the audit trail only (we never need
      // to re-print it; passport/licence numbers are PII we shouldn't
      // store in a header column).
      documentNumber: { table: "none" },
      fullName: { table: "pch_cases", column: "cl_name" },
      dateOfBirth: { table: "pch_cases", column: "cl_dob" },
      address: { table: "pch_cases", column: "cl_address" },
      postcode: { table: "pch_cases", column: "cl_postcode" },
    },
  },
};

// Transforms applied just before the DB write.
export function coerceValueForTarget(value: unknown, transform: ValueTransform | undefined): unknown {
  if (value === null || value === undefined || value === "") return null;
  if (!transform) return value;
  switch (transform) {
    case "pounds_to_pence": {
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      return Math.round(n * 100);
    }
    case "integer": {
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      return Math.round(n);
    }
    case "yes_no_boolean": {
      const s = String(value).toLowerCase();
      return s === "yes" || s === "true";
    }
  }
}
