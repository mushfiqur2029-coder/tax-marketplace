// Shared validators for the PCH automated intake. Pure functions so
// they can be imported by:
//   - the client workspace (immediate per-field feedback as the user
//     types, and a readiness panel above Run draft)
//   - the server actions (authoritative gate; the client can never
//     tell the server "trust me, it's valid")
//
// Every validator returns `null` for OK or a short human string for
// FAIL. Multi-field forms return an error map keyed by field name.
//
// Form-level readiness checks return a { ok, blockers } object; the
// UI renders the blockers as a bullet list above the Run draft or
// Request filing button.
//
// None of this talks to the DB. The server actions wrap these with
// their own ownership + role guards (which are DB-dependent).

// ------------------------------------------------------------------
// Field validators
// ------------------------------------------------------------------

// UK Unique Taxpayer Reference: exactly 10 digits, no spaces, no
// leading K. HMRC renders it with a trailing K for payment refs but
// the UTR itself is purely numeric.
export function validateUtr(v: string): string | null {
  const s = v.trim();
  if (!s) return null; // blank is OK, required-ness is checked elsewhere
  if (!/^\d{10}$/.test(s)) return "UTR is 10 digits.";
  return null;
}

// NINO: 2 letters + 6 digits + 1 letter (A-D). Prefix letters have
// their own exclusion list to avoid HMRC's reserved prefixes.
const NINO_RE = /^[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\d{6}[A-D]$/i;
export function validateNino(v: string): string | null {
  const s = v.replace(/\s+/g, "").toUpperCase();
  if (!s) return null;
  if (!NINO_RE.test(s)) return "NI Number format looks wrong.";
  return null;
}

// UK postcode. Permissive on spacing (both "N1 1AA" and "N11AA" OK)
// but strict on the shape; matches HMRC's own postcode-is-UK regex.
const POSTCODE_RE =
  /^(GIR 0AA|[A-PR-UWYZ]([0-9]{1,2}|([A-HK-Y][0-9]([0-9]|[ABEHMNPRV-Y]))|[0-9][A-HJKPS-UW]) ?[0-9][ABD-HJLNP-UW-Z]{2})$/i;
export function validatePostcode(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  if (!POSTCODE_RE.test(s)) return "UK postcode format looks wrong.";
  return null;
}

export function validateBusinessPct(v: number | null | undefined): string | null {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  if (v < 0 || v > 1) return "Must be between 0 and 100%.";
  return null;
}

export function validateCo2(v: number | null | undefined): string | null {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  if (v < 0) return "CO2 can't be negative.";
  if (v > 500) return "CO2 looks too high (max 500 g/km).";
  return null;
}

// Date-in-past check. Returns null if blank or in the past; error if
// strictly in the future. Used for things like DOB and start-driving
// date where a future value is nonsense.
export function validateDateNotInFuture(v: string | null | undefined, label = "Date"): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return `${label} not a valid date.`;
  if (d.getTime() > Date.now()) return `${label} is in the future.`;
  return null;
}

// Start/stop ordering. Both optional; only enforce when both present.
export function validateStartStop(
  start: string | null | undefined,
  stop: string | null | undefined,
): string | null {
  if (!start || !stop) return null;
  const a = new Date(start).getTime();
  const b = new Date(stop).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  if (a > b) return "Start date is after the stop date.";
  return null;
}

// Business miles can't exceed total miles. Only enforced when both
// odometer readings are present.
export function validateMilesConsistency(
  odoStart: number | null | undefined,
  odoEnd: number | null | undefined,
  onTripMiles: number,
  deadMiles: number,
  otherBusinessMiles: number,
): string | null {
  if (odoStart == null || odoEnd == null) return null;
  const total = Math.max(0, odoEnd - odoStart);
  if (total === 0) return null;
  const business = onTripMiles + deadMiles + otherBusinessMiles;
  if (business > total) {
    return `Business miles (${business.toLocaleString()}) exceed total odometer miles (${total.toLocaleString()}).`;
  }
  return null;
}

// ------------------------------------------------------------------
// Form-level checks (client intake tabs)
// ------------------------------------------------------------------

export type ClientTabShape = {
  cl_utr?: string | null;
  cl_nino?: string | null;
  cl_postcode?: string | null;
  cl_dob?: string | null;
  cl_start_date?: string | null;
  cl_stop_date?: string | null;
};

