// VAT return cycle: pure helpers.
//
// Date math + schema + copy helpers for the recurring VAT return
// cycles that live under vat_reg limited-company cases. All functions
// here are side-effect-free so the server actions and UI can share
// them without a server round trip.

import type { ChecklistField } from "@/lib/engagement/checklist";

// Section D's "VAT return frequency" field (vat_reg only). Stored in
// intake_answers as the raw string label. See
// src/lib/engagement/checklist.ts → vat_return_frequency.
export type VatFrequency = "Monthly" | "Quarterly" | "Annually";

export function getVatFrequency(
  intakeAnswers: Record<string, string> | null | undefined,
): VatFrequency | null {
  const raw = intakeAnswers?.["vat_return_frequency"];
  if (raw === "Monthly" || raw === "Quarterly" || raw === "Annually") {
    return raw;
  }
  return null;
}

// Reads the client's 9-digit VAT Registration Number from Section D.
// Used as the HMRC payment reference on the client's approval card —
// not re-entered per cycle.
export function getVatRegistrationNumber(
  intakeAnswers: Record<string, string> | null | undefined,
): string | null {
  const raw = intakeAnswers?.["vat_number"]?.trim();
  if (!raw) return null;
  // Pattern matches checklist.ts: exactly 9 digits.
  return /^\d{9}$/.test(raw) ? raw : null;
}

// Status machine. Mirrors the DB enum vat_cycle_status.
export type VatCycleStatus =
  | "awaiting_client_docs"
  | "in_review"
  | "client_approval"
  | "filed";

export const VAT_CYCLE_STATUS_LABELS: Record<VatCycleStatus, string> = {
  awaiting_client_docs: "Awaiting your documents",
  in_review: "Accountant preparing",
  client_approval: "Awaiting your approval",
  filed: "Filed",
};

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
//
// We work entirely in ISO YYYY-MM-DD strings — UK VAT periods are
// calendar-day boundaries without a timezone, and we never want
// Date-object JS magic to drift us by a day. All helpers below take and
// return YYYY-MM-DD.

type Ymd = string;

function parseYmd(ymd: Ymd): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`Invalid YYYY-MM-DD: ${ymd}`);
  return { y, m, d };
}

