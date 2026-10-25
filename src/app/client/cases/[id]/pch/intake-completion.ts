// Shared completion logic for the PCH intake. Pure functions so the
// same six checks drive:
//   - the amber/green badges on the progress bar above Section 1
//   - the amber/green status pill on each of the 12 declaration cards
//   - the enabled/disabled state of the "Submit for accountant review"
//     button (and its "N sections still need attention: ..." caption)
//
// Any new mandatory field goes here, not in a per-section check, so
// the progress bar and the submit gate never disagree.

import type { Section1InitialHead } from "./section-1-identity";
import type { IncomeLine } from "./section-2-income";
import type { ExpenseLine } from "./section-3-expenses";
import type { VehicleInitial } from "./section-3-vehicle";
import type { DeclarationsInitial } from "./section-4-14-declarations";
import type { Section15Initial } from "./section-15-last-year-sa";
import { REQUIRED_DECLARATION_KEYS } from "@/lib/pch/validation";

export type LicenceSide = { photo_id_side: "front" | "back" | null };

export const INTAKE_SECTION_KEYS = [
  "identity",
  "income",
  "expenses",
  "vehicle",
  "declarations",
  "lastYearSa",
] as const;
export type IntakeSectionKey = (typeof INTAKE_SECTION_KEYS)[number];

export const INTAKE_SECTION_LABELS: Record<IntakeSectionKey, string> = {
  identity: "Identity",
  income: "Income",
  expenses: "Expenses",
  vehicle: "Vehicle",
  declarations: "Declarations",
  lastYearSa: "Last year SA",
};

// DOM anchor ids each section mounts on its root element. Chips in
// the progress bar use these to scrollIntoView; the Submit button uses
// INTAKE_PROGRESS_ANCHOR_ID from ./intake-progress to scroll BACK.
export const INTAKE_SECTION_ANCHOR_IDS: Record<IntakeSectionKey, string> = {
  identity: "pch-section-identity",
  income: "pch-section-income",
  expenses: "pch-section-expenses",
  vehicle: "pch-section-vehicle",
  declarations: "pch-section-declarations",
  lastYearSa: "pch-section-last-year-sa",
};

export type IntakeCompletion = Record<IntakeSectionKey, boolean>;

function nonEmpty(v: string | null | undefined): boolean {
  return !!(v && v.trim().length > 0);
}

export function isIdentityComplete(
  h: Section1InitialHead,
  docs: readonly LicenceSide[],
): boolean {
  const base =
    nonEmpty(h.cl_name)
    && nonEmpty(h.cl_dob)
    && nonEmpty(h.cl_address)
    && nonEmpty(h.cl_postcode)
    && nonEmpty(h.cl_phone)
    && nonEmpty(h.cl_email)
    && nonEmpty(h.cl_utr)
    && nonEmpty(h.cl_nino);
  const hasFront = docs.some((d) => d.photo_id_side === "front");
  const hasBack = docs.some((d) => d.photo_id_side === "back");
  return base && hasFront && hasBack;
}

export function isIncomeComplete(lines: readonly IncomeLine[]): boolean {
  return lines.some((l) => (l.gross_takings_pence ?? 0) > 0);
}

// Phase M: Accountancy Fees is prefilled with the case fee on page
// load, so a bare "any line > 0" check would mark the Expenses chip
// green before the client has touched anything in the section. Only
// client-entered amounts (i.e. anything other than Accountancy Fees)
// count toward completion.
export function isExpensesComplete(lines: readonly ExpenseLine[]): boolean {
  return lines.some(
    (l) => l.label !== "Accountancy Fees" && (l.amount_paid_pence ?? 0) > 0,
  );
}

// Phase G: private-use is a single money field now. We treat
// private-use as "answered" whenever vehicle completion is checked;
// zero/blank = not applicable, no explicit toggle needed.
export function isVehicleComplete(v: VehicleInitial): boolean {
  const status = (v.status ?? "").trim();
  if (!status) return false;
  if (status === "No vehicle") return true;
  const basics =
    nonEmpty(v.fuel)
    && nonEmpty(v.previous_method)
    && v.bought_this_year !== null
    && (v.odo_start ?? 0) > 0
    && (v.odo_end ?? 0) > 0;
  if (!basics) return false;
  if (v.bought_this_year === true) {
    const bought =
      (v.purchase_price_pence ?? 0) > 0
      && nonEmpty(v.registration)
      && nonEmpty(v.make_model)
      && (v.new_or_used === "New" || v.new_or_used === "Used");
    if (!bought) return false;
  }
  if (v.previous_method === "Actual costs (capital allowances claimed)") {
    if ((v.wdv_brought_forward_pence ?? 0) <= 0) return false;
  }
  return true;
}

export function areDeclarationsComplete(
  statuses: DeclarationsInitial["statuses"],
): boolean {
  return REQUIRED_DECLARATION_KEYS.every((k) => {
    const v = statuses[k as keyof DeclarationsInitial["statuses"]];
    return v === "applicable" || v === "not_applicable";
  });
}

export function isSection15Complete(s: Section15Initial): boolean {
  return (
    s.last_year_sa_status === "yes"
    || s.last_year_sa_status === "no"
    || s.last_year_sa_status === "not_applicable"
  );
}

export function emptyCompletion(): IntakeCompletion {
  return {
    identity: false,
    income: false,
    expenses: false,
    vehicle: false,
    declarations: false,
    lastYearSa: false,
  };
}

export function pendingKeys(c: IntakeCompletion): IntakeSectionKey[] {
  return INTAKE_SECTION_KEYS.filter((k) => !c[k]);
}