export function validateClientTab(h: ClientTabShape): Record<string, string> {
  const errs: Record<string, string> = {};
  const push = (k: string, m: string | null) => { if (m) errs[k] = m; };
  push("cl_utr", validateUtr(h.cl_utr ?? ""));
  push("cl_nino", validateNino(h.cl_nino ?? ""));
  push("cl_postcode", validatePostcode(h.cl_postcode ?? ""));
  push("cl_dob", validateDateNotInFuture(h.cl_dob ?? null, "Date of birth"));
  push("cl_start_date", validateDateNotInFuture(h.cl_start_date ?? null, "Start date"));
  const startStop = validateStartStop(h.cl_start_date ?? null, h.cl_stop_date ?? null);
  if (startStop) errs.cl_stop_date = startStop;
  return errs;
}

export type VehicleShape = {
  // Phase 6 Slice 4 writes this via the VEHICLE_CA interview; one of
  // "Owned outright" | "Hire purchase" | "PCP" | "Loan" | "Leased" |
  // "Rented" | "No vehicle" or null if the chat hasn't been run yet.
  status?: string | null;
  odo_start?: number | null;
  odo_end?: number | null;
  co2_gpkm?: number | null;
  business_pct_override?: number | null;
  phone_business_pct?: number | null;
  method_choice?: string | null;
  bought_this_year?: boolean | null;
  purchase_date?: string | null;
};

export function validateVehicle(
  v: VehicleShape,
  onTripMiles: number,
  deadMiles: number,
  otherBusinessMiles: number,
): Record<string, string> {
  const errs: Record<string, string> = {};
  const push = (k: string, m: string | null) => { if (m) errs[k] = m; };
  push("co2_gpkm", validateCo2(v.co2_gpkm ?? null));
  push("business_pct_override", validateBusinessPct(v.business_pct_override ?? null));
  push("phone_business_pct", validateBusinessPct(v.phone_business_pct ?? null));
  push("purchase_date", validateDateNotInFuture(v.purchase_date ?? null, "Purchase date"));
  const miles = validateMilesConsistency(
    v.odo_start ?? null, v.odo_end ?? null,
    onTripMiles, deadMiles, otherBusinessMiles,
  );
  if (miles) errs.odo_end = miles;
  return errs;
}

// ------------------------------------------------------------------
// Readiness checks (block the big-button actions)
// ------------------------------------------------------------------

export type IncomeLineShape = { grossTakings: number; type: "Fares" | "Other" | "VAT" };
export type ExpenseLineShape = { amountPaid: number; evidence: string | null };

export type Readiness = { ok: boolean; blockers: string[] };

// Twelve explicit answers required before submit (sections 4-14 plus
// the new 'other_employment' card added in Phase F). Mirrors
// DECLARATION_KEYS in src/app/client/pch/intake-actions.ts; keep in
// step.
export const REQUIRED_DECLARATION_KEYS: readonly string[] = [
  "p11d",
  "interest",
  "dividend",
  "capital_gains",
  "rental",
  "pension",
  "gift_aid",
  "child_benefit",
  "overseas",
  "student_loan",
  "anything_else",
  "other_employment",
];

export type IntakeReadinessExtras = {
  expenses?: readonly ExpenseLineShape[];
  // Shape: { p11d: 'applicable' | 'not_applicable', ... }. Missing key
  // = unanswered; present key = client has decided.
  declarationStatuses?: Partial<Record<string, string>> | null;
};

// Vehicle statuses that put the car into the capital-allowances pool.
// Only these four need a business-use % or mileage figure for the engine
// to work out the deduction. Any other status (including Leased, Rented,
// No vehicle, or null/empty from a case that hasn't engaged with the
// Vehicle section at all) means "no CA to compute, no gate".
//
// Kept in sync with isCaEligibleStatus in ai-interview-slots.ts and
// with compute.ts's caEligible set.
const VEHICLE_CA_ELIGIBLE_STATUSES = new Set(["Owned outright", "Hire purchase", "PCP", "Loan"]);

