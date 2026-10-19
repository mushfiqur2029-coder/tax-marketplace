// Phase 6 Slice 2: canonical categories the AI picks from when it reads
// a client's bank statement. Each key maps to a target table + row
// descriptor in the existing pch_income_lines / pch_expense_lines
// schema so the tax engine keeps working without changes.
//
// Three directions:
//   income    -> aggregated into pch_income_lines rows
//   expense   -> aggregated into pch_expense_lines rows
//   excluded  -> stored on pch_bank_transactions for audit, never
//                aggregated into the P&L (bank transfers, personal
//                drawings, HMRC payments, etc.)
//
// Keys stay stable: changing one is a schema change for already-stored
// pch_bank_transactions.category values. If a category needs renaming,
// add a new key and backfill, don't rename in place.

export type Direction = "income" | "expense" | "excluded";

export type IncomeRowKey = "primary_platform" | "weekly" | "cash";
export type ExpenseRowKey =
  | "fuel"
  | "insurance"
  | "rental"
  | "repairs"
  | "tolls_parking"
  | "licence"
  | "phone"
  | "finance_interest"
  | "cleaning"
  | "accountancy"
  | "other_business";

type IncomeCategoryDef = {
  key: string;
  label: string;
  direction: "income";
  rowKey: IncomeRowKey;
};

type ExpenseCategoryDef = {
  key: string;
  label: string;
  direction: "expense";
  rowKey: ExpenseRowKey;
};

type ExcludedCategoryDef = {
  key: string;
  label: string;
  direction: "excluded";
};

export type CategoryDef =
  | IncomeCategoryDef
  | ExpenseCategoryDef
  | ExcludedCategoryDef;

// Ordered for prompt listing (the AI sees them in this order; keep the
// most common ones near the top).
export const BANK_CATEGORIES: CategoryDef[] = [
  // ---- Income ----
  { key: "platform_fares", label: "Ride-hailing platform payout (Uber, Bolt, FreeNow, Addison Lee)", direction: "income", rowKey: "primary_platform" },
  { key: "cash_fares", label: "Cash fare paid in to the account", direction: "income", rowKey: "cash" },
  { key: "other_income", label: "Other taxable business income (private hire, airport contracts, etc.)", direction: "income", rowKey: "weekly" },

  // ---- Expenses ----
  { key: "fuel", label: "Fuel or EV charging", direction: "expense", rowKey: "fuel" },
  { key: "insurance", label: "Vehicle insurance (hire + reward)", direction: "expense", rowKey: "insurance" },
  { key: "rental", label: "PCO vehicle hire / rental", direction: "expense", rowKey: "rental" },
  { key: "repairs_mot", label: "Repairs, servicing, tyres, MOT and road tax", direction: "expense", rowKey: "repairs" },
  { key: "tolls_parking", label: "Congestion charge, ULEZ, parking (excluding fines)", direction: "expense", rowKey: "tolls_parking" },
  { key: "licence", label: "PHV driver or vehicle licence fee", direction: "expense", rowKey: "licence" },
  { key: "phone", label: "Mobile phone bill (business portion only)", direction: "expense", rowKey: "phone" },
  { key: "finance_interest", label: "Vehicle finance interest (HP / PCP / loan)", direction: "expense", rowKey: "finance_interest" },
  { key: "cleaning", label: "Vehicle cleaning or valeting", direction: "expense", rowKey: "cleaning" },
  { key: "accountancy", label: "Accountancy fees (Sterling Ledger service fee)", direction: "expense", rowKey: "accountancy" },
  { key: "other_business", label: "Other allowable business expense", direction: "expense", rowKey: "other_business" },

  // ---- Excluded ----
  { key: "transfer", label: "Transfer between the client's own accounts", direction: "excluded" },
  { key: "personal", label: "Personal spend (groceries, Netflix, personal shopping, etc.)", direction: "excluded" },
  { key: "hmrc_payment", label: "Payment to or refund from HMRC (not a business expense)", direction: "excluded" },
  { key: "fine", label: "Fine or penalty charge (never allowable)", direction: "excluded" },
  { key: "uncategorized", label: "Cannot tell; needs clarification from the client", direction: "excluded" },
];

const BY_KEY: Record<string, CategoryDef> = (() => {
  const map: Record<string, CategoryDef> = {};
  for (const c of BANK_CATEGORIES) map[c.key] = c;
  return map;
})();

export function categoryByKey(key: string | null | undefined): CategoryDef | null {
  if (!key) return null;
  return BY_KEY[key] ?? null;
}

export function isValidCategoryKey(key: string): boolean {
  return key in BY_KEY;
}

// Mapping helpers used by bank-aggregate.ts when writing into
// pch_income_lines / pch_expense_lines. Kept here so the "which column
// gets what" rules live next to the category definitions.

export function expenseRowLabel(rowKey: ExpenseRowKey): string {
  switch (rowKey) {
    case "fuel": return "Fuel";
    case "insurance": return "Insurance";
    case "rental": return "PCO rental";
    case "repairs": return "Repairs and servicing";
    case "tolls_parking": return "Congestion, ULEZ and parking";
    case "licence": return "Licence fees";
    case "phone": return "Mobile phone";
    case "finance_interest": return "Finance interest";
    case "cleaning": return "Vehicle cleaning";
    case "accountancy": return "Accountancy fees";
    case "other_business": return "Other allowable business expenses";
  }
}

export function expenseRowCategory(rowKey: ExpenseRowKey): string {
  switch (rowKey) {
    case "fuel":
    case "repairs":
      return "Vehicle running costs";
    case "insurance":
      return "Accountancy & insurance";
    case "rental":
      return "Vehicle hire, lease & finance";
    case "tolls_parking":
      return "Congestion, ULEZ, tolls & parking";
    case "licence":
      return "Licences & compliance";
    case "phone":
      return "Phone & technology";
    case "finance_interest":
      return "Finance & bank charges";
    case "cleaning":
      return "Vehicle running costs";
    case "accountancy":
      return "Accountancy & insurance";
    case "other_business":
      return "Other expenses";
  }
}

export function expenseRowBox(rowKey: ExpenseRowKey): 12 | 14 | 16 | 17 | 18 | 19 {
  switch (rowKey) {
    case "fuel":
    case "repairs":
    case "tolls_parking":
    case "rental":
    case "cleaning":
      return 12;
    case "insurance":
      return 14;
    case "accountancy":
      return 16;
    case "finance_interest":
      return 17;
    case "phone":
      return 18;
    case "licence":
    case "other_business":
      return 19;
  }
}

export function expenseRowCarCost(rowKey: ExpenseRowKey): "Yes" | "No" | "Phone" {
  switch (rowKey) {
    case "fuel":
    case "repairs":
    case "tolls_parking":
    case "rental":
    case "insurance":
    case "finance_interest":
    case "cleaning":
      return "Yes";
    case "phone":
      return "Phone";
    case "licence":
    case "accountancy":
    case "other_business":
      return "No";
  }
}

export function incomeRowSource(rowKey: IncomeRowKey): string {
  switch (rowKey) {
    case "primary_platform": return "Primary platform (bank-detected)";
    case "weekly": return "Other income (bank-detected)";
    case "cash": return "Cash paid in (bank-detected)";
  }
}