function formatYmd(y: number, m: number, d: number): Ymd {
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addMonths(ymd: Ymd, months: number): Ymd {
  const { y, m, d } = parseYmd(ymd);
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return formatYmd(ny, nm, nd);
}

function addDays(ymd: Ymd, days: number): Ymd {
  const { y, m, d } = parseYmd(ymd);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return formatYmd(
    dt.getUTCFullYear(),
    dt.getUTCMonth() + 1,
    dt.getUTCDate(),
  );
}

// Months in one period, from the frequency. Monthly=1, Quarterly=3,
// Annually=12. Not exported — callers go via the dates functions.
function monthsPerPeriod(f: VatFrequency): number {
  switch (f) {
    case "Monthly":
      return 1;
    case "Quarterly":
      return 3;
    case "Annually":
      return 12;
  }
}

// Given a period end date and the frequency, derive the start date.
// For a quarter ending 2026-03-31 at Quarterly, start = 2026-01-01.
// Pattern: start = end - N months + 1 day. This matches UK VAT
// convention where period "Jan–Mar" ends on the last day of March and
// starts on the first day of January.
export function computePeriodStart(endYmd: Ymd, f: VatFrequency): Ymd {
  const months = monthsPerPeriod(f);
  const stepped = addMonths(endYmd, -months);
  return addDays(stepped, 1);
}

// HMRC VAT return due date = period end + 1 month and 7 days.
// Example: period ending 2026-03-31 is due 2026-05-07.
export function computeHmrcDueDate(endYmd: Ymd): Ymd {
  return addDays(addMonths(endYmd, 1), 7);
}

// Given this cycle's end date and the frequency, derive the next
// cycle's dates. Called when a cycle is marked filed to auto-create
// the next one. The next start is "the day after the previous end";
// the next end is "add one period's months and subtract one day".
export function computeNextCycleDates(
  prevEndYmd: Ymd,
  f: VatFrequency,
): { startDate: Ymd; endDate: Ymd } {
  const startDate = addDays(prevEndYmd, 1);
  const months = monthsPerPeriod(f);
  const endDate = addDays(addMonths(startDate, months), -1);
  return { startDate, endDate };
}

// Short month name for label building.
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Human label for a cycle. Shape depends on frequency so the client
// isn't shown "Q1 Jan–Jan 2026" for a monthly cycle. Caller sets this
// at insert and we store it; subsequent renders can lean on this
// rather than re-deriving.
export function computePeriodLabel(
  startYmd: Ymd,
  endYmd: Ymd,
  f: VatFrequency,
): string {
  const s = parseYmd(startYmd);
  const e = parseYmd(endYmd);
  if (f === "Monthly") {
    // "January 2026" if whole month, else "1–15 Jan 2026" fallback.
    const wholeMonth =
      s.y === e.y &&
      s.m === e.m &&
      s.d === 1 &&
      e.d === daysInMonth(e.y, e.m);
    if (wholeMonth) return `${MONTH_LONG[s.m - 1]} ${s.y}`;
    return `${s.d}–${e.d} ${MONTH_NAMES[s.m - 1]} ${s.y}`;
  }
  if (f === "Quarterly") {
    const sameYear = s.y === e.y;
    return sameYear
      ? `${MONTH_NAMES[s.m - 1]}–${MONTH_NAMES[e.m - 1]} ${s.y}`
      : `${MONTH_NAMES[s.m - 1]} ${s.y}–${MONTH_NAMES[e.m - 1]} ${e.y}`;
  }
  // Annually: "Year ending 31 Dec 2026".
  return `Year ending ${e.d} ${MONTH_NAMES[e.m - 1]} ${e.y}`;
}

// ---------------------------------------------------------------------------
// Required / optional uploads per cycle
// ---------------------------------------------------------------------------
//
// Fixed list per the spec:
//  - Bank statement for the period            — required, PDF only
//  - Sales invoices / platform statements     — required (multi)
//  - Purchase documents / invoices            — optional (multi)
//  - Bill copies                              — optional (multi)
//
// We reuse ChecklistField so the existing DocumentUploader row renderer
// can be dropped straight in. requiredFor stays empty since the
// vat_reg tier is the only one eligible for VAT cycles at all — the
// section/tier gates are enforced by the cycle existing in the first
// place.

export const VAT_CYCLE_UPLOAD_FIELDS: ChecklistField[] = [
  {
    id: "vat_bank_statement_pdf",
    section: "A",
    label: "Bank statement for the period",
    hint: "PDF only. Must cover every day of the VAT period.",
    kind: "upload",
    requiredFor: [],
    multi: true,
  },
  {
    id: "vat_sales_invoices",
    section: "A",
    label: "Sales invoices / platform statements",
    hint: "Includes platform earnings statements (e.g. Uber, Deliveroo). Required — output VAT is calculated from these.",
    kind: "upload",
    requiredFor: [],
    multi: true,
  },
  {
    id: "vat_purchase_invoices",
    section: "A",
    label: "Purchase documents / invoices",
    kind: "upload",
    requiredFor: [],
    multi: true,
  },
  {
    id: "vat_bills",
    section: "A",
    label: "Bill copies",
    kind: "upload",
    requiredFor: [],
    multi: true,
  },
];

// Which upload slots are REQUIRED to submit a cycle. "requiredFor"
// stays empty on the field defs above (VAT cycles don't branch by
// tier), so required-ness is tracked here instead by id.
const REQUIRED_VAT_UPLOAD_KEYS = new Set([
  "vat_bank_statement_pdf",
  "vat_sales_invoices",
]);

export function isVatUploadRequired(fieldId: string): boolean {
  return REQUIRED_VAT_UPLOAD_KEYS.has(fieldId);
}

export const ACCOUNTANT_VAT_RETURN_DOC_KEY = "vat_return_doc";

export const VAT_PERIOD_FOOTER_NOTE =
  "Upload every required file for this VAT period. Your accountant will prepare the return as soon as the bank statement and sales records are in.";

// ---------------------------------------------------------------------------
// Approval payload shape + Box 5 messaging
// ---------------------------------------------------------------------------

export type VatApprovalPayload = {
  // All amounts in pence to stay integer. Positive = owed to HMRC;
  // negative values are allowed on Box 4 reclaim and Box 5 net (refund
  // from HMRC). Boxes 6–9 are turnover totals, always >= 0.
  box_1_pence: number; // VAT due on sales
  box_2_pence: number; // VAT due on acquisitions from EU
  box_3_pence: number; // Total VAT due (box 1 + box 2)
  box_4_pence: number; // VAT reclaimed on purchases
  box_5_pence: number; // Net VAT to pay / reclaim (box 3 - box 4)
  box_6_pence: number; // Total value of sales ex VAT
  box_7_pence: number; // Total value of purchases ex VAT
  box_8_pence: number; // Total EU sales ex VAT
  box_9_pence: number; // Total EU acquisitions ex VAT
  note: string | null;
  prepared_at: string;
  prepared_by: string;
};

// Box 5 interpretation for client messaging:
//  > 0  → client pays HMRC this amount
//  = 0  → nothing to pay (and nothing to reclaim)
//  < 0  → HMRC pays client this amount (|box5|)
//
// The spec requires the same "No VAT is payable for this period, any
// repayment due will be paid by HMRC directly to the company's bank
// account" copy pattern Batch 4 used for CT at £0. Here we trigger it
// on `<= 0` (nothing to pay AND the refund path).
export type Box5Mode = "pay" | "neutral_or_refund";

export function box5Mode(box5Pence: number): Box5Mode {
  return box5Pence > 0 ? "pay" : "neutral_or_refund";
}

export const BOX_5_NEUTRAL_OR_REFUND_COPY =
  "No VAT is payable for this period. Any repayment due will be paid by HMRC directly to the company's bank account.";

// Caller passes the raw entered amount in pounds (what the input shows)
// and we return a Box 5 value in pence. Shared between the accountant
// form and the server validator.
export function poundsToPence(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}