// Can the engine be run? Needs at least one income line with a positive
// gross figure, at least one expense line (sections 2 and 3 are both
// mandatory in Phase F), every declaration card explicitly answered
// (applicable or not_applicable), and - only when the client has
// declared a CA-eligible vehicle status - a business-use % or mileage
// figure the engine can apply.
//
// The extras bag is optional for backward compatibility with existing
// callers / tests that still pass just (income, vehicle); the newer
// per-section checks only fire when the matching slice is passed in.
export function canRunDraft(
  income: readonly IncomeLineShape[],
  vehicle: VehicleShape | null,
  extras?: IntakeReadinessExtras,
): Readiness {
  const blockers: string[] = [];
  const positiveIncome = income.some((l) => l.grossTakings > 0);
  if (!positiveIncome) {
    blockers.push(
      "No income yet. Open Section 2 (Income) above and enter the yearly totals for each platform you worked on. Round figures are fine.",
    );
  }
  if (extras?.expenses !== undefined) {
    const positiveExpense = extras.expenses.some((e) => e.amountPaid > 0);
    if (!positiveExpense) {
      blockers.push(
        "No expenses yet. Open Section 3 (Expenses) above and enter at least one yearly total; even the prefilled Accountancy Fees row counts.",
      );
    }
  }
  if (extras?.declarationStatuses !== undefined) {
    const statuses = extras.declarationStatuses ?? {};
    const unanswered = REQUIRED_DECLARATION_KEYS.filter((k) => {
      const v = statuses[k];
      return v !== "applicable" && v !== "not_applicable";
    });
    if (unanswered.length > 0) {
      const n = unanswered.length;
      blockers.push(
        `${n} declaration card${n === 1 ? "" : "s"} in sections 4-14 ${n === 1 ? "hasn't" : "haven't"} been answered yet. Pick Applicable or Not applicable on each one before submitting.`,
      );
    }
  }
  // Positive check: only block when the client has explicitly declared
  // a CA-eligible status (owned, HP, PCP, loan). Anything else, including
  // null/empty/missing-row from a case that hasn't engaged with Vehicle
  // at all, short-circuits as "no CA to compute, no gate". The prior
  // negative check (exclude {Leased, Rented, No vehicle}) was flipping
  // on anything OUTSIDE those three, including null, which was blocking
  // legitimate no-vehicle cases where the server-side call forgot to
  // forward the status field.
  const vehicleStatus = (vehicle?.status ?? "").trim();
  if (VEHICLE_CA_ELIGIBLE_STATUSES.has(vehicleStatus)) {
    const hasMileage = (vehicle?.odo_start ?? 0) > 0 && (vehicle?.odo_end ?? 0) > (vehicle?.odo_start ?? 0);
    const hasMethod = (vehicle?.method_choice ?? "").length > 0;
    const hasPctOverride = (vehicle?.business_pct_override ?? 0) > 0;
    if (!hasMileage && !hasMethod && !hasPctOverride) {
      blockers.push(
        "You said you own or finance the car, so Section 3's Vehicle subsection needs odometer readings (start and end) or a business-use percentage before we can work out capital allowances.",
      );
    }
  }
  return { ok: blockers.length === 0, blockers };
}

// Can the accountant push the case to client approval? Beyond the
// 33-check completion (enforced in requestClientFilingAction), every
// allowable expense must have evidence recorded. Mirrors the Est_Flag
// convention from tab 3.
export function canRequestFiling(expenses: readonly ExpenseLineShape[]): Readiness {
  const blockers: string[] = [];
  const missingEvidence = expenses.filter(
    (e) => e.amountPaid > 0 && !(e.evidence && e.evidence.trim().length > 0),
  );
  if (missingEvidence.length > 0) {
    const n = missingEvidence.length;
    blockers.push(
      `${n} expense line${n === 1 ? "" : "s"} ` +
      `${n === 1 ? "has" : "have"} no evidence recorded. Enter a method code ` +
      `(receipts, bank statement, estimate E2, etc.) on each before filing.`,
    );
  }
  return { ok: blockers.length === 0, blockers };
}

// ------------------------------------------------------------------
// Expense category / SA103S box consistency hint (non-blocking)
// ------------------------------------------------------------------

const CATEGORY_TO_TYPICAL_BOX: Record<string, number> = {
  "Vehicle running costs": 12,
  "Vehicle hire, lease & finance": 12,
  "Congestion, ULEZ, tolls & parking": 12,
  "Licences & compliance": 19,
  "Phone & technology": 18,
  "Platform & card fees": 19,
  "Finance & bank charges": 17,
  "Accountancy & insurance": 16,
  "Other expenses": 19,
  "VAT paid (Flat Rate Scheme)": 19,
};

// Returns a warning message if the category's typical SA103S box
// doesn't match the one selected. Non-blocking; just a nudge.
export function warnBoxMismatch(category: string, selectedBox: number): string | null {
  const typical = CATEGORY_TO_TYPICAL_BOX[category];
  if (typical === undefined) return null;
  if (typical === selectedBox) return null;
  return `This category usually goes in SA103S box ${typical}; you picked ${selectedBox}.`;
}
