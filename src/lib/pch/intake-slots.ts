// Shared PCH intake slot definitions. Previously declared twice: once
// in section-2-income.tsx (five income slots) and once in section-3-
// expenses.tsx (thirteen expense slots). Pulled out here so both the
// client intake UI AND the accountant P&L review surface can agree on
// one source of truth - the latter needs the classification params
// (category / sa103s_box / car_cost) to correctly create a row when
// the accountant edits an empty fixed-slot placeholder, rather than
// defaulting it into the generic "Other expenses" bucket.
//
// Pure data; no server-only or client-only markers so it can be
// imported from both sides.

export type IncomeSlot = {
  // Client-visible label; also the stored source value on
  // pch_income_lines.source and the key for matching DB rows to slots.
  label: string;
  helpText?: string;
  multiFile?: boolean;
};

export type ExpenseSlot = {
  // Client-visible label; also the stored label value on
  // pch_expense_lines.label. All three classification fields are per-
  // slot and MUST be preserved on write - mis-defaulting any of them
  // would misclassify the expense into the wrong SA103S box and
  // corrupt the category rollup used in the PCH Accounts PDF and the
  // tax engine.
  label: string;
  category: string;
  sa103s_box: 12 | 14 | 16 | 17 | 18 | 19;
  car_cost: "Yes" | "No" | "Phone";
  helpText?: string;
  multiFile?: boolean;
};

// Phase J: five fixed income sources mirroring the PL.xlsx template.
export const INCOME_FIXED_SLOTS: readonly IncomeSlot[] = [
  { label: "Uber" },
  { label: "Bolt" },
  { label: "Free Now" },
  {
    label: "Cash receipt",
    helpText: "Fares taken in cash across the year. Drop multiple files; we read each one and add it to the total.",
    multiFile: true,
  },
  {
    label: "Others income",
    helpText: "Anything from a platform not listed above. Drop multiple files; we read each one and add it to the total.",
    multiFile: true,
  },
];

// Phase J: 13 fixed expense cards in exact spec order. MOT and Road
// Tax are separate rows (reversing Phase F's merge). "Parking,
// Congestion & ULEZ" replaces the old Parking slot + airport multi-
// select with one card using the same category/box mapping as before.
export const EXPENSE_FIXED_SLOTS: readonly ExpenseSlot[] = [
  { label: "Fuel", category: "Vehicle running costs", sa103s_box: 12, car_cost: "Yes" },
  { label: "Insurance", category: "Accountancy & insurance", sa103s_box: 14, car_cost: "Yes" },
  { label: "Cleaning", category: "Vehicle running costs", sa103s_box: 12, car_cost: "Yes" },
  { label: "Repairs & Maintenance", category: "Vehicle running costs", sa103s_box: 12, car_cost: "Yes" },
  { label: "Licence Fees", category: "Licences & compliance", sa103s_box: 19, car_cost: "No" },
  { label: "Pension", category: "Other expenses", sa103s_box: 19, car_cost: "No" },
  { label: "MOT", category: "Vehicle running costs", sa103s_box: 12, car_cost: "Yes" },
  { label: "Road Tax", category: "Vehicle running costs", sa103s_box: 12, car_cost: "Yes" },
  { label: "Mobile", category: "Phone & technology", sa103s_box: 18, car_cost: "Phone", helpText: "Phone bills for the year." },
  { label: "Accountancy Fees", category: "Accountancy & insurance", sa103s_box: 14, car_cost: "No", helpText: "Prefilled with what you're paying us for this return. Edit if you paid other fees too." },
  { label: "Parking, Congestion & ULEZ", category: "Congestion, ULEZ, tolls & parking", sa103s_box: 12, car_cost: "Yes", helpText: "Parking, congestion charge, ULEZ, and airport drop-off fees. Not fines." },
  {
    label: "Cash expense",
    category: "Other expenses",
    sa103s_box: 19,
    car_cost: "No",
    helpText: "Cash receipts you kept across the year. Drop multiple files; we read each one and add it to the total.",
    multiFile: true,
  },
  {
    label: "Other expense",
    category: "Other expenses",
    sa103s_box: 19,
    car_cost: "No",
    helpText: "Anything that doesn't fit the categories above. Drop multiple receipts; we read each one and add it to the total.",
    multiFile: true,
  },
];

export function getIncomeSlotByLabel(label: string): IncomeSlot | null {
  return (
    INCOME_FIXED_SLOTS.find((s) => s.label === label) ?? null
  );
}

export function getExpenseSlotByLabel(label: string): ExpenseSlot | null {
  return (
    EXPENSE_FIXED_SLOTS.find((s) => s.label === label) ?? null
  );
}
